import { describe, expect, it } from "vitest";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  cancelOrder,
  composeCancelNote,
  planQuotaRelease,
} from "@/server/cancel-order";
import { orderItems, orderStatusHistory, orders } from "@/server/db/schema";

/**
 * Pure seams first: the two folds `cancelOrder` is built out of, tested away
 * from any fake. `planQuotaRelease` exists so two order lines for the same
 * session product release its quota ONCE (spec §4.3), and `composeCancelNote`
 * so the note that lands in `order_status_history` is spelled in exactly one
 * place — Task 9's admin cancel passes no cause, Task 10's sync passes the
 * Jubelio 404 as one.
 */
describe("planQuotaRelease", () => {
  it("sums two lines for the same session product", () => {
    expect(
      planQuotaRelease([
        { sessionProductId: "sp1", qty: 2 },
        { sessionProductId: "sp2", qty: 1 },
        { sessionProductId: "sp1", qty: 3 },
      ]),
    ).toEqual([
      { sessionProductId: "sp1", qty: 5 },
      { sessionProductId: "sp2", qty: 1 },
    ]);
  });

  it("drops lines that would release nothing", () => {
    expect(planQuotaRelease([{ sessionProductId: "sp1", qty: 0 }])).toEqual([]);
  });
});

describe("composeCancelNote", () => {
  it("keeps both facts in the note, and the quota line alone when there is no cause", () => {
    expect(composeCancelNote("SO #192626 dihapus di Jubelio", 2)).toBe(
      "SO #192626 dihapus di Jubelio — 2 unit kembali ke kuota sesi",
    );
    expect(composeCancelNote(null, 1)).toBe("1 unit kembali ke kuota sesi");
    expect(composeCancelNote(null, 0)).toBeNull();
  });

  it("keeps a cause even when there is nothing to release", () => {
    // A sync cancel of an order whose quota an admin already truncated must
    // still record WHY it was cancelled — dropping the cause here would leave
    // the dialog with no evidence at all.
    expect(composeCancelNote("SO #192626 dihapus di Jubelio", 0)).toBe(
      "SO #192626 dihapus di Jubelio",
    );
  });
});

type Kind =
  | "select-order"
  | "select-items"
  | "update-order"
  | "update-product"
  | "insert-history";
type Captured = { kind: Kind; arg?: unknown };

/**
 * Fake `tx` (the `booking-id.test.ts` seam, extended) that records EVERY
 * statement the transition emits, in order. The two selects are distinguished
 * by the table handed to `from`; the updates capture both their `value` and
 * their `cond`, and the insert captures its table, so the tests can read the
 * SQL that was actually built — a fake that dropped an argument could not
 * prove it. `flipped: 0` is how a lost race is simulated.
 */
function makeDb(opts: {
  order?: { id: string; status: string } | undefined;
  items?: { sessionProductId: string; qty: number }[];
  flipped?: number; // rows the guarded status UPDATE returns
}) {
  const calls: Captured[] = [];
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          const items = table === orderItems;
          calls.push({ kind: items ? "select-items" : "select-order" });
          if (items) return opts.items ?? [];
          return opts.order ? [opts.order] : [];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => ({
        // Recorded at `where`, not at `returning`: the quota UPDATE is awaited
        // with no `.returning()`, the status UPDATE reads its flipped rows back,
        // and both must be captured. Hence an awaitable that also chains.
        where: (cond: unknown) => {
          calls.push({
            kind: table === orders ? "update-order" : "update-product",
            arg: { value, cond },
          });
          const rows = Array.from(
            { length: table === orders ? (opts.flipped ?? 1) : 1 },
            () => ({ id: "o1" }),
          );
          return Object.assign(Promise.resolve(rows), {
            returning: async () => rows,
          });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (row: unknown) => {
        calls.push({ kind: "insert-history", arg: { table, row } });
        return [row];
      },
    }),
  };
  const writes = () =>
    calls.filter((c) => c.kind !== "select-order" && c.kind !== "select-items");
  return {
    db: {
      transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    } as never,
    calls,
    writes,
  };
}

const dialect = new PgDialect();

