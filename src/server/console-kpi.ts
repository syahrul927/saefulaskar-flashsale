import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sum,
} from "drizzle-orm";

import { flashSessions, orders, sessionProducts } from "@/server/db/schema";
import {
  getPrimaryActiveSession,
  type SessionDbLike,
} from "@/server/session-query";

/**
 * Console-wide KPI source (spec decision 5): numbers that span sessions —
 * payment backlog, GMV per WIB day, live/next session, quota across the
 * active pipeline. Read-only `select` helpers, same shape as
 * `session-query.ts` so tests can pass a mock.
 */

export type GlobalKpis = {
  unpaidWithProof: number;
  unpaidTotal: number;
  gmvToday: number;
  gmvYesterday: number;
  activeSession: { id: string; name: string } | null;
  nextScheduled: { id: string; name: string; startTime: Date | null } | null;
  totalQuota: number;
  totalClaimed: number;
};

const WIB_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Start (inclusive) and end (exclusive) of the WIB calendar day containing
 * `now`, as UTC instants. WIB is a fixed UTC+7 offset — Asia/Jakarta has no
 * DST, so plain epoch math is correct year-round. The 17:00Z seam instant
 * belongs to the NEW day.
 */
export function wibDayBounds(now: Date): { start: Date; end: Date } {
  const t = now.getTime();
  const startMs = t - ((t + WIB_OFFSET_MS) % DAY_MS);
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

/**
 * Hint line under the GMV tile. Signed percent vs yesterday; zero-baseline
 * cases get honest copy instead of `Infinity%` or a misleading `+0%`.
 */
export function formatGmvDelta(today: number, yesterday: number): string {
  if (yesterday === 0) {
    return today > 0 ? "baru vs kemarin" : "— vs kemarin";
  }
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  return `${pct > 0 ? "+" : ""}${pct}% vs kemarin`;
}

/** Money statuses — GMV counts reserved/paid revenue, never UNPAID holds.
 *  `CANCEL` is deliberately absent: a cancelled order is not revenue we kept. */
const GMV_STATUSES = ["CONFIRMED", "SHIPPED", "COMPLETED"] as const;

function sumGmv(
  rows: { total: string | null }[],
): number {
  return Number(rows[0]?.total ?? 0);
}

/**
 * One pass of parallel queries for the console's "Ringkasan" row. `now` is
 * injectable so the WIB day seam is testable; production callers omit it.
 */
export async function getGlobalKpis(
  db: SessionDbLike,
  now: Date = new Date(),
): Promise<GlobalKpis> {
  const { start, end } = wibDayBounds(now);
  const yStart = new Date(start.getTime() - DAY_MS);

  const [
    [unpaidTotal],
    [unpaidWithProof],
    gmvTodayRows,
    gmvYesterdayRows,
    session,
    [next],
    upcoming,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(orders)
      .where(eq(orders.status, "UNPAID")),
    db
      .select({ n: count() })
      .from(orders)
      .where(
        and(
          eq(orders.status, "UNPAID"),
          isNotNull(orders.transferProofUrl),
        ),
      ),
    db
      .select({ total: sum(orders.grandTotal) })
      .from(orders)
      .where(
        and(
          inArray(orders.status, [...GMV_STATUSES]),
          gte(orders.createdAt, start),
          lt(orders.createdAt, end),
        ),
      ),
    db
      .select({ total: sum(orders.grandTotal) })
      .from(orders)
      .where(
        and(
          inArray(orders.status, [...GMV_STATUSES]),
          gte(orders.createdAt, yStart),
          lt(orders.createdAt, start),
        ),
      ),
    getPrimaryActiveSession(db),
    // Nothing auto-transitions SCHEDULED → ACTIVE (spec non-goal), so a sale
    // whose start time passed keeps the status forever; without a lower
    // bound it would sort first and the tile would promise "berikutnya"
    // for a sale that already went by (final review I-2). Rows with no
    // startTime stay — they genuinely are unrun, and the tile's "—" guard
    // renders them honestly.
    db
      .select({
        id: flashSessions.id,
        name: flashSessions.name,
        startTime: flashSessions.startTime,
      })
      .from(flashSessions)
      .where(
        and(
          eq(flashSessions.status, "SCHEDULED"),
          or(
            isNull(flashSessions.startTime),
            gte(flashSessions.startTime, now),
          ),
        ),
      )
      .orderBy(asc(flashSessions.startTime))
      .limit(1),
    db
      .select({ id: flashSessions.id })
      .from(flashSessions)
      .where(inArray(flashSessions.status, ["ACTIVE", "SCHEDULED"])),
  ]);

  // Quota/claimed span the live + upcoming pipeline: two steps (ids, then
  // one aggregate over their products) to keep it join-free like the rest.
  const ids = upcoming.map((s) => s.id);
  let totalQuota = 0;
  let totalClaimed = 0;
  if (ids.length > 0) {
    const [agg] = await db
      .select({
        quota: sum(sessionProducts.sessionQuota),
        claimed: sum(sessionProducts.claimed),
      })
      .from(sessionProducts)
      .where(inArray(sessionProducts.sessionId, ids));
    totalQuota = Number(agg?.quota ?? 0);
    totalClaimed = Number(agg?.claimed ?? 0);
  }

  return {
    unpaidWithProof: unpaidWithProof?.n ?? 0,
    unpaidTotal: unpaidTotal?.n ?? 0,
    gmvToday: sumGmv(gmvTodayRows),
    gmvYesterday: sumGmv(gmvYesterdayRows),
    activeSession: session ? { id: session.id, name: session.name } : null,
    nextScheduled: next ?? null,
    totalQuota,
    totalClaimed,
  };
}
