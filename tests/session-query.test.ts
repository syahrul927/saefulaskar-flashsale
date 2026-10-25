import { describe, expect, it } from "vitest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  getPrimaryActiveSession,
  getSessionKpis,
} from "@/server/session-query";
import { flashSessions, sessionProducts } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";

type SessionStatus = "SCHEDULED" | "ACTIVE" | "PAUSED" | "ENDED";

type SessionRow = {
  id: string;
  status: SessionStatus;
  createdAt: Date;
};

type ProductRow = {
  id: string;
  flashPrice: number;
  claimed: number;
  sessionQuota: number;
};

type SessionDb = Pick<PostgresJsDatabase<typeof schema>, "select">;

/**
 * Minimal db mock: `select().from(table).where()` returns that table's fixture
 * rows. `WHERE`/`ORDER BY` run in SQL, so fixtures are already filtered/ordered
 * the way the database would hand them back. The returned builder is both
 * awaitable and `.orderBy()`-chainable, matching drizzle's thenable builders.
 */
function makeDbMock(
  tables: { sessions?: SessionRow[]; products?: ProductRow[] } = {},
): SessionDb {
  const query = (rows: unknown[]) => {
    const promise = Promise.resolve(rows);
    return Object.assign(promise, { orderBy: () => promise });
  };
  const sel = {
    from: (table: unknown) => ({
      where: () =>
        query(
          table === flashSessions
            ? (tables.sessions ?? [])
            : table === sessionProducts
              ? (tables.products ?? [])
              : [],
        ),
    }),
  };
  return { select: () => sel } as unknown as SessionDb;
}

const OLDER_ACTIVE: SessionRow = {
  id: "s-older",
  status: "ACTIVE",
  createdAt: new Date("2026-10-24T09:00:00.000Z"),
};
const NEWER_ACTIVE: SessionRow = {
  id: "s-newer",
  status: "ACTIVE",
  createdAt: new Date("2026-10-25T09:00:00.000Z"),
};
const SCHEDULED: SessionRow = {
  id: "s-scheduled",
  status: "SCHEDULED",
  createdAt: new Date("2026-10-23T09:00:00.000Z"),
};

const PRODUCTS: ProductRow[] = [
  { id: "p-1", flashPrice: 85000, claimed: 3, sessionQuota: 50 },
  { id: "p-2", flashPrice: 159000, claimed: 1, sessionQuota: 25 },
];

describe("getPrimaryActiveSession", () => {
  it("returns the earliest-created ACTIVE session", async () => {
    const db = makeDbMock({
      sessions: [OLDER_ACTIVE, NEWER_ACTIVE, SCHEDULED],
    });
    await expect(getPrimaryActiveSession(db)).resolves.toEqual(OLDER_ACTIVE);
  });

  it("returns null when no ACTIVE session exists", async () => {
    const db = makeDbMock({ sessions: [] });
    await expect(getPrimaryActiveSession(db)).resolves.toBeNull();
  });
});

describe("getSessionKpis", () => {
  it("aggregates product count, quota, claimed and estimated GMV", async () => {
    const db = makeDbMock({
      sessions: [OLDER_ACTIVE, NEWER_ACTIVE, SCHEDULED],
      products: PRODUCTS,
    });
    await expect(getSessionKpis(db)).resolves.toEqual({
      productCount: 2,
      totalQuota: 75,
      totalClaimed: 4,
      estimatedGmv: 85000 * 3 + 159000,
    });
  });

  it("returns zeroed KPIs when the ACTIVE session has no products", async () => {
    const db = makeDbMock({ sessions: [OLDER_ACTIVE], products: [] });
    await expect(getSessionKpis(db)).resolves.toEqual({
      productCount: 0,
      totalQuota: 0,
      totalClaimed: 0,
      estimatedGmv: 0,
    });
  });

  it("returns null when no ACTIVE session exists (tiles hide)", async () => {
    const db = makeDbMock({ sessions: [], products: PRODUCTS });
    await expect(getSessionKpis(db)).resolves.toBeNull();
  });
});
