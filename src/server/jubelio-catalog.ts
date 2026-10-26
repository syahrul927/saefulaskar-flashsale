import {
  toPickerRows,
  toStockMap,
  type JubelioClient,
  type PickerRow,
  type StockEntry,
} from "@/lib/jubelio";

/**
 * In-memory cache of the two Jubelio catalog feeds, plus the pure join between
 * them: the masters endpoint (`getCatalogRows`) and the v2 stock endpoint
 * (`getStockMap`, SKU-level `available` + `thumbnail`).
 *
 * The masters endpoint rejects every query param (spec probe 2026-10-26), so
 * the whole catalog (573 items ≈ 2.3 MB raw) is fetched once per TTL and the
 * picker filters client-side; v2 takes `page_size=2000` and returns the full
 * 1775-SKU stock + thumbnail set in one request. Both caches are best-effort
 * per process: a cold serverless instance simply pays one ~1.7 s fetch on first
 * picker open — a shared store would need a schema change, which the spec
 * forbids. Each entry lives on its own clock: one feed going stale (or failing)
 * never disturbs the other.
 */

const CATALOG_TTL_MS = 60_000;

/** v2 `/inventory/v2/` payload keyed by `item_id` — see `getStockMap`. */
export type StockMap = Map<number, StockEntry>;

/**
 * One TTL'd upstream fetch. Both slots share this shape on purpose so their
 * semantics cannot drift: a call inside the TTL replays the stored promise
 * (concurrent callers collapse into one fetch), and a rejection drops the slot
 * immediately — guarded on promise identity, so a late failure can never clear
 * a newer, healthy entry.
 */
function cached<T>(load: (client: JubelioClient) => Promise<T>) {
  let slot: { expiresAt: number; promise: Promise<T> } | null = null;

  return {
    get(client: JubelioClient): Promise<T> {
      const now = Date.now();
      if (slot && now < slot.expiresAt) return slot.promise;

      const promise = load(client);
      slot = { expiresAt: now + CATALOG_TTL_MS, promise };
      // A failed fetch must not outlive its moment: drop the slot so the next
      // caller retries instead of re-rejecting for the rest of the TTL.
      promise.catch(() => {
        if (slot?.promise === promise) slot = null;
      });
      return promise;
    },
    reset(): void {
      slot = null;
    },
  };
}

const catalogEntry = cached((client) =>
  client.listProducts().then(toPickerRows),
);
const stockEntry = cached((client) => client.listStockV2().then(toStockMap));

/** Full masters catalog, one row per variant (`stock`/`image` start `null`). */
export async function getCatalogRows(
  client: JubelioClient,
): Promise<PickerRow[]> {
  return catalogEntry.get(client);
}

/**
 * SKU-level v2 stock + thumbnail map, merged onto masters rows by
 * `mergeStockIntoRows`. Rejects like the client call (the caller decides how a
 * v2 outage degrades: rows keep `null` stock/image, never a failed route).
 */
export async function getStockMap(client: JubelioClient): Promise<StockMap> {
  return stockEntry.get(client);
}

/**
 * Pure join of the v2 map onto masters rows — never drops or reorders a row,
 * so a partial v2 payload still shows the full catalog. `map === null` (or an
 * itemId absent from it) yields `stock: null, image: null`: "unknown ERP
 * number" must never be rendered as `0`. Input rows are not mutated.
 */
export function mergeStockIntoRows(
  rows: PickerRow[],
  map: StockMap | null,
): PickerRow[] {
  return rows.map((row) => {
    const entry = map?.get(row.itemId);
    return {
      ...row,
      stock: entry?.available ?? null,
      image: entry?.image ?? null,
    };
  });
}

/** Test-only: clears module state between cases. */
export function __resetCatalogCache(): void {
  catalogEntry.reset();
  stockEntry.reset();
}
