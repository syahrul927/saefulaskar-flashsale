import { inArray } from "drizzle-orm";
import type { Metadata } from "next";

import {
  AdminOrdersFilter,
  type AdminOrderRow,
} from "@/app/_components/admin-orders-filter";
import { Panel } from "@/app/_components/panel";
import { formatRupiah } from "@/lib/format";
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
 * vertically. Task 15's fold adds the customer pill treatment (design.html:
 * 612-628 doubles for admin in the mockup's single role switcher) via
 * `AdminOrdersFilter` — queries stay here, the island filters the serialized
 * rows instantly. UNPAID bookings keep the "Konfirmasi Bayar" action; every
 * row shows the transfer screenshot when present.
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

  const adminRows: AdminOrderRow[] = rows.map((order) => ({
    orderId: order.id,
    bookingId: order.bookingId,
    status: order.status,
    dateLabel: order.createdAt.toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    jubelioSoId: order.jubelioSoId,
    grandTotalLabel: formatRupiah(order.grandTotal),
    items: (itemsByOrder.get(order.id) ?? []).map((item) => ({
      id: item.id,
      name: item.itemName,
      qtyPriceLabel: `${item.qty} × ${formatRupiah(item.price)}`,
      subtotalLabel: formatRupiah(item.subtotal),
    })),
    transferProofUrl: order.transferProofUrl,
  }));

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
        {adminRows.length === 0 ? (
          <p className="p-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Belum ada pesanan masuk.
          </p>
        ) : (
          <AdminOrdersFilter rows={adminRows} />
        )}
      </Panel>
    </main>
  );
}
