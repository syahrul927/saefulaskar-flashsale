import { eq } from "drizzle-orm";

import { createJubelioClient, isJubelioAuthError } from "@/lib/jubelio";
import { getSession } from "@/server/better-auth/server";
import {
  buildSalesOrderPayload,
  markConfirmed,
} from "@/server/confirm-order";
import { db } from "@/server/db";
import { contacts, orderItems, orders } from "@/server/db/schema";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

/**
 * POST /api/orders/[id]/confirm — admin-only. Creates the paid Jubelio sales
 * order (spec §4.5) and marks the local order CONFIRMED with the SO id. On
 * Jubelio failure the order keeps its prior status (retryable — spec §5.8).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

  const { id } = await params;

  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return jsonError(404, "Pesanan tidak ditemukan");
  if (order.status !== "UNPAID") {
    return jsonError(409, `Pesanan sudah berstatus ${order.status}`);
  }

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  // Resolve the customer contact (nullable — created at onboarding).
  const [contact] = order.contactId
    ? await db.select().from(contacts).where(eq(contacts.id, order.contactId))
    : [];

  const payload = buildSalesOrderPayload({
    grandTotal: order.grandTotal,
    createdAt: order.createdAt,
    items: items.map((item) => ({
      itemId: item.itemId,
      sku: item.sku,
      itemName: item.itemName,
      qty: item.qty,
      price: item.price,
      subtotal: item.subtotal,
    })),
    contact: {
      jubelioContactId: contact?.jubelioContactId ?? null,
      contactName: contact?.contactName ?? null,
    },
  });

  let data: unknown;
  try {
    data = await createJubelioClient(auth.user.token).createSalesOrder(payload);
  } catch (e) {
    if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
    console.error("confirm: createSalesOrder failed", e);
    return jsonError(502, "Gagal membuat sales order, coba lagi");
  }

  const salesorder_id = (data as { salesorder_id?: number } | null)
    ?.salesorder_id;
  if (!salesorder_id) {
    return jsonError(502, "Jubelio tidak mengembalikan salesorder_id");
  }

  const [updated] = await db
    .update(orders)
    .set(markConfirmed(order, { salesorder_id }))
    .where(eq(orders.id, order.id))
    .returning();

  return Response.json({ ok: true, order: updated });
}