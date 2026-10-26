import { getSession } from "@/server/better-auth/server";

import {
  createJubelioClient,
  isJubelioAuthError,
  JubelioError,
} from "@/lib/jubelio";
import { getCatalogRows } from "@/server/jubelio-catalog";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * GET /api/jubelio/products — the full masters catalog as picker rows,
 * served through the 60 s catalog cache. Query params are ignored: upstream
 * rejects them all and the picker filters client-side (spec probe 2026-10-26).
 * OWNER-only. Errors carry the real upstream status/message — no blanket 502.
 */
export async function GET() {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

  try {
    const rows = await getCatalogRows(
      createJubelioClient(auth.user.token),
    );
    return Response.json(rows);
  } catch (e) {
    if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
    if (e instanceof JubelioError) return jsonError(e.status, e.message);
    return jsonError(502, "Gagal memuat produk, coba lagi");
  }
}
