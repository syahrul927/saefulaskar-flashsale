import { and, eq, isNotNull, notInArray } from "drizzle-orm";

import { env } from "@/env";
import { JubelioError } from "@/lib/jubelio";
import { cancelOrder } from "@/server/cancel-order";
import {
  planSync,
  readSalesOrderState,
  type LocalOrderSnapshot,
  type SoVerdict,
  type SyncPatch,
} from "@/server/daily-sync";
import { db } from "@/server/db";
import { orders } from "@/server/db/schema";
import { withSystemClient } from "@/server/jubelio-token";
import { END_STATUSES } from "@/server/order-status";
import { recordStatusChange } from "@/server/status-history";

/**
 * Order-status sync orchestration (spec §4.6).
 *
 * One implementation, one trigger: a throttled pass when an admin opens
 * `/admin/orders`, kept alive past the response by `after()` so a slow sweep
 * still lands its writes (`src/app/admin/orders/page.tsx:53-62`). There is no
 * cron and no external pinger — an admin opening that page is the only thing
 * that moves a status (spec §4.7).
 *
 * The I/O is injected (`SyncDeps`) because the interesting guarantees —
 * forward-only, failure-isolated, no duplicate writes, bounded concurrency, and
 * "only a definitive 404 cancels" — are pure and belong in tests, not in a page
 * load nobody can force on demand locally.
 */

export type SyncRunResult = {
  /** Local orders that have a linked Jubelio SO. */
  checked: number;
  /** Status/resi patches that landed a write. */
  synced: number;
  /**
   * Orders this pass moved to `CANCEL` — disjoint from `synced`, since a cancel
   * is a different kind of write (quota released, history row written). Counts
   * only the cancels the service ACCEPTED; a refused one is in `skipped`, so an
   * operator reading this number knows that many orders gave their units back.
   */
  cancelled: number;
  /**
   * Patches that changed nothing because the row had already moved on: the
   * cancel service refused it (an admin cancelled between our read and our
   * write) or the guarded UPDATE matched no row. A race, not a failure — no
   * retry would help, and filing it under `failed` would read as an outage.
   */
  skipped: number;
  /** SO reads we could not decide anything from, plus patch writes that threw. */
  failed: number;
};

/**
 * What `apply` did with one patch, so the counters say what their docs claim.
 * Reporting is optional: a dep that returns nothing counts as landed, which is
 * what a test fake that only records the patch wants.
 */
export type SyncApplyOutcome = { landed: boolean };