describe("cancelOrder", () => {
  it("flips the status, releases quota per line and writes one history row, in one transaction", async () => {
    const { db, calls } = makeDb({
      order: { id: "o1", status: "UNPAID" },
      items: [
        { sessionProductId: "sp1", qty: 2 },
        { sessionProductId: "sp1", qty: 1 },
      ],
    });
    const res = await cancelOrder(db, {
      orderId: "o1",
      source: "admin",
      actorUserId: "u1",
    });
    expect(res).toEqual({
      cancelled: true,
      fromStatus: "UNPAID",
      releasedUnits: 3,
    });
    expect(calls.filter((c) => c.kind === "update-product")).toHaveLength(1); // summed, one UPDATE
    expect(calls.filter((c) => c.kind === "insert-history")).toHaveLength(1);
  });

  it("clamps the release at zero with GREATEST, never a negative claimed", async () => {
    const { db, calls } = makeDb({
      order: { id: "o1", status: "CONFIRMED" },
      items: [{ sessionProductId: "sp1", qty: 9 }],
    });
    await cancelOrder(db, {
      orderId: "o1",
      source: "sync",
      note: "SO #86 dihapus di Jubelio",
    });
    const captured = calls.find((c) => c.kind === "update-product")?.arg as {
      value: { claimed: SQL };
    };
    const q = dialect.sqlToQuery(captured.value.claimed);
    expect(q.sql).toContain("GREATEST(");
    expect(q.sql).toContain("- ");
    expect(q.params).toEqual([9]); // the 0 floor is literal SQL, not a parameter
  });

  it("guards the flip against the end states, so a second cancel releases nothing", async () => {
    // The pre-check passed (the row reads UNPAID); the guarded UPDATE is what
    // loses the race here, which is why zero rows come back.
    const { db, calls } = makeDb({
      order: { id: "o1", status: "UNPAID" },
      items: [{ sessionProductId: "sp1", qty: 2 }],
      flipped: 0,
    });
    expect(await cancelOrder(db, { orderId: "o1", source: "sync" })).toEqual({
      cancelled: false,
      reason: "already-ended",
    });
    expect(calls.filter((c) => c.kind === "update-product")).toHaveLength(0);
    expect(calls.filter((c) => c.kind === "insert-history")).toHaveLength(0);
    const captured = calls.find((c) => c.kind === "update-order")?.arg as {
      cond: SQL;
    };
    const q = dialect.sqlToQuery(captured.cond);
    expect(q.sql).toMatch(/not in/i);
    expect(q.params).toEqual(["o1", "COMPLETED", "CANCEL"]);
  });

  it("reports an unknown order without writing anything", async () => {
    const { db, writes } = makeDb({ order: undefined });
    expect(await cancelOrder(db, { orderId: "nope", source: "admin" })).toEqual(
      { cancelled: false, reason: "not-found" },
    );
    expect(writes()).toEqual([]); // the selects ran, no UPDATE, no INSERT
  });

  it("refuses to cancel an order that is already in an end state", async () => {
    const { db } = makeDb({
      order: { id: "o1", status: "COMPLETED" },
      items: [],
    });
    expect(await cancelOrder(db, { orderId: "o1", source: "admin" })).toEqual({
      cancelled: false,
      reason: "already-ended",
    });
  });

  it("sets the status and nothing else, so the SO link survives the cancel", async () => {
    // `toEqual` is the point: an extra key — a nulled `jubelioSoId`,
    // `trackingNumber` or `shipper` — fails this, and spec §4.3 says the
    // evidence the dialog shows must stay on the row.
    const { db, calls } = makeDb({
      order: { id: "o1", status: "CONFIRMED" },
      items: [],
    });
    await cancelOrder(db, { orderId: "o1", source: "sync" });
    const captured = calls.find((c) => c.kind === "update-order")?.arg as {
      value: unknown;
    };
    expect(captured.value).toEqual({ status: "CANCEL" });
  });

  it("writes one history row that names the pre-cancel status and the composed note", async () => {
    const { db, calls } = makeDb({
      order: { id: "o1", status: "CONFIRMED" },
      items: [{ sessionProductId: "sp1", qty: 2 }],
    });
    await cancelOrder(db, {
      orderId: "o1",
      source: "sync",
      note: "SO #192626 dihapus di Jubelio",
    });
    const history = calls.filter((c) => c.kind === "insert-history");
    expect(history).toHaveLength(1);
    expect(history[0]?.arg).toEqual({
      table: orderStatusHistory,
      row: {
        orderId: "o1",
        fromStatus: "CONFIRMED",
        toStatus: "CANCEL",
        source: "sync",
        actorUserId: null,
        note: "SO #192626 dihapus di Jubelio — 2 unit kembali ke kuota sesi",
      },
    });
  });
});
