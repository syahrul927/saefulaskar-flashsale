import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { env } from "@/env";
import { parsePageLimit, parseTimestampCursor } from "@/lib/pagination-params";
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
  contacts,
  orderItems,
  orders,
  sessionProducts,
} from "@/server/db/schema";
import { recipientSchema } from "@/server/recipient";
import { recordStatusChange } from "@/server/status-history";

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
  return Response.json(
    { ok: false, error, ...(itemId === undefined ? {} : { itemId }) },
    { status },
  );
}

/**
 * Customer-facing checkout failures (rendered verbatim as a toast by the
 * checkout dialog): plain Indonesian, says what happened AND what to do —
 * the old set leaked English ("Quota exceeded") and system-speak
 * ("Sesi telah berakhir", "Produk tidak dikenal").
 */
function errorResponse(error: CheckoutError): Response {
  switch (error.code) {
    case "SESSION_NOT_ACTIVE":
      return jsonError(
        409,
        "Flash sale sudah berakhir. Sampai jumpa di sesi berikutnya!",
      );
    case "UNKNOWN_PRODUCT":
      return jsonError(
        400,
        "Ada produk yang sudah tidak tersedia. Refresh dan pilih ulang, ya.",
      );
    case "PRODUCT_HIDDEN":
      return jsonError(
        409,
        "Salah satu produk sudah tidak dijual. Buang dari keranjang, ya.",
        error.itemId,
      );
    case "STOCK_INSUFFICIENT":
      return jsonError(
        409,
        "Stok salah satu produk tidak cukup. Kurangi jumlahnya, lalu checkout lagi.",
        error.itemId,
      );
    case "QUOTA_EXCEEDED":
      return jsonError(
        409,
        "Kuota salah satu produk sudah habis dipesan. Kurangi jumlahnya, ya.",
        error.itemId,
      );
    case "BELOW_MIN_ORDER":
      return jsonError(
        400,
        "Jumlah belum memenuhi minimal order. Tambah qty-nya, ya.",
        error.itemId,
      );
  }
}

/**
 * POST /api/orders — checkout: oversell guard + local booking (spec §4.4).
 * Body: { sessionId, items: [{ sessionProductId, qty }], recipientName?,
 * recipientPhone?, recipientAddress? } — the recipient fields snapshot onto
 * the order row (undefined → null) via `buildOrderValues`.
 * Checks: session ACTIVE → not hidden → DB stock ≥ qty → claimed+qty ≤ quota
 * → qty ≥ minOrder (order owned by `evaluateCheckout`).
 * On pass (one transaction): claimed += qty per product, insert `order` + items.
 * Responds { bookingId, orderId, grandTotal, bankAccounts, waLink }.
 */
export async function POST(request: Request) {
  const auth = await getSession();
  if (!auth)
    return jsonError(401, "Anda belum masuk. Masuk dulu untuk checkout.");

  let body: z.infer<typeof CheckoutBody>;
  try {
    body = CheckoutBody.parse(await request.json());
  } catch {
    return jsonError(
      400,
      "Data yang dikirim tidak valid. Sertakan sessionId dan items [{ sessionProductId, qty }].",
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
      hidden: row.hidden,
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

    // Link the customer's registered Jubelio contact (resolved by email) so
    // payment confirmation can build the sales order without a re-lookup.
    // Nullable: customers who skipped onboarding still check out.
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, auth.user.email));

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
          ...buildOrderValues(
            body,
            auth.user.id,
            body.sessionId,
            grandTotal,
            contact?.id ?? null,
          ),
        })
        .returning();
      if (!order) throw new Error("order insert returned no row");
      orderId = order.id;

      // Creation row (spec §4.5): `null → UNPAID`, inside the same transaction
      // as the order insert, so an order can never exist without its history.
      await recordStatusChange(tx, {
        orderId: order.id,
        fromStatus: null,
        toStatus: "UNPAID",
        source: "checkout",
      });

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

    const bankAccounts = parseBankAccounts(env.BANK_ACCOUNTS).map((bank) => ({
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
 * each with its line items. Cursor-based pagination via ?cursor=ISO-string.
 *
 * Explicit column list on purpose: the proof blob (up to 500KB of base64)
 * must never ride the 4 s poll's payload — rows carry `hasProof` instead and
 * the image itself is fetched on demand from `GET /api/orders/[id]/proof`.
 */
export async function GET(request: Request) {
  const auth = await getSession();
  if (!auth)
    return jsonError(
      401,
      "Anda belum masuk. Masuk dulu untuk melihat pesanan.",
    );

  const { searchParams } = new URL(request.url);
  const cursor = parseTimestampCursor(searchParams.getAll("cursor"));
  const limit = parsePageLimit(searchParams.getAll("limit"));

  const rows = await db
    .select({
      id: orders.id,
      bookingId: orders.bookingId,
      customerId: orders.customerId,
      sessionId: orders.sessionId,
      status: orders.status,
      grandTotal: orders.grandTotal,
      paymentMethod: orders.paymentMethod,
      jubelioSoId: orders.jubelioSoId,
      invoiceId: orders.invoiceId,
      invoiceNo: orders.invoiceNo,
      contactId: orders.contactId,
      recipientName: orders.recipientName,
      recipientPhone: orders.recipientPhone,
      recipientAddress: orders.recipientAddress,
      trackingNumber: orders.trackingNumber,
      shipper: orders.shipper,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      hasProof: sql<boolean>`${orders.transferProofData} is not null`,
    })
    .from(orders)
    .where(
      cursor
        ? and(eq(orders.customerId, auth.user.id), lt(orders.createdAt, cursor))
        : eq(orders.customerId, auth.user.id),
    )
    .orderBy(desc(orders.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const nextCursor = hasMore
    ? (rows.at(-1)?.createdAt.toISOString() ?? null)
    : null;

  const allItems =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(orderItems)
          .where(
            inArray(
              orderItems.orderId,
              rows.map((r) => r.id),
            ),
          );

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
    nextCursor,
    hasMore,
  });
}
