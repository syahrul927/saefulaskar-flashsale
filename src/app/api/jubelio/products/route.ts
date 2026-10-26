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
 * The two feeds are independent: a v2 failure NEVER fails the route — rows
 * degrade to `stock: null, image: null` (plate honesty, spec constraint "v2
 * must not sink the catalog"). Only the masters feed owns the error contract:
 * real upstream status/message, no blanket 502 — and masters surfaces
 * immediately, without waiting on the v2 read to settle.
 */
export async function GET() {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

  try {
    const client = createJubelioClient(auth.user.token);
    // Start the v2 read now, but only await it AFTER masters resolves: a
    // stalled /inventory/v2/ must not delay an expired-token 401 or any
    // other upstream error (the ruling replaces the shared-settle shape).
    // `.catch` is attached at creation, so even when masters throws first
    // the v2 rejection is never left unhandled.
    const mapPromise = getStockMap(client).catch((e) => {
      // Degradation is intentional, silence is not: a null plate must be
      // distinguishable from "the catalog genuinely has no stock".
      console.error(
        "jubelio-products: getStockMap failed, serving null stock/image",
        e,
      );
      return null;
    });
    const rows = await getCatalogRows(client); // rejects straight into the existing catch
    const map = await mapPromise; // v2-only failure → null map → 200 with null plate
    return Response.json(mergeStockIntoRows(rows, map));
  } catch (e) {
    if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
    if (e instanceof JubelioError) return jsonError(e.status, e.message);
    return jsonError(502, "Gagal memuat produk, coba lagi");
  }
}
