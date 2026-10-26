import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { env } from "@/env";
import { getSession } from "@/server/better-auth/server";
import { nextBookingId } from "@/server/booking-id";
import {
  buildOrderValues,
  buildWaLink,
  evaluateCheckout,
  parseBankAccounts,
  type CheckoutError,
  type ProductState,
} from "@/server/checkout";
import { db } from "@/server/db";
import {
  flashSessions,
  orderItems,
  orders,
  sessionProducts,
} from "@/server/db/schema";
import { recipientSchema } from "@/server/recipient";

export const runtime = "nodejs";

const CheckoutBody = z
  .object({
    sessionId: z.string().uuid(),
    items: z
      .array(
        z.object({
          sessionProductId: z.string().uuid(),
          qty: z.number().int().positive(),
        }),
      )
      .min(1),
  })
  // Task 12 recipient snapshot — optional, additive to the old body, so the
  // guard's own tests and legacy clients keep working.
  .merge(recipientSchema);

function jsonError(status: number, error: string, itemId?: number) {
  return Response.json({ ok: false, error, ...(itemId === undefined ? {} : { itemId }) }, { status });
}

function errorResponse(error: CheckoutError): Response {
  switch (error.code) {
    case "SESSION_NOT_ACTIVE":
      return jsonError(409, "Sesi telah berakhir");
    case "UNKNOWN_PRODUCT":
      return jsonError(400, "Produk tidak dikenal");
    case "STOCK_INSUFFICIENT":
      return jsonError(409, "Stock tidak mencukupi", error.itemId);
    case "QUOTA_EXCEEDED":
      return jsonError(409, "Quota exceeded", error.itemId);
    case "BELOW_MIN_ORDER":
      return jsonError(400, "Pesanan di bawah minimal order", error.itemId);
  }
}

/**
 * POST /api/orders — checkout: oversell guard + local booking (spec §4.4).
 * Body: { sessionId, items: [{ sessionProductId, qty }], recipientName?,
 * recipientPhone?, recipientAddress? } — the recipient fields snapshot onto
 * the order row (undefined → null) via `buildOrderValues`.
 * Checks: session ACTIVE → DB stock ≥ qty → claimed+qty ≤ quota → qty ≥ minOrder.
 * On pass (one transaction): claimed += qty per product, insert `order` + items.
 * Responds { bookingId, orderId, grandTotal, bankAccounts, waLink }.
 */
export async function POST(request: Request) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");

  let body: z.infer<typeof CheckoutBody>;
  try {
    body = CheckoutBody.parse(await request.json());
  } catch {
    return jsonError(
      400,
      "Invalid body: sessionId + items [{ sessionProductId, qty }]",
    );
  }

  const [session] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, body.sessionId));
  if (!session) return jsonError(404, "Sesi tidak ditemukan");

  const rows = await db
    .select()
    .from(sessionProducts)
    .where(eq(sessionProducts.sessionId, body.sessionId));

  const products = new Map<string, ProductState>();
  for (const row of rows) {
    products.set(row.id, {
      sessionProductId: row.id,
      itemId: row.itemId,
      skuCode: row.skuCode ?? "",
      itemName: row.itemGroupName ?? "",
      availableStock: row.jubelioStock,
      claimed: row.claimed,
      sessionQuota: row.sessionQuota,
      minOrder: row.minOrder,
      flashPrice: row.flashPrice,
    });
  }

  const result = evaluateCheckout({
    sessionStatus: session.status,
    products,
    requested: body.items,
  });

  if (!result.ok) return errorResponse(result.error);

  const { lines, grandTotal } = result;

  try {
    const { bookingId } = await nextBookingId(db, new Date());

    // Hoisted out of the transaction so the 201 response can hand back the
    // order UUID (orderId contract — the PaymentPanel seeds its proof phase
    // from it instead of polling the order list).
    let orderId = "";

    await db.transaction(async (tx) => {
      for (const line of lines) {
        await tx
          .update(sessionProducts)
          .set({ claimed: sql`${sessionProducts.claimed} + ${line.qty}` })
          .where(eq(sessionProducts.id, line.sessionProductId));
      }

      const [order] = await tx
        .insert(orders)
        .values({
          bookingId,
          ...buildOrderValues(body, auth.user.id, body.sessionId, grandTotal),
        })
        .returning();
      if (!order) throw new Error("order insert returned no row");
      orderId = order.id;

      await tx.insert(orderItems).values(
        lines.map((line) => ({
          orderId: order.id,
          sessionProductId: line.sessionProductId,
          itemId: line.itemId,
          sku: line.sku,
          itemName: line.itemName,
          qty: line.qty,
          price: line.price,
          subtotal: line.subtotal,
        })),
      );
    });

    const bankAccounts = parseBankAccounts(env.BANK_ACCOUNTS)
      .map((bank) => ({
        ...bank,
        waLink: buildWaLink({
          bookingId,
          grandTotal,
          bank,
          whatsappNumber: env.WHATSAPP_NUMBER,
        }),
      }));

    return Response.json(
      {
        ok: true,
        bookingId,
        orderId,
        grandTotal,
        bankAccounts,
        waLink: bankAccounts[0]?.waLink ?? null,
      },
      { status: 201 },
    );
  } catch {
    // A concurrent checkout may have collided on the daily booking sequence
    // (unique `booking_id`). Surface a retryable error rather than a raw 500.
    return jsonError(409, "Checkout gagal, silakan coba lagi");
  }
}

/**
 * GET /api/orders — list the signed-in customer's orders (newest first),
 * each with its line items.
 */
export async function GET() {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");

  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.customerId, auth.user.id))
    .orderBy(desc(orders.createdAt));

  const allItems =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(orderItems)
          .where(inArray(orderItems.orderId, rows.map((r) => r.id)));

  const itemsByOrder = new Map<string, typeof allItems>();
  for (const item of allItems) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }

  return Response.json({
    ok: true,
    orders: rows.map((order) => ({
      ...order,
      items: itemsByOrder.get(order.id) ?? [],
    })),
  });
}