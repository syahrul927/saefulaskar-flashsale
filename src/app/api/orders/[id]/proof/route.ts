import { eq } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { orders } from "@/server/db/schema";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

/**
 * GET /api/orders/[id]/proof — returns the stored transfer receipt as a base64
 * data URI for the order's customer or an OWNER (same role check as
 * `src/app/admin/layout.tsx`). Only `customerId` (guard input) and
 * `transferProofData` (the payload) leave the database — no other columns.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth)
    return jsonError(
      401,
      "Anda belum masuk. Masuk dulu untuk melihat bukti transfer.",
    );

  const { id } = await params;

  const [order] = await db
    .select({
      customerId: orders.customerId,
      transferProofData: orders.transferProofData,
    })
    .from(orders)
    .where(eq(orders.id, id));
  if (!order) return jsonError(404, "Pesanan tidak ditemukan");
  if (order.customerId !== auth.user.id && auth.user.role !== "OWNER")
    return jsonError(
      403,
      "Anda tidak bisa melihat bukti transfer untuk pesanan ini.",
    );
  if (!order.transferProofData)
    return jsonError(404, "Bukti transfer belum diunggah.");

  return Response.json({ ok: true, imageData: order.transferProofData });
}
