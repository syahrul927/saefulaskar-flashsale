import { getSession } from "@/server/better-auth/server";

import {
  createJubelioClient,
  isJubelioAuthError,
  toPickerRows,
} from "@/lib/jubelio";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * GET /api/jubelio/products — the full Jubelio masters catalog, reshaped to
 * camelCase picker rows. Query params are ignored: upstream rejects them all
 * and the picker filters client-side (spec: probe 2026-10-26). OWNER-only.
 */
export async function GET() {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

  let raw: unknown;
  try {
    // No `search` param: upstream masters rejects every query param (spec
    // probe 2026-10-26). Task 2 wraps this call in the catalog cache.
    raw = await createJubelioClient(auth.user.token).listProducts();
  } catch (e) {
    if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
    return jsonError(502, "Gagal memuat produk, coba lagi");
  }
  return Response.json(toPickerRows(raw));
}
