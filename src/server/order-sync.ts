import { eq, isNotNull } from "drizzle-orm";

import { env } from "@/env";
import {
  planSync,
  readSalesOrderState,
  type LocalOrderSnapshot,
  type SalesOrderState,
  type SyncPatch,
} from "@/server/daily-sync";
import { db } from "@/server/db";
import { orders } from "@/server/db/schema";
import { withSystemClient } from "@/server/jubelio-token";

/**
 * Order-status sync orchestration (spec §4.6).
 *
 * One implementation, two triggers: the Vercel cron (`POST
 * /api/cron/daily-sync`, midnight UTC), an external hourly pinger hitting the
 * same route, and a throttled run when an admin opens the orders page — so
 * statuses are fresh at the moment someone looks, without a page render ever
 * paying for the full upstream sweep.
 *
 * The I/O is injected (`SyncDeps`) because the interesting guarantees —
 * forward-only, failure-isolated, no duplicate writes, bounded concurrency —
 * are pure and belong in tests, not in a cron nobody can run locally.
 */

export type SyncRunResult = {
  /** Local orders that have a linked Jubelio SO. */
  checked: number;
  /** Patches written. */
  synced: number;
  /** SO fetches or patch writes that threw. */
  failed: number;
};

export type SyncDeps = {
  listLinkedOrders(): Promise<LocalOrderSnapshot[]>;
  fetchState(salesorderId: number): Promise<unknown>;
  apply(patch: SyncPatch): Promise<void>;
  /** Upstream calls in flight at once. */
  concurrency?: number;
};

/**
 * Small on purpose: a backlog of 50 linked orders must not open 50 sockets to
 * Jubelio at once, and the 15 s per-request abort bound means a stall costs at
 * most `concurrency` slots, not the whole run.
 */
const DEFAULT_CONCURRENCY = 4;

/**
 * Should a sync start now? `intervalMs: 0` disables the throttle entirely (the
 * `.env` escape hatch for local debugging); an in-flight run always wins over
 * the clock, so overlapping callers collapse instead of queueing.
 */
export function shouldRunSync(opts: {
  now: number;
  lastRunAt: number | null;
  intervalMs: number;
  inFlight: boolean;
}): boolean {
  if (opts.inFlight) return false;
  if (opts.intervalMs <= 0) return true;
  if (opts.lastRunAt === null) return true;
  return opts.now - opts.lastRunAt >= opts.intervalMs;
}

/**
 * One sync pass: read every linked SO by id, plan the patches, write them.
 *
 * A failed SO fetch is counted and skipped, never rethrown — one deleted or
 * timing-out sales order must not freeze every other order's status, which is
 * what an `await` in a plain `for` loop would do. Same for a failed write.
 */
export async function runOrderSync(deps: SyncDeps): Promise<SyncRunResult> {
  const localOrders = await deps.listLinkedOrders();
  const limit = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  const states = new Map<number, SalesOrderState>();
  let failed = 0;

  for (let i = 0; i < localOrders.length; i += limit) {
    const ids = localOrders
      .slice(i, i + limit)
      .map((o) => o.jubelioSoId)
      .filter((v): v is number => v !== null);
    const results = await Promise.all(
      ids.map(async (salesorderId) => {
        try {
          return {
            salesorderId,
            fetched: true,
            state: readSalesOrderState(await deps.fetchState(salesorderId)),
          };
        } catch (e) {
          console.error(
            `order-sync: SO ${salesorderId} fetch failed — order left untouched`,
            e,
          );
          return { salesorderId, fetched: false, state: null };
        }
      }),
    );
    for (const { salesorderId, fetched, state } of results) {
      if (state) states.set(salesorderId, state);
      // An unparseable body (no `internal_status`) is not a failure — it is a
      // row we deliberately leave alone, and counting it would hide real ones.
      else if (!fetched) failed += 1;
    }
  }

  let synced = 0;
  for (const patch of planSync(localOrders, states)) {
    try {
      await deps.apply(patch);
      synced += 1;
    } catch (e) {
      failed += 1;
      console.error(`order-sync: patch for order ${patch.orderId} failed`, e);
    }
  }

  return { checked: localOrders.length, synced, failed };
}

/**
 * Throttle wrapper around `runOrderSync`. `lastRunAt` is stamped when a run
 * FINISHES, so a slow sweep does not let the next one start immediately after;
 * a run that throws is not stamped, so the next eligible call retries instead
 * of waiting out a full interval on a transient failure.
 */
export function createThrottledSync(
  deps: SyncDeps,
  opts: { intervalMs: number; now?: () => number },
) {
  const clock = opts.now ?? (() => Date.now());
  let lastRunAt: number | null = null;
  let inFlight = false;

  return {
    /** Runs when due, otherwise resolves `null` immediately. */
    async maybe(): Promise<SyncRunResult | null> {
      if (
        !shouldRunSync({
          now: clock(),
          lastRunAt,
          intervalMs: opts.intervalMs,
          inFlight,
        })
      ) {
        return null;
      }
      inFlight = true;
      try {
        const result = await runOrderSync(deps);
        lastRunAt = clock();
        return result;
      } finally {
        inFlight = false;
      }
    },
    /** Test/reset hook — clears both the clock and the in-flight flag. */
    reset(): void {
      lastRunAt = null;
      inFlight = false;
    },
  };
}

/** Real deps: the local DB plus the system-account Jubelio client. */
export function createDbSyncDeps(): SyncDeps {
  return {
    async listLinkedOrders() {
      return db
        .select({
          id: orders.id,
          jubelioSoId: orders.jubelioSoId,
          status: orders.status,
          trackingNumber: orders.trackingNumber,
          shipper: orders.shipper,
        })
        .from(orders)
        .where(isNotNull(orders.jubelioSoId));
    },
    async fetchState(salesorderId) {
      // System account, not the viewing admin's token: the cron has no session,
      // and the throttled admin-view run must not depend on whose JWT is in
      // scope.
      return withSystemClient((client) => client.getSalesOrder(salesorderId));
    },
    async apply(patch) {
      await db
        .update(orders)
        .set({
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.trackingNumber ? { trackingNumber: patch.trackingNumber } : {}),
          ...(patch.shipper ? { shipper: patch.shipper } : {}),
        })
        .where(eq(orders.id, patch.orderId));
    },
  };
}

/**
 * The process-wide throttled sync used by the admin orders page. Module state,
 * so it is per server instance — on a multi-instance host two instances can
 * each run once per interval, which is harmless: the plan is idempotent and
 * forward-only.
 */
const throttled = createThrottledSync(createDbSyncDeps(), {
  intervalMs: env.ORDER_SYNC_INTERVAL_MS,
});

/** Sync if the interval has elapsed; `null` when it was skipped. */
export function maybeRunOrderSync(): Promise<SyncRunResult | null> {
  return throttled.maybe();
}

/** Force a full pass, ignoring the throttle — what the cron route calls. */
export function runOrderSyncNow(): Promise<SyncRunResult> {
  return runOrderSync(createDbSyncDeps());
}
