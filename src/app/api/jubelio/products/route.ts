import { getSession } from "@/server/better-auth/server";

import {
  createJubelioClient,
  isJubelioAuthError,
  JubelioError,
} from "@/lib/jubelio";
import {
  getCatalogRows,
  getStockMap,
  mergeStockIntoRows,
} from "@/server/jubelio-catalog";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * GET /api/jubelio/products — the full masters catalog as picker rows with
 * v2 stock/thumbnails joined per SKU, served through the 60 s catalog caches.
 * Query params are ignored: upstream rejects them all and the picker filters
 * client-side (spec probe 2026-10-26). OWNER-only.
 *
 * The two feeds settle independently: a v2 failure NEVER fails the route —
 * rows degrade to `stock: null, image: null` (plate honesty, spec constraint
 * "v2 must not sink the catalog"). Only the masters feed owns the error
 * contract: real upstream status/message, no blanket 502.
 */
export async function GET() {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

  try {
    const client = createJubelioClient(auth.user.token);
    const [rowsRes, mapRes] = await Promise.allSettled([
      getCatalogRows(client),
      getStockMap(client),
    ]);
    if (rowsRes.status === "rejected") throw rowsRes.reason; // existing catch: auth/4xx/502 contract
    return Response.json(
      mergeStockIntoRows(
        rowsRes.value,
        mapRes.status === "fulfilled" ? mapRes.value : null,
      ),
    );
  } catch (e) {
    if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
    if (e instanceof JubelioError) return jsonError(e.status, e.message);
    return jsonError(502, "Gagal memuat produk, coba lagi");
  }
}
