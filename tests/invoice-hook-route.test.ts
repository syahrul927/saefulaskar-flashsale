import { beforeEach, describe, expect, it, vi } from "vitest";

import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Route tests for the hook-invoice consumer (`POST /api/jubelio/hooks/[token]`,
 * spec 2026-11-08 §4.1–§4.3). The pure half it delegates to is pinned in
 * `tests/invoice-hook.test.ts`; what only a route test can pin is the HTTP
 * contract around it:
 *
 *   * the gate is INVERTED from the observation sink — unset token ⇒ 401 to
 *     everything, because this endpoint writes order status (spec §4.1);
 *   * the capture insert happens BEFORE any decision, best-effort, so a
 *     repointed callback still feeds the bench;
 *   * every non-auth outcome is a 200 `{ok, …}` — never a 5xx for a body we
 *     simply do not consume;
 *   * the flip runs the confirm-route discipline (FOR UPDATE pre-read,
 *     end-state-guarded UPDATE, history row on the same tx), and the SQL the
 *     guard emits is read back via `PgDialect` the way
 *     `tests/order-sync.filter.test.ts` does.
 *
 * Mock seams follow `tests/jubelio-sink-route.test.ts` (capturing db builder)
 * and `tests/order-sync.filter.test.ts` (SQL capture): only `@/env`,
 * `@/server/db`, `@/server/jubelio-token` and `@/server/cancel-order` are
 * faked — the probe core, the pure hook core, `readSalesOrderState`,
 * `recordStatusChange` and the schema all run for real.
 */
const state = vi.hoisted(() => ({
  /** The configured sink/hook token; every test sets what its case needs. */
  token: "tok" as string | undefined,
  /** Rows the plain order lookup resolves to, in call order. */
  orderRows: [] as Record<string, unknown>[],
  /** Rows the in-transaction FOR UPDATE pre-read resolves to. */
  preReadRows: [] as Record<string, unknown>[],
  /** What a guarded UPDATE reports back — empty means the guard refused it. */
  returning: [] as { id: string }[],
  /** Every `insert().values()` — capture rows and history rows, in order. */
  inserts: [] as { table: unknown; value: Record<string, unknown> }[],
  /** Parallel to `inserts`: did that insert run on the `tx`, not on `db`? */
  insertsInTransaction: [] as boolean[],
  /** Every UPDATE's `set()` payload, with the receiver (db or tx). */
  updates: [] as { values: Record<string, unknown>; inTransaction: boolean }[],
  /** `where()` conditions from SELECTs, in call order. */
  selectConditions: [] as unknown[],
  /** `where()` conditions from UPDATEs, in call order. */
  updateConditions: [] as unknown[],
  /** Lock modes passed to `.for()`, in call order. */
  locks: [] as unknown[],
  /** Arguments passed to `.limit()`, in call order. */
  limits: [] as number[],
  prunes: 0,
  pruneFails: false,
  /** When set, the CAPTURE insert throws — the history insert must not. */
  insertFails: false,
}));

vi.mock("@/env", () => ({
  env: {
    // Read live on every access, so a test can flip the configured token
    // without rebuilding the module.
    get JUBELIO_WEBHOOK_SINK_TOKEN() {
      return state.token;
    },
  },
}));

vi.mock("@/server/jubelio-token", () => ({ withSystemClient: vi.fn() }));

vi.mock("@/server/cancel-order", () => ({ cancelOrder: vi.fn() }));

