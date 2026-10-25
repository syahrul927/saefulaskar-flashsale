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
 * GET /api/jubelio/products?search=…
 * Live proxy of the Jubelio masters catalog, reshaped to camelCase for Task 5's
 * product picker. OWNER-only (part of the admin portal).
 */
export async function GET(request: Request) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

  const search =
    new URL(request.url).searchParams.get("search") ??
    undefined;

  let raw: unknown;
  try {
    raw = await createJubelioClient(auth.user.token).listProducts(search);
  } catch (e) {
    if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
    return jsonError(502, "Gagal memuat produk, coba lagi");
  }
  return Response.json(toPickerRows(raw));
}
