import type { StockMap } from "@/server/jubelio-catalog";

/**
 * Pure backfill decision for `POST /api/cron/backfill-images` — the seam,
 * tested in `tests/backfill-images.test.ts` (same style as daily-sync's
 * `planSync`). Given the rows that still have no photo and the v2 stock map,
 * return the patches: one per row whose `itemId` carries a thumbnail.
 * A v2 entry without a picture, or an item absent from v2, gets NOTHING —
 * missing ≠ empty, no fabricated URLs, and rows stay eligible for a later
 * run (the route only selects `image_url IS NULL`, so this is idempotent).
 */
export function planImageBackfill(
  rows: { id: string; itemId: number }[],
  map: StockMap,
): { id: string; imageUrl: string }[] {
  const patches: { id: string; imageUrl: string }[] = [];
  for (const row of rows) {
    const image = map.get(row.itemId)?.image;
    if (image) patches.push({ id: row.id, imageUrl: image });
  }
  return patches;
}
