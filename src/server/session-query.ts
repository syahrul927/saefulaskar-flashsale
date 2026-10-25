import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { cache } from "react";

import { flashSessions, sessionProducts } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";

/**
 * The subset of the drizzle client these read helpers need — a `select`
 * builder only, so tests can pass a mock (see tests/session-query.test.ts).
 */
export type SessionDbLike = Pick<PostgresJsDatabase<typeof schema>, "select">;

/**
 * Earliest-created ACTIVE session, or `null` when none is active.
 *
 * Same filter + ordering the storefront uses (`src/app/(storefront)/page.tsx`),
 * so the admin header pill always describes the session customers are seeing —
 * even if bad data leaves more than one row ACTIVE.
 *
 * Wrapped in React `cache()`: the storefront layout (cart drawer checkout) and
 * the storefront page both ask for this row during one request, and they pass
 * the same `db` singleton, so the identical query runs once per request.
 */
export const getPrimaryActiveSession = cache(
  async (
    db: SessionDbLike,
  ): Promise<typeof flashSessions.$inferSelect | null> => {
    const [session] = await db
      .select()
      .from(flashSessions)
      .where(eq(flashSessions.status, "ACTIVE"))
      .orderBy(flashSessions.createdAt);

    return session ?? null;
  },
);

export type SessionKpis = {
  productCount: number;
  totalQuota: number;
  totalClaimed: number;
  estimatedGmv: number;
};

/**
 * KPI tiles for the primary ACTIVE session: one pass over its `sessionProducts`
 * rows. `estimatedGmv` is `Σ flashPrice × claimed` — revenue already reserved,
 * not quota at full price.
 *
 * Returns `null` when there is no ACTIVE session so the caller can hide the
 * tile row entirely instead of rendering a wall of zeros.
 */
export async function getSessionKpis(
  db: SessionDbLike,
): Promise<SessionKpis | null> {
  const session = await getPrimaryActiveSession(db);
  if (!session) return null;

  const products = await db
    .select()
    .from(sessionProducts)
    .where(eq(sessionProducts.sessionId, session.id));

  return products.reduce<SessionKpis>(
    (kpi, product) => ({
      productCount: kpi.productCount + 1,
      totalQuota: kpi.totalQuota + product.sessionQuota,
      totalClaimed: kpi.totalClaimed + product.claimed,
      estimatedGmv: kpi.estimatedGmv + product.flashPrice * product.claimed,
    }),
    { productCount: 0, totalQuota: 0, totalClaimed: 0, estimatedGmv: 0 },
  );
}