vi.mock("@/server/db", async () => {
  const { orderStatusHistory, webhookCaptures } = await import(
    "@/server/db/schema"
  );

  const select =
    (inTx: boolean) =>
    () => ({
      from: () => ({
        where: (condition: unknown) => {
          state.selectConditions.push(condition);
          // The plain join lookup and the tx pre-read draw from different
          // queues so a test can stage them independently.
          const rows = inTx ? state.preReadRows : state.orderRows;
          const base = Promise.resolve(rows);
          return Object.assign(base, {
            for: (lock: unknown) => {
              state.locks.push(lock);
              return base;
            },
            orderBy: () => ({
              // Honors the requested count (a limit-ignoring mock would let a
              // `.limit(1)` regression pass while the anomaly goes undetected
              // in production, where the DB does respect the limit).
              limit: async (n: number) => {
                state.limits.push(n);
                return rows.slice(0, n);
              },
            }),
          });
        },
      }),
    });

  const update =
    (inTx: boolean) =>
    () => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push({ values, inTransaction: inTx });
        return {
          where: (condition: unknown) => {
            state.updateConditions.push(condition);
            const base = Promise.resolve(state.returning);
            return Object.assign(base, {
              returning: async () => state.returning,
            });
          },
        };
      },
    });

  const insertFor =
    (inTx: boolean) =>
    (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        // Only the CAPTURE insert may be made to fail — the ledger insert has
        // to survive so the "capture failed, flip landed" case stays provable.
        if (state.insertFails && table === webhookCaptures) {
          throw new Error("db down");
        }
        state.inserts.push({ table, value: row });
        state.insertsInTransaction.push(inTx);
        return [{ id: `row-${state.inserts.length}` }];
      },
    });

  const tx = {
    select: select(true),
    update: update(true),
    insert: insertFor(true),
  };

  return {
    db: {
      select: select(false),
      update: update(false),
      insert: insertFor(false),
      delete: () => ({
        where: async () => {
          state.prunes += 1;
          if (state.pruneFails) throw new Error("delete exploded");
          return { rowCount: 0 };
        },
      }),
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

import { cancelOrder } from "@/server/cancel-order";
import { orderStatusHistory, webhookCaptures } from "@/server/db/schema";
import { POST } from "@/app/api/jubelio/hooks/[token]/route";
import { withSystemClient } from "@/server/jubelio-token";
import { END_STATUSES } from "@/server/order-status";

const dialect = new PgDialect();

/** Decode a captured drizzle condition into the SQL and params it emits. */
function sqlOf(condition: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condition as never);
}

/** The fake Jubelio client the `withSystemClient` seam hands its callback. */
const getSalesOrder = vi.fn();

/** The spec §1 capture, live-shaped — the body every flip case posts. */
const INVOICE_BODY_OBJ = {
  action: "hook-invoice",
  ref_no: "SO-000192297",
  invoice_id: 188102,
  invoice_no: "INV-000188102",
};
const INVOICE_BODY = JSON.stringify(INVOICE_BODY_OBJ);

function post(opts: {
  token?: string;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
}) {
  const headers = new Headers({
    "content-type": opts.contentType ?? "application/json",
    ...opts.headers,
  });
  const token = opts.token ?? "tok";
  return POST(
    new Request(`http://test/api/jubelio/hooks/${token}`, {
      method: "POST",
      headers,
      body: opts.body ?? INVOICE_BODY,
    }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  state.token = "tok";
  state.orderRows = [];
  state.preReadRows = [];
  state.returning = [];
  state.inserts = [];
  state.insertsInTransaction = [];
  state.updates = [];
  state.selectConditions = [];
  state.updateConditions = [];
  state.locks = [];
  state.limits = [];
  state.prunes = 0;
  state.pruneFails = false;
  state.insertFails = false;

  // Default upstream: a PAID SO fetched through the system client. Cases that
  // need a different header override `getSalesOrder` (or reject outright).
  vi.mocked(withSystemClient).mockReset();
  vi.mocked(withSystemClient).mockImplementation(
    async (fn) => fn({ getSalesOrder } as never),
  );
  getSalesOrder.mockReset();
  getSalesOrder.mockResolvedValue({ internal_status: "PAID" });
  vi.mocked(cancelOrder).mockReset();
});

describe("POST /api/jubelio/hooks/[token] — the gate", () => {
  it("is closed by default: unset token answers 401 to any path and touches nothing", async () => {
    // The sink's open-when-unset must NOT leak here: this route writes orders
    // (spec §4.1), so an unconfigured token means CLOSED, always.
    state.token = undefined;

    const res = await post({ token: "whatever" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      error: "Token webhook tidak valid.",
    });
    expect(state.inserts).toEqual([]);
    expect(state.selectConditions).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it("rejects a wrong token with 401 before any read or write", async () => {
    const res = await post({ token: "wrong-token" });

    expect(res.status).toBe(401);
    expect(state.inserts).toEqual([]);
    expect(state.selectConditions).toEqual([]);
    expect(state.updates).toEqual([]);
  });
});

describe("POST /api/jubelio/hooks/[token] — the flip", () => {
  it("flips a CONFIRMED order on the faktur event: capture first, guarded write, one history row", async () => {
    state.orderRows = [{ id: "o-1", status: "CONFIRMED" }];
    state.preReadRows = [{ status: "CONFIRMED" }];
    state.returning = [{ id: "o-1" }];

    const res = await post({});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: true });

    // The capture landed FIRST, on db (not tx), labelled with the event and
    // carrying the join keys lifted into columns.
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[0]?.table).toBe(webhookCaptures);
    expect(state.insertsInTransaction[0]).toBe(false);
    const capture = state.inserts[0]?.value;
    expect(capture?.source).toBe("hook:hook-invoice");
    expect(capture?.method).toBe("POST");
    expect(capture?.body).toEqual(INVOICE_BODY_OBJ);
    expect(capture?.invoiceId).toBe(188102);
    expect(capture?.refNo).toBe("SO-000192297");
    expect(capture?.salesorderId).toBeNull();

    // The hook is a hint; the SO fetch is the evidence — id parsed off ref_no.
    expect(getSalesOrder).toHaveBeenCalledWith(192297);

    // The join: orders whose jubelio_so_id is the parsed id.
    expect(sqlOf(state.selectConditions[0]).params).toEqual([192297]);

    // The guarded write ran on the tx, under a row lock, with the invoice
    // columns riding along and the end-state predicate in the SQL itself.
    expect(state.locks).toEqual(["update"]);
    expect(state.updates).toEqual([
      {
        values: {
          status: "COMPLETED",
          invoiceId: 188102,
          invoiceNo: "INV-000188102",
        },
        inTransaction: true,
      },
    ]);
    expect(state.updateConditions).toHaveLength(1);
    const guard = sqlOf(state.updateConditions[0]);
    expect(guard.sql).toContain("not in");
    expect(guard.params).toEqual(["o-1", ...END_STATUSES]);

    // One ledger row, written on the tx, faktur never named in the note.
    expect(state.inserts[1]?.table).toBe(orderStatusHistory);
    expect(state.insertsInTransaction[1]).toBe(true);
    expect(state.inserts[1]?.value).toEqual({
      orderId: "o-1",
      fromStatus: "CONFIRMED",
      toStatus: "COMPLETED",
      source: "sync",
      actorUserId: null,
      note: null,
    });
  });

  it("refreshes only the invoice on an already-COMPLETED order and writes no history row", async () => {
    // The retried hook (spec §4.3.4): the faktur identity is refreshed
    // idempotently, the ledger stays untouched, the answer is still ok.
    state.orderRows = [{ id: "o-1", status: "COMPLETED" }];
    state.preReadRows = [{ status: "COMPLETED" }];

    const res = await post({});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: false });

    // Unguarded, invoice-only: no status key, no end-state predicate needed.
    expect(state.updates).toEqual([
      {
        values: { invoiceId: 188102, invoiceNo: "INV-000188102" },
        inTransaction: true,
      },
    ]);
    expect(sqlOf(state.updateConditions[0]).params).toEqual(["o-1"]);

    // Capture only — no audit row for a transition that did not happen.
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.table).toBe(webhookCaptures);
  });

  it("routes a CANCELED SO through the cancel service instead of lifting to COMPLETED", async () => {
    // A faktur hook for a since-cancelled SO is stale or out of order; the
    // cancel service is the one writer of CANCEL and releases quota correctly
    // (spec §4.3).
    getSalesOrder.mockResolvedValue({ internal_status: "CANCELED" });
    vi.mocked(cancelOrder).mockResolvedValue({
      cancelled: true,
      fromStatus: "CONFIRMED",
      releasedUnits: 2,
    });
    state.orderRows = [{ id: "o-1", status: "CONFIRMED" }];

    const res = await post({});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: true });
    expect(cancelOrder).toHaveBeenCalledWith(expect.anything(), {
      orderId: "o-1",
      source: "sync",
      note: "SO #192297 dibatalkan di Jubelio",
    });
    // The hook never writes a status itself — the service owns the transition.
    expect(state.updates).toEqual([]);
    expect(state.updateConditions).toEqual([]);
  });

  it("answers upstream-unreadable and writes nothing when the SO fetch fails", async () => {
    // An unreachable upstream must never look like a completed order
    // (spec §4.3) — but the capture of what arrived still lands.
    vi.mocked(withSystemClient).mockRejectedValue(new Error("jubelio down"));
    state.orderRows = [{ id: "o-1", status: "CONFIRMED" }];

    const res = await post({});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "upstream-unreadable" });
    expect(state.updates).toEqual([]);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.table).toBe(webhookCaptures);
  });

  it("answers upstream-unreadable when the SO header carries no internal_status", async () => {
    // A 2xx we cannot parse is the same verdict as a failed fetch: untouched.
    getSalesOrder.mockResolvedValue({});
    state.orderRows = [{ id: "o-1", status: "CONFIRMED" }];

    const res = await post({});

    expect(await res.json()).toEqual({ ok: false, reason: "upstream-unreadable" });
    expect(state.updates).toEqual([]);
    expect(state.inserts).toHaveLength(1);
  });

  it("does not flip an UNPAID order — the confirm-retry path owns that healing", async () => {
    // The 2026-10-28 damage shape: an UNPAID row already carrying an SO id
    // (spec §4.3.5). The hook logs it and walks away.
    state.orderRows = [{ id: "o-1", status: "UNPAID" }];
    state.preReadRows = [{ status: "UNPAID" }];

    const res = await post({});

    expect(await res.json()).toEqual({ ok: false, reason: "not-confirmed" });
    expect(state.updates).toEqual([]);
    expect(state.inserts).toHaveLength(1);
  });

  it("ignores marketplace hooks without ever touching the order table", async () => {
    // The same account receives hooks for its 184k marketplace orders and
    // their SP-… numbers; this is expected traffic, not an error (spec §4.1).
    const res = await post({
      body: JSON.stringify({
        action: "hook-invoice",
        ref_no: "SP-261107NGP1K1DB",
        invoice_id: 44120,
        invoice_no: "INV-000044120",
      }),
    });

    expect(await res.json()).toEqual({ ok: false, reason: "unjoined" });
    expect(state.selectConditions).toEqual([]);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.value.source).toBe("hook:hook-invoice");
  });

  it("answers unparseable for a body that is not JSON, capture kept with body null", async () => {
    const res = await post({ body: "not json" });

    expect(await res.json()).toEqual({ ok: false, reason: "unparseable" });
    const capture = state.inserts[0]?.value;
    expect(capture?.source).toBe("hook");
    expect(capture?.body).toBeNull();
    expect(capture?.rawBody).toBe("not json");
    expect(state.selectConditions).toEqual([]);
  });

  it("answers 'unhandled action' for another Jubelio event, capture labelled with it", async () => {
    // The dashboard may deliver other events to this URL; they must never
    // become a 5xx (spec §4.1).
    const res = await post({ body: JSON.stringify({ action: "hook-salesorder" }) });

    expect(await res.json()).toEqual({ ok: false, reason: "unhandled action" });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.value.source).toBe("hook:hook-salesorder");
    expect(state.selectConditions).toEqual([]);
  });

  it("still flips when the best-effort capture insert fails", async () => {
    // The capture is a bench, not a dependency (spec §4.1): a failed insert is
    // logged and the flip proceeds exactly as if it had landed.
    state.insertFails = true;
    state.orderRows = [{ id: "o-1", status: "CONFIRMED" }];
    state.preReadRows = [{ status: "CONFIRMED" }];
    state.returning = [{ id: "o-1" }];

    const res = await post({});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: true });
    // No capture row, but the ledger row landed.
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.table).toBe(orderStatusHistory);
    expect(state.inserts[0]?.value.toStatus).toBe("COMPLETED");
  });

  it("acts on the newest row and logs the anomaly when two orders share one SO id", async () => {
    // No unique constraint on jubelio_so_id (spec §4.2). The lookup fetches
    // two rows — the smallest read that can prove "more than one" — acts on
    // the newest-first head, and the anomaly is LOGGED, not buried.
    state.orderRows = [
      { id: "o-new", status: "CONFIRMED" },
      { id: "o-old", status: "CONFIRMED" },
    ];
    state.preReadRows = [{ status: "CONFIRMED" }];
    state.returning = [{ id: "o-new" }];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post({});

    expect(await res.json()).toEqual({ ok: true, changed: true });
    // The lookup fetched TWO rows — the smallest read that can prove "more
    // than one" — and the mock honors the limit, so a `.limit(1)` regression
    // would stage only the newest row and leave this red.
    expect(state.limits).toEqual([2]);
    expect(err).toHaveBeenCalledWith(
      "hook-invoice: multiple orders match SO #192297 — acting on the newest (o-new)",
    );
    // The write named the NEWEST row, and the ledger row belongs to it.
    expect(sqlOf(state.updateConditions[0]).params).toEqual([
      "o-new",
      ...END_STATUSES,
    ]);
    expect(state.inserts.at(-1)?.value).toMatchObject({
      orderId: "o-new",
      toStatus: "COMPLETED",
    });
    err.mockRestore();
  });

  it("still flips when the best-effort capture PRUNE fails", async () => {
    // The mirror of case 12: the capture landed, the courtesy prune threw —
    // the flip must not care. Asserted here so the prune counter is not dead
    // scaffolding.
    state.pruneFails = true;
    state.orderRows = [{ id: "o-1", status: "CONFIRMED" }];
    state.preReadRows = [{ status: "CONFIRMED" }];
    state.returning = [{ id: "o-1" }];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post({});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: true });
    expect(state.prunes).toBe(1);
    // Capture row + ledger row both present.
    expect(state.inserts).toHaveLength(2);
    err.mockRestore();
  });

  it("answers changed:false without a history row when the guard refuses the write", async () => {
    // The race lost: an admin cancelled between the pre-read and the guarded
    // UPDATE, so it matches nothing. No transition is invented for the ledger.
    state.orderRows = [{ id: "o-1", status: "CONFIRMED" }];
    state.preReadRows = [{ status: "CONFIRMED" }];
    state.returning = [];

    const res = await post({});

    expect(await res.json()).toEqual({ ok: true, changed: false });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.table).toBe(webhookCaptures);
  });
});
