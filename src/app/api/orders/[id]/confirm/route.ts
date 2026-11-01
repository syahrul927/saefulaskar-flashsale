import { eq } from "drizzle-orm";

import { createJubelioClient, isJubelioAuthError } from "@/lib/jubelio";
import { getSession } from "@/server/better-auth/server";
import {
  buildSalesOrderPayload,
  markConfirmed,
  pickConfirmContact,
  readSalesOrderId,
} from "@/server/confirm-order";
import { resolveUnits } from "@/server/confirm-units";
import { db } from "@/server/db";
import { contacts, orderItems, orders, user } from "@/server/db/schema";
import { recordStatusChange } from "@/server/status-history";

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

  // Resolve the customer contact: the order's linked row first, then the
  // ORDER CUSTOMER's contact by email (`order.customer_id → user.email`) —
  // never the confirming admin's email: an OWNER admin confirming someone
  // else's order would key the lookup on the wrong account and find nothing
  // (the empty-`customer_name` root cause, second face).
  const orderContact = order.contactId
    ? (
        await db
          .select()
          .from(contacts)
          .where(eq(contacts.id, order.contactId))
      )[0] ?? null
    : null;
  let emailContact: (typeof contacts.$inferSelect | null) = null;
  if (!orderContact) {
    const [customer] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, order.customerId));
    emailContact = customer?.email
      ? (
          await db
            .select()
            .from(contacts)
            .where(eq(contacts.email, customer.email))
        )[0] ?? null
      : null;
  }
  const contact = pickConfirmContact(orderContact, emailContact);
  if (!contact?.contactName?.trim()) {
    // Unregistered customer: actionable 409, not the payload guard's 500.
    return jsonError(
      409,
      "Pelanggan belum terdaftar di Jubelio (data kontak kosong). Minta pelanggan lengkapi data terlebih dahulu.",
    );
  }

  // SO items need the strict-schema `unit` (uom_name) per line — resolve one
  // upstream call per unique SKU; a failed lookup falls back to the probed
  // default and never blocks confirmation.
  const units = await resolveUnits(items, async (sku) => {
    const data = (await createJubelioClient(auth.user.token).getStockBySku(
      sku,
    )) as { uom_name?: unknown } | null;
    return typeof data?.uom_name === "string" ? { uom_name: data.uom_name } : null;
  });

  const payload = buildSalesOrderPayload({
    grandTotal: order.grandTotal,
    createdAt: order.createdAt,
    items: items.map((item, i) => ({
      itemId: item.itemId,
      sku: item.sku,
      itemName: item.itemName,
      qty: item.qty,
      price: item.price,
      subtotal: item.subtotal,
      unit: units[i] ?? "Buah",
    })),
    contact: {
      jubelioContactId: contact?.jubelioContactId ?? null,
      contactName: contact?.contactName ?? null,
    },
    // The SO's shipping block: the order-level recipient snapshot first, the
    // contact record behind it — the dashboard's create always sends a named
    // recipient, and our dead rows had `shipping_full_name: null`.
    shipping: {
      fullName: order.recipientName?.trim() || contact?.contactName?.trim() || "",
      address: order.recipientAddress?.trim() || contact?.sAddress?.trim() || "",
      phone: order.recipientPhone?.trim() || contact?.phone?.trim() || "",
    },
  });

  let data: unknown;
  try {
    data = await createJubelioClient(auth.user.token).createSalesOrder(payload);
  } catch (e) {
    if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
    if (e instanceof Error && e.message.includes("customer_name")) {
      return jsonError(
        409,
        "Pelanggan belum terdaftar di Jubelio (data kontak kosong). Minta pelanggan lengkapi data terlebih dahulu.",
      );
    }
    console.error("confirm: createSalesOrder failed", e);
    return jsonError(502, "Gagal membuat sales order, coba lagi");
  }

  const salesorderId = readSalesOrderId(data);
  if (!salesorderId) {
    // The create itself SUCCEEDED (2xx) — so a paid sales order now exists in
    // Jubelio that we cannot name. Logging the raw body is the point: this
    // shape assumption is what left SO-000192297 unlinked on 2026-10-28, and a
    // blind retry would create a second one.
    console.error(
      "confirm: Jubelio create returned no usable SO id; raw body:",
      JSON.stringify(data),
    );
    return jsonError(
      502,
      "Respon Jubelio tidak memuat id sales order — SO mungkin sudah dibuat, cek Jubelio sebelum konfirmasi ulang.",
    );
  }

  // The status update and its audit row commit together (spec §4.5): a history
  // row must never exist for an order that stayed UNPAID, and vice versa.
  // `order.status` is the pre-update value read at the top of the handler —
  // `markConfirmed` returns a patch, it does not mutate `order`.
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set(markConfirmed(order, salesorderId))
      .where(eq(orders.id, order.id))
      .returning();
    if (rows[0]) {
      await recordStatusChange(tx, {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: "CONFIRMED",
        source: "admin",
        actorUserId: auth.user.id,
        note: `SO #${salesorderId} dibuat`,
      });
    }
    return rows;
  });

  return Response.json({ ok: true, order: updated });
}