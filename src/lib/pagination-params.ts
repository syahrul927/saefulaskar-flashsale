/**
 * Cursor-pagination request parsing shared by the three paginated surfaces
 * (GET /api/orders, /admin/orders, /admin/jubelio). Each surface owns its
 * cursor *field*; this helper only validates the transport-level shape so a
 * hostile or broken `?cursor=` / `?limit=` can never reach the query as NaN,
 * a negative number, or an invalid date — those became raw 500s.
 */

/** Hard page-size bounds, agreed with the spec (default 20, max 100). */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** A `?limit` that is missing, non-numeric, or out of bounds falls back to
 * defaults instead of poisoning the query — pagination is a viewer
 * convenience, never a crash vector. */
export function parsePageLimit(raw: string | string[] | undefined): number {
  if (typeof raw !== "string") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

/** A cursor is valid when it parses to a finite Date (ISO string on the
 * orders surfaces). Garbage falls back to page 1 — the viewer loses their
 * place, not the page. */
export function parseTimestampCursor(
  raw: string | string[] | undefined,
): Date | undefined {
  if (typeof raw !== "string") return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