export type SyncDeps = {
  listLinkedOrders(): Promise<LocalOrderSnapshot[]>;
  fetchState(salesorderId: number): Promise<unknown>;
  apply(patch: SyncPatch): Promise<SyncApplyOutcome | void>;
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
 * A failed SO read is classified, counted and skipped, never rethrown — one
 * deleted or timing-out sales order must not freeze every other order's status,
 * which is what an `await` in a plain `for` loop would do. Same for a failed
 * write.
 *
 * The classification is the part that decides whether an order survives: only a
 * DEFINITIVE 404 becomes `missing`, and only `missing` cancels. Timeouts,
 * 401/403, 5xx and unparseable bodies are all `unknown` and leave the order
 * exactly as it was (Review Focus 1).
 */
export async function runOrderSync(deps: SyncDeps): Promise<SyncRunResult> {
  const localOrders = await deps.listLinkedOrders();
  const limit = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  const verdicts = new Map<number, SoVerdict>();
  let failed = 0;

  for (let i = 0; i < localOrders.length; i += limit) {
    const ids = localOrders
      .slice(i, i + limit)
      .map((o) => o.jubelioSoId)
      .filter((v): v is number => v !== null);
    const results = await Promise.all(
      ids.map(
        async (
          salesorderId,
        ): Promise<{ salesorderId: number; verdict: SoVerdict }> => {
          try {
            const state = readSalesOrderState(
              await deps.fetchState(salesorderId),
            );
            return {
              salesorderId,
              // A 2xx we could not parse is `unknown`, never `missing`: we
              // reached Jubelio and could not read the answer, which is not
              // proof the SO is gone.
              verdict: state
                ? { kind: "state", state }
                : { kind: "unknown", detail: "unparseable body" },
            };
          } catch (e) {
            if (e instanceof JubelioError && e.status === 404) {
              // The line an admin reads when an order silently cancels, written
              // before any write happens and naming the SO that disappeared.
              console.warn(
                `order-sync: SO ${salesorderId} is gone upstream — its order will be cancelled`,
              );
              return { salesorderId, verdict: { kind: "missing" } };
            }
            console.error(
              `order-sync: SO ${salesorderId} unreadable — order left untouched`,
              e,
            );
            return {
              salesorderId,
              verdict: { kind: "unknown", detail: describeError(e) },
            };
          }
        },
      ),
    );
    for (const { salesorderId, verdict } of results) {
      verdicts.set(salesorderId, verdict);
      // Spec §4.4 counts every `unknown` as a failure — it is a row this pass
      // could decide nothing about, and hiding it would hide the token or the
      // network problem behind it. `missing` is a decision, not a failure.
      if (verdict.kind === "unknown") failed += 1;
    }
  }

  let synced = 0;
  let cancelled = 0;
  let skipped = 0;
  for (const patch of planSync(localOrders, verdicts)) {
    try {
      const outcome = await deps.apply(patch);
      // Only an explicit `landed: false` is a refusal: a dep that reports
      // nothing (every test fake) wrote the patch, as far as we can tell.
      if (outcome?.landed === false) skipped += 1;
      else if (patch.status === "CANCEL") cancelled += 1;
      else synced += 1;
    } catch (e) {
      failed += 1;
      console.error(`order-sync: patch for order ${patch.orderId} failed`, e);
    }
  }

  return { checked: localOrders.length, synced, cancelled, skipped, failed };
}

/**
 * The log-friendly half of an `unknown` verdict. Deliberately thin: the stack is
 * already on its own `console.error`, and `detail` only has to say what KIND of
 * failure it was so a log scan can tell a dead token from a dead network.
 */
function describeError(e: unknown): string {
  if (e instanceof JubelioError) return `${e.status} ${e.message}`;
  return e instanceof Error ? e.name : "error";
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
        // The only observability this sync has left: the admin page discards the
        // result (spec §4.4) and the cron route that used to return it as JSON is
        // gone. One line per COMPLETED pass — a skipped pass logs nothing, so a
        // quiet log means the throttle did its job, not that the sync is dead.
        console.info(
          `order-sync: checked ${result.checked}, synced ${result.synced}, ` +
            `cancelled ${result.cancelled}, skipped ${result.skipped}, ` +
            `failed ${result.failed}`,
        );
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
        // End states are excluded, not merely skipped later: a COMPLETED or
        // CANCEL row would otherwise cost an upstream read on every pass,
        // forever, to produce a patch `planSync` refuses to emit (spec §4.4).
        // This is the query behind "only select the orders that are not complete
        // or cancelled".
        .where(
          and(
            isNotNull(orders.jubelioSoId),
            notInArray(orders.status, [...END_STATUSES]),
          ),
        );
    },
    async fetchState(salesorderId) {
      // System account, not the viewing admin's token: the pass runs from
      // whoever's page-load triggered it, and must not depend on whose JWT is
      // in scope — an expired admin session cannot be allowed to stall the
      // sync mid-sweep.
      return withSystemClient((client) => client.getSalesOrder(salesorderId));
    },
    async apply(patch) {
      // A `const` copy: narrowing a parameter's property does not survive into
      // the transaction callback below, and the callback is where it is needed.
      const status = patch.status;
      if (status === "CANCEL") {
        // One service owns the transition (spec §4.2): the guarded flip, the
        // clamped quota release and the history row all live in `cancelOrder`,
        // so the sync must not write a CANCEL itself. `note` carries the cause
        // the planner composed — do NOT append the "unit kembali ke kuota sesi"
        // sentence here, `composeCancelNote` adds it inside the service and a
        // second copy would show up twice in the stepper.
        const result = await cancelOrder(db, {
          orderId: patch.orderId,
          source: "sync",
          note: patch.cause ?? null,
        });
        if (!result.cancelled) {
          console.warn(
            `order-sync: cancel for ${patch.orderId} skipped (${result.reason})`,
          );
        }
        // Reported, not thrown: the row is already where it needs to be, so this
        // is the `skipped` counter and never `failed`.
        return { landed: result.cancelled };
      }

      let landed = false;
      await db.transaction(async (tx) => {
        const [before] = await tx
          .select({ status: orders.status })
          .from(orders)
          .where(eq(orders.id, patch.orderId));
        const flipped = await tx
          .update(orders)
          .set({
            ...(status ? { status } : {}),
            ...(patch.trackingNumber
              ? { trackingNumber: patch.trackingNumber }
              : {}),
            ...(patch.shipper ? { shipper: patch.shipper } : {}),
          })
          // Guarded, where this used to be a bare update: a sync racing an admin
          // cancel could otherwise overwrite CANCEL with CONFIRMED, and
          // `flipped` being empty is how the loser of that race finds out.
          .where(
            and(
              eq(orders.id, patch.orderId),
              notInArray(orders.status, [...END_STATUSES]),
            ),
          )
          .returning({ id: orders.id });
        landed = flipped.length === 1;
        // Four gates, each with its own reason. `status`: a resi-only pass is not
        // a transition (spec §4.5). `before`: the row may have been deleted
        // between the pre-read and the write. `landed`: the guarded UPDATE may
        // have matched nothing, so a lost race writes no audit row. And
        // `before.status !== status`, which is the term a review caught: the
        // end-state guard alone does NOT stop a second pass recording
        // CONFIRMED → CONFIRMED, because a CONFIRMED row still matches that
        // guard — and a stepper row for a transition that never happened is
        // exactly what spec §4.5 forbids.
        if (status && before && landed && before.status !== status) {
          await recordStatusChange(tx, {
            orderId: patch.orderId,
            fromStatus: before.status,
            toStatus: status,
            source: "sync",
          });
        }
      });
      return { landed };
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

