import { beforeEach, describe, expect, it, vi } from "vitest";

import { PgDialect } from "drizzle-orm/pg-core";

// `SyncDeps` is injectable, and that is why `tests/order-sync.test.ts` cannot
// reach this file's subject: it hands in its own `listLinkedOrders` and `apply`,
// so the REAL deps — where this plan's load-bearing query and its guarded write
// live — are never executed by any test. Two guarantees would survive being
// deleted:
//
//   * end states are filtered out in SQL (spec §4.4), so a COMPLETED or CANCEL
//     row stops costing an upstream read forever;
//   * the status UPDATE is guarded by the same end-state predicate, so a sync
//     racing an admin's cancel loses instead of overwriting CANCEL.
//
// So this file mocks only `@/server/db` (a builder fake that captures every
// `where()` condition and every `set()` payload) and the cancel service (to see
// who is called), letting `createDbSyncDeps()` run for real and its emitted SQL
// be read back with `PgDialect`. Separate file rather than folded into
// `order-sync.test.ts` because `vi.mock` is hoisted per file: that one mocks
// nothing and needs the real module, this one needs a fake `db`.
vi.mock("@/server/cancel-order", () => ({ cancelOrder: vi.fn() }));

const state = vi.hoisted(() => ({
  /** `where()` conditions from SELECTs, in call order. */
  selectConditions: [] as unknown[],
  /** `where()` conditions from UPDATEs, in call order. */
  updateConditions: [] as unknown[],
  /** `set()` payloads, in call order. */
  updates: [] as Record<string, unknown>[],
  /** Rows a SELECT resolves to, consumed in order. */
  selectRows: [] as unknown[][],
  /** What the guarded UPDATE reports back — empty means the guard refused it. */
  returning: [] as { id: string }[],
  /** Rows inserted into `order_status_history`. */
  history: [] as Record<string, unknown>[],
  /** Parallel to `history`: did that insert run on a `tx`, not on `db`? */
  historyInTransaction: [] as boolean[],
}));

vi.mock("@/server/db", async () => {
  const { orderStatusHistory } = await import("@/server/db/schema");

  const select = () => ({
    from: () => ({
      where: async (condition: unknown) => {
        state.selectConditions.push(condition);
        return state.selectRows.shift() ?? [];
      },
    }),
  });

  const update = () => ({
    set: (values: Record<string, unknown>) => {
      state.updates.push(values);
      return {
        where: (condition: unknown) => {
          state.updateConditions.push(condition);
          return { returning: async () => state.returning };
        },
      };
    },
  });

  // Per RECEIVER, so a history row written on `db` instead of the `tx` would be
  // visible as such: an audit row outside the transaction commits even when the
  // status UPDATE rolls back.
  const insertFor =
    (inTransaction: boolean) => (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        if (table === orderStatusHistory) {
          state.history.push(row);
          state.historyInTransaction.push(inTransaction);
        }
        return [row];
      },
    });

  const tx = { select, update, insert: insertFor(true) };
  return {
    db: {
      select,
      update,
      insert: insertFor(false),
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

import { cancelOrder } from "@/server/cancel-order";
import { createDbSyncDeps } from "@/server/order-sync";
import { END_STATUSES } from "@/server/order-status";

const dialect = new PgDialect();

/** Decode a captured drizzle condition into the SQL and params it emits. */
function sqlOf(condition: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condition as never);
}

beforeEach(() => {
  state.selectConditions = [];
  state.updateConditions = [];
  state.updates = [];
  state.selectRows = [];
  state.returning = [];
  state.history = [];
  state.historyInTransaction = [];
  vi.mocked(cancelOrder).mockReset();
});

describe("createDbSyncDeps().listLinkedOrders", () => {
  it("excludes end states in the SQL, not only later in planSync", async () => {
    // The sentence behind "only select the orders that are not complete or
    // cancelled". Dropping the `notInArray` turns this red twice over: the
    // predicate disappears from the SQL and so do its params.
    await createDbSyncDeps().listLinkedOrders();

    expect(state.selectConditions).toHaveLength(1);
    const query = sqlOf(state.selectConditions[0]);
    expect(query.sql).toContain("is not null");
    expect(query.sql).toContain("not in");
    expect(query.params).toEqual([...END_STATUSES]);
  });
});

describe("createDbSyncDeps().apply", () => {
  it("hands a cancel patch to the service and writes no status itself", async () => {
    vi.mocked(cancelOrder).mockResolvedValue({
      cancelled: true,
      fromStatus: "CONFIRMED",
      releasedUnits: 2,
    });

    await createDbSyncDeps().apply({
      orderId: "o1",
      status: "CANCEL",
      cause: "SO #86 dihapus di Jubelio",
    });

    // The first argument is the mocked `db` and pins nothing here — that a real
    // `db` satisfies `CancelDb` is cancel-order's own file's job. What matters
    // is `source: "sync"` (the stepper's label) and that the planner's cause
    // rides along RAW: `composeCancelNote` appends the quota sentence inside the
    // service, so composing it here too would print it twice.
    expect(cancelOrder).toHaveBeenCalledWith(expect.anything(), {
      orderId: "o1",
      source: "sync",
      note: "SO #86 dihapus di Jubelio",
    });
    expect(state.updates).toEqual([]);
    // No audit row either — the service writes the history row, inside its own
    // transaction, with the quota release.
    expect(state.history).toEqual([]);
  });

  it("writes a status patch under the end-state guard, audit row in the same transaction", async () => {
    state.selectRows = [[{ status: "UNPAID" }]];
    state.returning = [{ id: "o1" }];

    await createDbSyncDeps().apply({ orderId: "o1", status: "CONFIRMED" });

    expect(state.updates).toEqual([{ status: "CONFIRMED" }]);
    expect(state.updateConditions).toHaveLength(1);
    const query = sqlOf(state.updateConditions[0]);
    expect(query.sql).toContain("not in");
    expect(query.params).toEqual(["o1", ...END_STATUSES]);
    expect(state.historyInTransaction).toEqual([true]);
    expect(state.history).toEqual([
      {
        orderId: "o1",
        fromStatus: "UNPAID",
        toStatus: "CONFIRMED",
        source: "sync",
        actorUserId: null,
        note: null,
      },
    ]);
  });

  it("writes no audit row when the guard refused the update", async () => {
    // The race: an admin cancelled between the pre-read and the UPDATE, so the
    // guarded write matches nothing. Recording CONFIRMED anyway would put a
    // transition in the stepper that never happened.
    state.selectRows = [[{ status: "UNPAID" }]];
    state.returning = [];

    await createDbSyncDeps().apply({ orderId: "o1", status: "CONFIRMED" });

    expect(state.history).toEqual([]);
  });

  it("leaves a resi-only patch silent — no status, no history row", async () => {
    // Spec §4.5: a shipping label arriving late is not a transition.
    state.selectRows = [[{ status: "CONFIRMED" }]];
    state.returning = [{ id: "o1" }];

    await createDbSyncDeps().apply({
      orderId: "o1",
      trackingNumber: "001818714258",
      shipper: "SiCepat HALU",
    });

    expect(state.updates).toEqual([
      { trackingNumber: "001818714258", shipper: "SiCepat HALU" },
    ]);
    expect(state.history).toEqual([]);
  });
});
