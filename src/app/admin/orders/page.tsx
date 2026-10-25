import { inArray } from "drizzle-orm";
import type { Metadata } from "next";

import { ConfirmOrderButton } from "@/app/_components/confirm-order-button";
import { Panel } from "@/app/_components/panel";
import {
  isPulseStatus,
  orderStatusTone,
  StatusBadge,
} from "@/app/_components/status-badge";
import { formatRupiah } from "@/app/admin/format";
import { db } from "@/server/db";
import { orderItems, orders } from "@/server/db/schema";

export const metadata: Metadata = {
  title: "Pesanan — Flash Studio Admin",
};

export const dynamic = "force-dynamic";

/**
 * Admin order list (spec §4.5 Phase 2), mockup "Transaction Records"
 * treatment (design.html:606-700): one Panel of divided rows, order identity
 * in mono, status as a tinted `StatusBadge` (UNPAID pulses because the quota
 * is held), and every money figure in mono `tabular-nums` so rows scan
 * vertically. UNPAID bookings keep the "Konfirmasi Bayar" action; every row
 * shows the transfer screenshot when present. WhatsApp link uses
 * env.WHATSAPP_NUMBER.
 */
export default async function AdminOrdersPage() {
  const rows = await db.select().from(orders);

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

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-heading text-lg font-black uppercase tracking-wider text-neutral-950 sm:text-xl dark:text-neutral-50">
          Pesanan
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Verifikasi bukti transfer dan konfirmasi pembayaran.
        </p>
      </div>

      <Panel title="TRANSAKSI MASUKAN" count={`${rows.length} transaksi`}>
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Belum ada pesanan masuk.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-border">
            {rows.map((order) => {
              const items = itemsByOrder.get(order.id) ?? [];
              return (
                <li key={order.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-3 dark:border-border">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
                          {order.bookingId}
                        </span>
                        <StatusBadge
                          tone={orderStatusTone(order.status)}
                          pulse={isPulseStatus(order.status)}
                        >
                          {order.status}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 font-mono text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                        {order.createdAt.toLocaleString("id-ID", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        {order.jubelioSoId ? ` · SO #${order.jubelioSoId}` : ""}
                      </p>
                    </div>
                    <span className="font-mono text-sm font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
                      {formatRupiah(order.grandTotal)}
                    </span>
                  </div>

                  <ul className="mt-3 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50/60 dark:divide-border dark:border-border dark:bg-input/20">
                    {items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-neutral-950 dark:text-neutral-50">
                            {item.itemName}
                          </p>
                          <p className="font-mono text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                            {item.qty} × {formatRupiah(item.price)}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-neutral-950 dark:text-neutral-50">
                          {formatRupiah(item.subtotal)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    {order.transferProofUrl ? (
                      <a
                        className="inline-flex items-center text-sm text-primary underline-offset-4 hover:underline"
                        href={order.transferProofUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Lihat bukti transfer
                      </a>
                    ) : (
                      <span className="text-sm text-neutral-400 dark:text-neutral-500">
                        Belum ada bukti transfer
                      </span>
                    )}
                    {order.status === "UNPAID" && (
                      <ConfirmOrderButton
                        orderId={order.id}
                        bookingId={order.bookingId}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </main>
  );
}
