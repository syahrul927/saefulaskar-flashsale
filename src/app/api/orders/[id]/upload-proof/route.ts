import { eq } from "drizzle-orm";

import { validateImageDataUri } from "@/lib/proof-image";
import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { orders } from "@/server/db/schema";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

/**
 * POST /api/orders/[id]/upload-proof — accepts a JSON `{ imageData }` body
 * holding the transfer receipt as a base64 data URI (image/jpeg|png, ≤ 500 KB
 * decoded; the client compresses before sending). Nothing touches disk — the
 * data URI is stored directly in `orders.transferProofData`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth)
    return jsonError(
      401,
      "Anda belum masuk. Masuk dulu untuk mengunggah bukti transfer.",
    );

  const { id } = await params;

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id));
  if (!order) return jsonError(404, "Pesanan tidak ditemukan");
  if (order.customerId !== auth.user.id)
    return jsonError(403, "Anda tidak bisa mengunggah bukti transfer untuk pesanan ini.");

  const body = (await request.json().catch(() => null)) as {
    imageData?: unknown;
  } | null;
  if (typeof body?.imageData !== "string") {
    return jsonError(400, "Format kiriman tidak valid. Coba unggah lagi.");
  }

  const validation = validateImageDataUri(body.imageData);
  if (!validation.ok) {
    return validation.error === "TOO_LARGE"
      ? jsonError(
          413,
          "Ukuran gambar terlalu besar (maks 500 KB setelah kompresi).",
        )
      : jsonError(
          400,
          "Format bukti transfer tidak dikenal. Unggah ulang foto JPG atau PNG.",
        );
  }

  await db
    .update(orders)
    .set({ transferProofData: body.imageData })
    .where(eq(orders.id, id));

  return Response.json({ ok: true });
}
