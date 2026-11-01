/**
 * Unit-of-measure resolution for the Jubelio sales order payload (confirm
 * payment §4.5): each SO item line needs the strict-schema `unit` string
 * (`uom_name`, e.g. "Buah"), which masters/v2 feeds don't carry — it lives on
 * the product detail (`GET /inventory/items/by-sku/{sku}`). Pure + injected so
 * the confirm route stays thin and this stays unit-testable.
 */

/** Minimal `getProductResponse` fragment the lookup reads. */
export type ProductUnitLookup = (
  sku: string,
) => Promise<{ uom_name?: string } | null>;

/** Sentinel used when upstream can't tell us the unit (probed default). */
export const DEFAULT_UNIT = "Buah";

/** One `order_items` row narrowed to what the unit resolution needs. */
export type UnitSourceItem = {
  sku: string;
};

/**
 * Resolve a unit name per item, deduped by SKU: one upstream call per unique
 * SKU, failures fall back to `DEFAULT_UNIT` — a flaky lookup must never block
 * payment confirmation (the SO itself is the business-critical step).
 */
export async function resolveUnits(
  items: readonly UnitSourceItem[],
  fetchUom: ProductUnitLookup,
): Promise<string[]> {
  const cache = new Map<string, Promise<string>>();
  const lookup = (sku: string): Promise<string> => {
    let promise = cache.get(sku);
    if (!promise) {
      promise = fetchUom(sku)
        .then((p) => p?.uom_name?.trim() || DEFAULT_UNIT)
        .catch(() => DEFAULT_UNIT);
      cache.set(sku, promise);
    }
    return promise;
  };
  return Promise.all(items.map((item) => lookup(item.sku)));
}
