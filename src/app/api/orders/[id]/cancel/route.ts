import { eq } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { type CancelOrderResult, cancelOrder } from "@/server/cancel-order";
import { db } from "@/server/db";
import { orders } from "@/server/db/schema";
import { isCancellable } from "@/server/order-status";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

/**
 * POST /api/orders/[id]/cancel — owner-only. Flips the order to CANCEL and
 * returns its units to the session quota (the write itself lives in
 * `cancelOrder`, Task 7 — status flip, clamped release and history row commit
 * in one transaction). Refunds are handled offline (spec §2), and we never
 * cancel upstream: this route deliberately makes no Jubelio call, and
 * `jubelio_so_id` stays on the row as the record of the deleted SO. It also
 * resolves no WhatsApp number — the dialog builds its link from this row.
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
  // The double gate is intentional: this pre-check gives the admin a precise
  // 409 — including for a legacy SHIPPED row the service itself would accept —
  // while the `notInArray` guard inside `cancelOrder` is what makes the write
  // race-safe. Do not collapse one into the other.
  if (!isCancellable(order.status)) {
    return jsonError(409, `Pesanan sudah berstatus ${order.status}`);
  }

  let result: CancelOrderResult;
  try {
    result = await cancelOrder(db, {
      orderId: order.id,
      source: "admin",
      actorUserId: auth.user.id,
    });
  } catch (e) {
    // Same habit as the confirm route: the client gets a sentence, the stack
    // stays in the server log.
    console.error("cancel: cancelOrder failed", e);
    return jsonError(500, "Gagal membatalkan pesanan, coba lagi");
  }

  if (!result.cancelled) {
    if (result.reason === "not-found") {
      return jsonError(404, "Pesanan tidak ditemukan");
    }
    // The row moved between our read and the guarded UPDATE — name what it
    // says now, because the pre-check above cannot tell a cancel from a
    // completion. If it moved to NOTHING, the honest answer is 404: reporting
    // `CANCEL` for a row we never read would claim a status we did not observe
    // (and a row deleted outright is not "already ended", it is gone).
    const [now] = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id));
    if (!now) return jsonError(404, "Pesanan tidak ditemukan");
    return jsonError(409, `Pesanan sudah berstatus ${now.status}`);
  }

  return Response.json({
    ok: true,
    order: {
      id: order.id,
      bookingId: order.bookingId,
      status: "CANCEL" as const,
      releasedUnits: result.releasedUnits,
    },
  });
}
