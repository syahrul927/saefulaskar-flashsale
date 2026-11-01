import { desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { env } from "@/env";
import { getSession } from "@/server/better-auth/server";
import { buildWaLink, parseBankAccounts } from "@/server/checkout";
import { db } from "@/server/db";
import { contacts, orderItems, orders } from "@/server/db/schema";
import { formatRupiah } from "@/lib/format";
import { resolveRecipient } from "@/server/recipient";
import { OrdersList, type TransactionRow } from "@/app/_components/orders-list";
import type { ReceiptOrderData } from "@/app/_components/receipt-dialog";

export const metadata: Metadata = {
  title: "Riwayat Pesanan — Flash Studio",
};

export const revalidate = 0;
export const dynamic = "force-dynamic";

/** Bahasa status labels — the receipt's `statusLabel` (Task 14), uppercased
 *  onto the customer list badges too (final review I-1: the pill above says
 *  "BELUM BAYAR", so the card badge can't shout the raw enum beside it).
 *  Admin surfaces keep raw-enum labels — the documented admin precedent.
 *
 *  COMPLETED reads "Diproses", not "Selesai", because it now covers both
 *  processed-and-shipped (spec §4.7): nothing writes SHIPPED any more, so the
 *  last state an order reaches must not claim only one of those two things. The
 *  card spells it out under the pill; this label is the short form. `SHIPPED`
 *  stays so legacy rows still get a word instead of the raw enum. */
const STATUS_LABEL: Record<string, string> = {
  UNPAID: "Belum Bayar",
  CONFIRMED: "Dikonfirmasi",
  SHIPPED: "Dikirim",
  COMPLETED: "Diproses",
};

/** Chat link for the "hubungi CS" line. Deliberately not `waLink`: that one is
 *  pre-filled with the transfer-proof message for an UNPAID order, and sending
 *  a customer a payment script for an order already on its way is wrong. */
function buildCsLink(bookingId: string): string {
  const text = `Halo CS Flash Studio, saya ingin menanyakan status pesanan ${bookingId}.`;
  return `https://wa.me/${env.WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

/**
 * Transactions page. All queries stay server-side (orders + items + the
 * contact fallback for pre-snapshot orders); every display string — rupiah,
 * `id-ID` dates, the WhatsApp proof link for the first bank account — is
 * formatted here so the client island receives JSON only. The island owns
 * filter pills + the controlled `PaymentPanel` (Task 13) and per-row
 * `ReceiptTrigger` (Task 14) with zero refetch on filtering.
 */
export default async function OrdersPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login");

  // Left-join the linked contact: pre-snapshot orders fall back to it for the
  // receipt's Pembayar rows (`resolveRecipient`), and a deleted contact yields
  // null join columns which the receipt renders as "—".
  const rows = await db
    .select({
      id: orders.id,
      bookingId: orders.bookingId,
      status: orders.status,
      grandTotal: orders.grandTotal,
      paymentMethod: orders.paymentMethod,
      transferProofUrl: orders.transferProofUrl,
      recipientName: orders.recipientName,
      recipientPhone: orders.recipientPhone,
      recipientAddress: orders.recipientAddress,
      trackingNumber: orders.trackingNumber,
      shipper: orders.shipper,
      createdAt: orders.createdAt,
      contactRowId: contacts.id,
      contactName: contacts.contactName,
      contactPhone: contacts.phone,
      contactAddress: contacts.sAddress,
    })
    .from(orders)
    .leftJoin(contacts, eq(orders.contactId, contacts.id))
    .where(eq(orders.customerId, session.user.id))
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

  const banks = parseBankAccounts(env.BANK_ACCOUNTS);

  const listRows: TransactionRow[] = rows.map((order) => {
    const items = itemsByOrder.get(order.id) ?? [];
    const receipt: ReceiptOrderData = {
      orderId: order.id,
      bookingId: order.bookingId,
      status: order.status,
      statusLabel: STATUS_LABEL[order.status] ?? order.status,
      dateLabel: order.createdAt.toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      paymentMethod: order.paymentMethod,
      recipient: resolveRecipient({
        order: {
          recipientName: order.recipientName,
          recipientPhone: order.recipientPhone,
          recipientAddress: order.recipientAddress,
        },
        contact:
          order.contactRowId === null
            ? null
            : {
                contactName: order.contactName,
                phone: order.contactPhone,
                sAddress: order.contactAddress,
              },
      }),
      items: items.map((item) => ({
        id: item.id,
        name: item.itemName,
        qty: item.qty,
        priceLabel: formatRupiah(item.price),
        subtotalLabel: formatRupiah(item.subtotal),
      })),
      grandTotalLabel: formatRupiah(order.grandTotal),
    };
    const firstBank = banks[0];
    return {
      ...receipt,
      grandTotal: order.grandTotal,
      transferProofUrl: order.transferProofUrl,
      trackingNumber: order.trackingNumber,
      shipper: order.shipper,
      // Same precedent as the cart drawer / PaymentPanel: the WA proof link
      // rides on the first configured bank account; empty string = no CTA.
      waLink: firstBank
        ? buildWaLink({
            bookingId: order.bookingId,
            grandTotal: order.grandTotal,
            bank: firstBank,
            whatsappNumber: env.WHATSAPP_NUMBER,
          })
        : "",
      csLink: buildCsLink(order.bookingId),
    };
  });

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Riwayat Pesanan
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pantau status pesanan dan unggah bukti transfer Anda.
        </p>
      </div>

      <OrdersList rows={listRows} bankAccounts={banks} />
    </main>
  );
}
