import { describe, expect, it, vi } from "vitest";

import { listStatusHistory, recordStatusChange } from "@/server/status-history";
import type { StatusHistoryEntry } from "@/server/status-history";

/**
 * Injection, not module mocking — the repo's only db-fake precedent is
 * `tests/booking-id.test.ts`. The writer fake just records the rows handed to
 * `values`, so these tests prove `recordStatusChange` writes exactly its
 * entry: no invented rows, no extra columns, no status logic of its own.
 */
function makeWriter() {
  const inserted: unknown[] = [];
  const db = {
    insert: (_table: unknown) => ({
      values: async (row: unknown) => {
        inserted.push(row);
        return [row];
      },
    }),
  } as never;
  return { db, inserted };
}

/**
 * Reader fake for the `select().from().leftJoin().where().orderBy()` chain
 * `listStatusHistory` builds. `select` is a spy so a test can prove an empty
 * id list issues NO query at all, instead of only checking the returned Map.
 */
function makeReader(rows: unknown[]) {
  const select = vi.fn(() => ({
    from: () => ({
      leftJoin: () => ({
        where: () => ({
          orderBy: async () => rows,
        }),
      }),
    }),
  }));
  const db = { select } as never;
  return { db, select };
}

type Row = StatusHistoryEntry & { orderId: string };

const t1 = new Date("2026-11-01T01:00:00.000Z");
const t2 = new Date("2026-11-01T02:00:00.000Z");
const t3 = new Date("2026-11-01T03:00:00.000Z");

describe("recordStatusChange", () => {
  it("writes exactly the entry it is given, and nothing else", async () => {
    const { db, inserted } = makeWriter();
    await recordStatusChange(db, {
      orderId: "o1",
      fromStatus: "UNPAID",
      toStatus: "CONFIRMED",
      source: "admin",
      actorUserId: "u1",
      note: "SO #192626 dibuat",
    });
    expect(inserted).toEqual([
      {
        orderId: "o1",
        fromStatus: "UNPAID",
        toStatus: "CONFIRMED",
        source: "admin",
        actorUserId: "u1",
        note: "SO #192626 dibuat",
      },
    ]);
  });

  it("defaults the actor and note to null, so a checkout row claims no person", async () => {
    const { db, inserted } = makeWriter();
    await recordStatusChange(db, {
      orderId: "o1",
      fromStatus: null,
      toStatus: "UNPAID",
      source: "checkout",
    });
    expect(inserted[0]).toMatchObject({
      actorUserId: null,
      note: null,
      fromStatus: null,
    });
  });
});

describe("listStatusHistory", () => {
  it("returns an empty Map WITHOUT issuing a query for an empty id list", async () => {
    const { db, select } = makeReader([]);
    const result = await listStatusHistory(db, []);
    expect(result.size).toBe(0);
    // The guard is the point: `inArray(col, [])` would still hit Postgres.
    expect(select).not.toHaveBeenCalled();
  });

  it("groups per order and preserves the ascending created_at order it got back", async () => {
    // The SQL returns one flat list ordered by createdAt ASC, interleaved
    // across orders; the seam must bucket it without re-sorting or losing
    // order — `db` is typed generically only where the fake needs it.
    const rows: Row[] = [
      {
        id: "h1",
        orderId: "o1",
        fromStatus: null,
        toStatus: "UNPAID",
        source: "checkout",
        actorName: null,
        note: null,
        createdAt: t1,
      },
      {
        id: "h2",
        orderId: "o2",
        fromStatus: null,
        toStatus: "UNPAID",
        source: "checkout",
        actorName: "",
        note: null,
        createdAt: t2,
      },
      {
        id: "h3",
        orderId: "o1",
        fromStatus: "UNPAID",
        toStatus: "CANCEL",
        source: "admin",
        actorName: "Syahrul",
        note: "cancelled by admin",
        createdAt: t3,
      },
    ];
    const { db, select } = makeReader(rows);
    const result = await listStatusHistory(db, ["o1", "o2"]);

    expect(select).toHaveBeenCalledTimes(1);
    expect([...result.keys()]).toEqual(["o1", "o2"]);

    // toEqual is exact: it fails if `orderId` leaks into the entries or if
    // h3 lands before h1 — grouping AND order are asserted together.
    const o1: StatusHistoryEntry[] | undefined = result.get("o1");
    const o2: StatusHistoryEntry[] | undefined = result.get("o2");
    expect(o1).toEqual([
      {
        id: "h1",
        fromStatus: null,
        toStatus: "UNPAID",
        source: "checkout",
        actorName: null,
        note: null,
        createdAt: t1,
      },
      {
        id: "h3",
        fromStatus: "UNPAID",
        toStatus: "CANCEL",
        source: "admin",
        actorName: "Syahrul",
        note: "cancelled by admin",
        createdAt: t3,
      },
    ]);
    expect(o2).toEqual([
      {
        id: "h2",
        fromStatus: null,
        toStatus: "UNPAID",
        source: "checkout",
        actorName: "",
        note: null,
        createdAt: t2,
      },
    ]);
  });
});
