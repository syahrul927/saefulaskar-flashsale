import { desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { env } from "@/env";
import { getSession } from "@/server/better-auth/server";
import { buildWaLink, parseBankAccounts } from "@/server/checkout";
import { db } from "@/server/db";
import { contacts, orderItems, orders } from "@/server/db/schema";
import { resolveRecipient } from "@/server/recipient";
import { ProofUploadButton } from "@/app/_components/proof-upload-button";
import { ReceiptTrigger, type ReceiptOrderData } from "@/app/_components/receipt-dialog";

export const metadata: Metadata = {
  title: "Riwayat Pesanan — Flash Studio",
};

export const revalidate = 0;
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  UNPAID: "Belum Bayar",
  CONFIRMED: "Dikonfirmasi",
  SHIPPED: "Dikirim",
  COMPLETED: "Selesai",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  UNPAID: "secondary",
  CONFIRMED: "default",
  SHIPPED: "default",
  COMPLETED: "outline",
};

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

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

      {rows.length === 0 ? (
        <div className="rounded-4xl border border-border bg-card p-10 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            Belum ada pesanan. Mulai belanja saat flash sale aktif.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((order) => {
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
            const orderBanks = banks.map((bank) => ({
              ...bank,
              waLink: buildWaLink({
                bookingId: order.bookingId,
                grandTotal: order.grandTotal,
                bank,
                whatsappNumber: env.WHATSAPP_NUMBER,
              }),
            }));
            return (
              <section
                key={order.id}
                className="rounded-4xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-semibold text-foreground">
                      {order.bookingId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {order.createdAt.toLocaleString("id-ID", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold tabular-nums text-foreground">
                      {formatRupiah(order.grandTotal)}
                    </span>
                    <Badge variant={STATUS_VARIANT[order.status] ?? "secondary"}>
                      {STATUS_LABEL[order.status] ?? order.status}
                    </Badge>
                    <ReceiptTrigger order={receipt} />
                  </div>
                </div>

                {/* Line items */}
                <ul className="mt-4 divide-y divide-border rounded-2xl border border-border">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-foreground">{item.itemName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.qty} × {formatRupiah(item.price)}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums text-foreground">
                        {formatRupiah(item.subtotal)}
                      </span>
                    </li>
                  ))}
                </ul>

                {order.status === "UNPAID" && (
                  <div className="mt-4 space-y-3">
                    {order.transferProofUrl ? (
                      <p className="text-sm text-foreground">
                        ✅ Bukti terkirim —{" "}
                        <a
                          className="text-primary underline-offset-4 hover:underline"
                          href={order.transferProofUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          lihat
                        </a>
                      </p>
                    ) : (
                      <>
                        <div>
                          <p className="mb-2 text-sm font-medium text-foreground">
                            Rekening Tujuan
                          </p>
                          <div className="space-y-1.5">
                            {banks.map((bank) => (
                              <p
                                key={`${bank.bank}-${bank.account_number}`}
                                className="text-sm text-muted-foreground"
                              >
                                {bank.bank} {bank.account_number} a.n.{" "}
                                {bank.account_name}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {orderBanks[0] && (
                            <a
                              className="inline-flex h-8 items-center gap-1 rounded-4xl bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
                              href={orderBanks[0].waLink}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Kirim Bukti via WhatsApp
                            </a>
                          )}
                          <ProofUploadButton orderId={order.id} />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}