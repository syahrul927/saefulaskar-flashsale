import {
  toPickerRows,
  type JubelioClient,
  type PickerRow,
} from "@/lib/jubelio";

/**
 * In-memory cache of the full Jubelio masters catalog, mapped to picker rows.
 *
 * The upstream endpoint rejects every query param (spec probe 2026-10-26),
 * so the whole catalog (573 items ≈ 2.3 MB raw) is fetched once per TTL and
 * the picker filters client-side. The cache is best-effort per process: a
 * cold serverless instance simply pays one ~1.7 s fetch on first picker
 * open — a shared store would need a schema change, which the spec forbids.
 */

const CATALOG_TTL_MS = 60_000;

let entry: { expiresAt: number; promise: Promise<PickerRow[]> } | null = null;

export async function getCatalogRows(
  client: JubelioClient,
): Promise<PickerRow[]> {
  const now = Date.now();
  if (entry && now < entry.expiresAt) return entry.promise;

  const promise = client.listProducts().then(toPickerRows);
  entry = { expiresAt: now + CATALOG_TTL_MS, promise };
  // A failed fetch must not outlive its moment: drop the entry so the next
  // caller retries instead of re-rejecting for the rest of the TTL.
  promise.catch(() => {
    if (entry?.promise === promise) entry = null;
  });
  return promise;
}

/** Test-only: clears module state between cases. */
export function __resetCatalogCache(): void {
  entry = null;
}
