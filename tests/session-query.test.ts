import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  getPrimaryActiveSession,
  getSessionKpis,
  type SessionDbLike,
} from "@/server/session-query";
import { flashSessions, sessionProducts } from "@/server/db/schema";

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

/**
 * Query arguments the helper actually passed to drizzle, so the tests can pin
 * the SQL-side rule (filter/order) that the pre-sorted fixtures alone can't see.
 */
type CapturedQuery = {
  where: { table: unknown; cond: unknown }[];
  orderBy: unknown[];
};

function makeCapturedQuery(): CapturedQuery {
  return { where: [], orderBy: [] };
}

const dialect = new PgDialect();

/** Renders a captured condition/column back to SQL for comparison. */
function toQuery(value: unknown) {
  return dialect.sqlToQuery(value as never);
}

/**
 * Minimal db mock: `select().from(table).where()` returns that table's fixture
 * rows. `WHERE`/`ORDER BY` run in SQL, so fixtures are already filtered/ordered
 * the way the database would hand them back — which is why the `where`/`orderBy`
 * arguments are also captured into `captured` and asserted by the tests below.
 * The returned builder is both awaitable and `.orderBy()`-chainable, matching
 * drizzle's thenable builders.
 */
function makeDbMock(
  tables: { sessions?: SessionRow[]; products?: ProductRow[] } = {},
  captured: CapturedQuery = makeCapturedQuery(),
): SessionDbLike {
  const query = (rows: unknown[]) => {
    const promise = Promise.resolve(rows);
    return Object.assign(promise, {
      orderBy: (...columns: unknown[]) => {
        captured.orderBy.push(...columns);
        return promise;
      },
    });
  };
  const sel = {
    from: (table: unknown) => ({
      where: (cond: unknown) => {
        captured.where.push({ table, cond });
        return query(
          table === flashSessions
            ? (tables.sessions ?? [])
            : table === sessionProducts
              ? (tables.products ?? [])
              : [],
        );
      },
    }),
  };
  return { select: () => sel } as unknown as SessionDbLike;
}

/** The SQL of every `where` condition issued against `table`. */
function predicatesFor(captured: CapturedQuery, table: unknown) {
  return captured.where
    .filter((entry) => entry.table === table)
    .map((entry) => toQuery(entry.cond));
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

  it("queries status = ACTIVE ordered by createdAt ascending (storefront parity)", async () => {
    const captured = makeCapturedQuery();
    const db = makeDbMock(
      { sessions: [OLDER_ACTIVE, NEWER_ACTIVE, SCHEDULED] },
      captured,
    );
    await getPrimaryActiveSession(db);

    // Exactly one predicate, and it is the ACTIVE filter on the session
    // status column — flipping it to "PAUSED", another status or another
    // column changes the rendered SQL/params. Both sides are rendered through
    // the same dialect, so the right-hand side is the reference query.
    expect(predicatesFor(captured, flashSessions)).toEqual([
      toQuery(eq(flashSessions.status, "ACTIVE")),
    ]);
    // Identity, not just the column name: `desc(createdAt)`/`asc(createdAt)`
    // wrap the column in a SQL object and `startTime` is a different column.
    expect(captured.orderBy).toHaveLength(1);
    expect(captured.orderBy[0]).toBe(flashSessions.createdAt);
  });

  it("returns null when no ACTIVE session exists", async () => {
    const db = makeDbMock({ sessions: [] });
    await expect(getPrimaryActiveSession(db)).resolves.toBeNull();
  });
});

describe("getSessionKpis", () => {
  it("aggregates product count, quota, claimed and estimated GMV", async () => {
    const captured = makeCapturedQuery();
    const db = makeDbMock(
      {
        sessions: [OLDER_ACTIVE, NEWER_ACTIVE, SCHEDULED],
        products: PRODUCTS,
      },
      captured,
    );
    await expect(getSessionKpis(db)).resolves.toEqual({
      productCount: 2,
      totalQuota: 75,
      totalClaimed: 4,
      estimatedGmv: 85000 * 3 + 159000,
    });

    // The aggregation is scoped to the primary session's id via session_id —
    // a stale/hard-coded id or a different column fails here.
    expect(predicatesFor(captured, sessionProducts)).toEqual([
      toQuery(eq(sessionProducts.sessionId, OLDER_ACTIVE.id)),
    ]);
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
