import { desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import type { OrderDetailData } from "@/app/_components/order-detail-dialog";
import { env } from "@/env";
import { getSession } from "@/server/better-auth/server";
import { buildWaLink, parseBankAccounts } from "@/server/checkout";
import { db } from "@/server/db";
import {
  contacts,
  flashSessions,
  orderItems,
  orders,
} from "@/server/db/schema";
import { formatRupiah } from "@/lib/format";
import { resolveRecipient } from "@/server/recipient";
import { CUSTOMER_STATUS_LABEL } from "@/server/order-status";
import { buildStatusSteps } from "@/server/status-steps";
import { listStatusHistory } from "@/server/status-history";
import { OrdersList, type TransactionRow } from "@/app/_components/orders-list";
import type { ReceiptOrderData } from "@/app/_components/receipt-dialog";

export const metadata: Metadata = {
  title: "Riwayat Pesanan — Flash Studio",
};

export const revalidate = 0;
export const dynamic = "force-dynamic";

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
      sessionId: orders.sessionId,
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

  // Two reads, not three: the customer surface dials CS through `buildCsLink`,
  // which needs no phone resolution, so `resolveCustomerContacts` is absent by
  // design (spec §8.17). The session name still costs a second query, because
  // the explicit column list above would otherwise join `flashSessions` into
  // every row's shape for a string only the detail dialog reads.
  const orderIds = rows.map((r) => r.id);
  const sessionIds = [...new Set(rows.map((r) => r.sessionId))];
  const [historyByOrder, sessions] = await Promise.all([
    listStatusHistory(db, orderIds),
    sessionIds.length === 0
      ? Promise.resolve([] as { id: string; name: string }[])
      : db
          .select({ id: flashSessions.id, name: flashSessions.name })
          .from(flashSessions)
          .where(inArray(flashSessions.id, sessionIds)),
  ]);
  const sessionNames = new Map(sessions.map((s) => [s.id, s.name]));

  const banks = parseBankAccounts(env.BANK_ACCOUNTS);

  const listRows: TransactionRow[] = rows.map((order) => {
    const items = itemsByOrder.get(order.id) ?? [];
    const receipt: ReceiptOrderData = {
      orderId: order.id,
      bookingId: order.bookingId,
      status: order.status,
      statusLabel: CUSTOMER_STATUS_LABEL[order.status],
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

    // Relabels, never recomputes: `receipt.items` already carries the rupiah
    // strings, and re-deriving them here would put a second money formatter on
    // the same number the receipt dialog shows — two strings that can disagree.
    // `jubelioSoId: null` is the deliberate cut: the storefront select does not
    // read the column, and the customer has no use for our upstream id (spec
    // §8.12). `contactHint: null` because CS is always reachable here — the
    // link is built from config, not from the order, so it cannot be missing.
    const detail: OrderDetailData = {
      orderId: order.id,
      bookingId: order.bookingId,
      status: order.status,
      statusLabel: CUSTOMER_STATUS_LABEL[order.status],
      dateLabel: receipt.dateLabel,
      grandTotalLabel: receipt.grandTotalLabel,
      sessionName: sessionNames.get(order.sessionId) ?? null,
      jubelioSoId: null,
      steps: buildStatusSteps({
        status: order.status,
        createdAt: order.createdAt,
        history: historyByOrder.get(order.id) ?? [],
      }),
      items: receipt.items.map((i) => ({
        id: i.id,
        name: i.name,
        qtyPriceLabel: `${i.qty} × ${i.priceLabel}`,
        subtotalLabel: i.subtotalLabel,
      })),
      transferProofUrl: order.transferProofUrl,
      trackingNumber: order.trackingNumber,
      shipper: order.shipper,
      contact: { label: "Hubungi CS", href: buildCsLink(order.bookingId) },
      contactHint: null,
    };

    return {
      ...receipt,
      detail,
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
