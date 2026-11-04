/**
 * Pure edit-window rules for session products — the testable seam of the
 * product API routes. No db, no auth, no Jubelio: the routes own fetching,
 * this module owns the decisions (spec §5.9 relaxation, design Rulings 1 + 2).
 *
 * Background: product config used to be frozen the moment a session left
 * SCHEDULED, so a typo found during a live sale forced killing and recreating
 * the whole session. Placed orders are safe to edit around because
 * `order_item` snapshots price/sku/name per line — a change only affects
 * future carts — which is what makes the ACTIVE/PAUSED window editable at all.
 */

/** Statuses whose products an admin may still change (Ruling: live = ACTIVE/PAUSED). */
const EDITABLE_SESSION_STATUSES = ["SCHEDULED", "ACTIVE", "PAUSED"] as const;

/**
 * Whether session products can be added / edited / hidden in `status`.
 * `ENDED` (and anything unknown) stays frozen — a finished sale is a record.
 */
export function canEditProducts(status: string): boolean {
  return (EDITABLE_SESSION_STATUSES as readonly string[]).includes(status);
}

/** What a products-POST re-add should do with one picked item. */
export type ReAddAction = "insert" | "upsert" | "unhide_only";

/**
 * Decide how POST handles a picked item given the session status and whether a
 * `session_product` row already exists for it (`existing` — pass the row, or
 * `undefined` when there is none).
 *
 * - no row → `"insert"` (fresh items in a live session take the normal import
 *   path: derived quota, price defaults, snapshot).
 * - row + ACTIVE/PAUSED → `"unhide_only"` (Ruling 1): the upsert resets
 *   `flashPrice → originalPrice`, `minOrder → 1`, `category → ""` and
 *   re-derives quota from the stock map, which would silently overwrite the
 *   live sale's config mid-session. Re-adding only clears the `hidden` flag.
 * - row + SCHEDULED → `"upsert"`, i.e. today's reset semantics.
 *
 * Callers must gate on {@link canEditProducts} first: this function only picks
 * the write shape for statuses whose products are editable, so an `ENDED`
 * session falls through to `"upsert"` here rather than being rejected.
 */
export function reAddDecision(status: string, existing: unknown): ReAddAction {
  if (!existing) return "insert";
  if (status === "ACTIVE" || status === "PAUSED") return "unhide_only";
  return "upsert";
}

/** Inputs for one `sessionQuota` PUT (spec §4.3 admin override). */
export type QuotaUpdateInput = {
  /** Units already sold — the quota can never go below this. */
  claimed: number;
  /** The quota the admin asked for. */
  requestedQuota: number;
  /**
   * Live `available` from the cached v2 stock map for this item.
   * `null`/`undefined` means unknown: a map miss, or v2 failed outright.
   */
  liveStock: number | null | undefined;
};

/**
 * `{ ok: false, floor }` when the ask is below what is already sold; otherwise
 * the values the route writes. `jubelioStock: null` means "don't overwrite the
 * stored snapshot".
 */
export type QuotaUpdateDecision =
  | { ok: true; jubelioStock: number | null; warnUnknownStock: boolean }
  | { ok: false; floor: number };

/**
 * Validate a quota change and decide what to do with the `jubelio_stock`
 * snapshot it rides on.
 *
 * - Floor first: `requestedQuota < claimed` → reject, naming `claimed` so the
 *   route can say "Minimal N (sudah terjual)". Sold units are history, so this
 *   holds regardless of what the stock map currently thinks — checked BEFORE
 *   the stock branch.
 * - Live number → refresh `jubelioStock` to it (Ruling 2). Checkout validates
 *   against the stored snapshot, so a raised quota must not leave the snapshot
 *   below it — the refresh is what keeps the two coherent.
 * - Unknown (`null`/`undefined`) → allow the edit anyway with
 *   `jubelioStock: null` and `warnUnknownStock: true`. The caller keeps the
 *   prior snapshot (missing ≠ empty: a v2 outage must not zero a live number)
 *   and warns the admin "stok belum tentu" — unknown ≠ zero, same rule the
 *   picker's "—" cell uses.
 */
export function quotaUpdateDecision(
  input: QuotaUpdateInput,
): QuotaUpdateDecision {
  if (input.requestedQuota < input.claimed) {
    return { ok: false, floor: input.claimed };
  }

  if (input.liveStock === null || input.liveStock === undefined) {
    return { ok: true, jubelioStock: null, warnUnknownStock: true };
  }

  return { ok: true, jubelioStock: input.liveStock, warnUnknownStock: false };
}
