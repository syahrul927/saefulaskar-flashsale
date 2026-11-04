import type { SessionProduct } from "@/app/_components/product-picker";
import type { sessionProducts } from "@/server/db/schema";
import type { StockMap } from "@/server/jubelio-catalog";

/**
 * Pure roster join for the admin products page: `sessionProducts` rows (the
 * full drizzle row the page selects) + the cached v2 `StockMap` →
 * `SessionProduct[]` for `<ProductPicker>`.
 *
 * The `StockMap` is the single source of truth for the roster's stock column
 * and its thumbnails, exactly as it is for the picker search rows
 * (`mergeStockIntoRows`) and for `GET /api/sessions/[id]/products` — one
 * 60 s-TTL fetch shared by all three, so every admin surface shows the same
 * dashboard-current numbers. The `jubelio_stock` snapshot column (persisted at
 * import) is deliberately NOT read here: on the roster a stale number is
 * worse than no number, because the admin can act on it.
 */

/** Row shape the roster page selects today: `sessionProducts` in full. */
export type RosterDbRow = typeof sessionProducts.$inferSelect;

/**
 * Map DB rows to picker products, joining `availableStock` + `image` from the
 * v2 map by `itemId`. Never drops or reorders a row, so a partial v2 payload
 * still lists the whole roster. `map === null` (v2 failed, or no session to
 * build a client from) and an itemId absent from the map both yield
 * `availableStock: null, image: null` — unknown renders "—" / the letter tile,
 * never `0`. A map hit always beats the stale `jubelioStock` snapshot. Input
 * rows are not mutated.
 */
export function rosterProducts(
  rows: RosterDbRow[],
  map: StockMap | null,
): SessionProduct[] {
  return rows.map((row) => {
    const entry = map?.get(row.itemId);
    return {
      id: row.id,
      itemId: row.itemId,
      skuCode: row.skuCode,
      itemGroupName: row.itemGroupName,
      originalPrice: row.originalPrice,
      sessionQuota: row.sessionQuota,
      claimed: row.claimed,
      minOrder: row.minOrder,
      flashPrice: row.flashPrice,
      category: row.category,
      type: row.type,
      // Mid-session removal is this flag (Task 2/4): the roster keeps hidden
      // rows so the admin can re-show them; the storefront drops them.
      hidden: row.hidden,
      availableStock: entry?.available ?? null,
      image: entry?.image ?? null,
    };
  });
}
