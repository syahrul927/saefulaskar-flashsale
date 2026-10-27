import type { StockEntry } from "@/lib/jubelio";

/**
 * Pure import decision for one picked row — the testable seam of the POST
 * guard. Lives in `src/server` (not the route file) because Next's route
 * contract forbids extra exports on `route.ts` modules; the route imports it.
 * 1. v2 `entry` present → raw `available` as stock; quota floors negatives at
 *    0 and caps at 20 (v2 has 4 negative-available SKUs, min −14 — a negative
 *    quota could never be repaired by PUT's `positive()` schema, while the
 *    raw negative stays true to the ERP: gate ≤0 already means sold out).
 *    The `thumbnail` rides along: a fresh URL refreshes the stored photo, a
 *    null thumbnail keeps the previous one (missing ≠ empty — a v2 response
 *    without a picture must never blank a photo the customer is looking at).
 * 2. no entry, `existing` row → keep ALL previous values (stock, quota,
 *    image): a v2 outage must not zero a live number, clobber admin quota
 *    edits, or drop a photo (missing ≠ empty).
 * 3. no entry, no existing → `null` = skip: a brand-new row with no ERP
 *    number is blocked from import (partner ruling).
 */
export function resolveImportRow(
  entry: StockEntry | undefined,
  existing:
    | { jubelioStock: number; sessionQuota: number; imageUrl: string | null }
    | undefined,
): ResolvedImport | null {
  if (entry) {
    return {
      jubelioStock: entry.available,
      sessionQuota: Math.max(0, Math.min(20, entry.available)),
      imageUrl: entry.image ?? existing?.imageUrl ?? null,
    };
  }
  if (existing) {
    return {
      jubelioStock: existing.jubelioStock,
      sessionQuota: existing.sessionQuota,
      imageUrl: existing.imageUrl,
    };
  }
  return null;
}

/** What one import row persists for stock/quota/image (see `resolveImportRow`). */
export type ResolvedImport = {
  jubelioStock: number;
  sessionQuota: number;
  imageUrl: string | null;
};
