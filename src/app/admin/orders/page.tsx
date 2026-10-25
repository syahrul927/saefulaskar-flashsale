import { eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { db } from "@/server/db";
import { orderItems, orders } from "@/server/db/schema";
import { ConfirmOrderButton } from "@/app/_components/confirm-order-button";

export const metadata: Metadata = {
  title: "Pesanan — Flash Studio Admin",
};

export const dynamic = "force-dynamic";

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

/**
 * Admin order list (spec §4.5 Phase 2). UNPAID bookings get the "Konfirmasi
 * Bayar" action; every row shows the transfer screenshot when present.
 * WhatsApp link uses env.WHATSAPP_NUMBER.
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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Pesanan
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Verifikasi bukti transfer dan konfirmasi pembayaran.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-4xl border border-border bg-card p-10 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            Belum ada pesanan masuk.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((order) => {
            const items = itemsByOrder.get(order.id) ?? [];
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
                      {order.jubelioSoId ? ` · SO #${order.jubelioSoId}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold tabular-nums text-foreground">
                      {formatRupiah(order.grandTotal)}
                    </span>
                    <Badge
                      variant={STATUS_VARIANT[order.status] ?? "secondary"}
                    >
                      {order.status}
                    </Badge>
                  </div>
                </div>

                <ul className="mt-4 divide-y divide-border rounded-2xl border border-border">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-foreground">
                          {item.itemName}
                        </p>
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

                <div className="mt-4 flex flex-wrap items-center gap-3">
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
                    <span className="text-sm text-muted-foreground">
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
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}