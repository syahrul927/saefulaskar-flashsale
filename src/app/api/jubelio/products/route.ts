import { getSession } from "@/server/better-auth/server";

import { createJubelioClient, isJubelioAuthError } from "@/lib/jubelio";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

type RawMaster = {
  item_id?: unknown;
  sku_code?: unknown;
  item_group_name?: unknown;
  price?: unknown;
  min?: unknown;
};

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
  const rows = Array.isArray(raw) ? raw : [];

  return Response.json(
    rows.map((item) => {
      const p = (item ?? {}) as RawMaster;
      return {
        itemId: num(p.item_id) ?? 0,
        skuCode: str(p.sku_code) ?? "",
        itemGroupName: str(p.item_group_name) ?? "",
        price: num(p.price) ?? 0,
        minOrder: num(p.min) ?? 1,
      };
    }),
  );
}
