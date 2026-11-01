import { desc, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { after } from "next/server";

import {
  resolveInitialTab,
} from "@/app/_components/admin-order-tabs";
import {
  AdminOrdersFilter,
  type AdminOrderRow,
} from "@/app/_components/admin-orders-filter";
import type { CancelOrderTarget } from "@/app/_components/cancel-order-button";
import type { OrderDetailData } from "@/app/_components/order-detail-dialog";
import { Panel } from "@/app/_components/panel";
import { env } from "@/env";
import { formatRupiah } from "@/lib/format";
import { db } from "@/server/db";
import {
  flashSessions,
  orderItems,
  orders,
} from "@/server/db/schema";
import {
  buildCustomerWaLink,
  cancelMessageText,
  resolveCustomerContacts,
} from "@/server/order-contact";
import { isCancellable } from "@/server/order-status";
import { maybeRunOrderSync } from "@/server/order-sync";
import { buildStatusSteps } from "@/server/status-steps";
import { listStatusHistory } from "@/server/status-history";

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
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Newest first (spec decision 3): the latest order is the one an admin
  // scrolled for. `?status=` deep link (decision 4) lands the KPI tile click
  // on the matching tab; anything outside the tab set falls back to ALL.
  const raw = (await searchParams).status;
  const initialTab = resolveInitialTab(
    typeof raw === "string" ? raw : undefined,
  );

  // Pull Jubelio's latest order statuses before reading the rows, so an admin
  // opening this page sees COMPLETED, any new resi, and the cancellations the
  // sync found upstream. This is the sync's only trigger. Throttled
  // process-wide by `ORDER_SYNC_INTERVAL_MS` (default 5 min) —
  // a skipped run resolves immediately. The wait is capped by
  // `ORDER_SYNC_AWAIT_MS`: when the upstream sweep is slower than that, the page
  // paints with what the DB already has and `after()` keeps the run alive past
  // the response so its writes still land.
  const sync = maybeRunOrderSync().catch((e) => {
    console.error("admin orders: status sync failed", e);
    return null;
  });
  after(() => sync);
  await Promise.race([
    sync,
    new Promise((resolve) => setTimeout(resolve, env.ORDER_SYNC_AWAIT_MS)),
  ]);

  const rows = await db
    .select()
    .from(orders)
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

  // Three more reads, all batched, all keyed by the same ids the rows already
  // carry. Session names come from a SECOND query rather than a join on the
  // orders select because `db.select().from(orders)` returns whole rows, and
  // adding a `.leftJoin` would change the shape of every `order.x` access below
  // this — the same reason `itemsByOrder` is a separate map (spec §4.6).
  const orderIds = rows.map((r) => r.id);
  const sessionIds = [...new Set(rows.map((r) => r.sessionId))];
  // The session name list is awaited alongside the other two so a page load
  // pays ONE round-trip wait, not two — the rows below need all three maps
  // before the first one renders. The empty guard keeps `inArray` from ever
  // seeing `[]`, the same reason `allItems` has one.
  const [historyByOrder, contactsByOrder, sessions] = await Promise.all([
    listStatusHistory(db, orderIds),
    resolveCustomerContacts(db, orderIds),
    sessionIds.length === 0
      ? Promise.resolve([] as { id: string; name: string }[])
      : db
          .select({ id: flashSessions.id, name: flashSessions.name })
          .from(flashSessions)
          .where(inArray(flashSessions.id, sessionIds)),
  ]);
  const sessionNames = new Map(sessions.map((s) => [s.id, s.name]));

  const adminRows: AdminOrderRow[] = rows.map((order) => {
    const items = (itemsByOrder.get(order.id) ?? []).map((item) => ({
      id: item.id,
      name: item.itemName,
      qtyPriceLabel: `${item.qty} × ${formatRupiah(item.price)}`,
      subtotalLabel: formatRupiah(item.subtotal),
    }));
    const dateLabel = order.createdAt.toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    // The WhatsApp link is built here and nowhere else: `resolveCustomerContacts`
    // already decided which number is dialable (and returns `null` for an order
    // with no usable one), and `cancelMessageText` needs `wasPaid` read off the
    // row the admin is looking at. An empty string means "no button" — the
    // dialog and the row both check that, so a half-resolved contact can never
    // render as a link to nowhere.
    const contact = contactsByOrder.get(order.id) ?? null;
    const waLink = contact
      ? buildCustomerWaLink(
          contact.phone,
          cancelMessageText({
            bookingId: order.bookingId,
            customerName: contact.name,
            wasPaid: order.status === "CONFIRMED",
          }),
        )
      : "";

    // `isCancellable` is the same predicate the route enforces, so a row that
    // offers `Batalkan` is a row the server will accept — legacy `SHIPPED`
    // offers nothing instead of producing a 409 toast.
    const cancel: CancelOrderTarget | null = isCancellable(order.status)
      ? {
          orderId: order.id,
          bookingId: order.bookingId,
          status: order.status,
          unitCount: (itemsByOrder.get(order.id) ?? []).reduce(
            (n, i) => n + i.qty,
            0,
          ),
          jubelioSoId: order.jubelioSoId,
          customerWaLink: waLink,
        }
      : null;

    const detail: OrderDetailData = {
      orderId: order.id,
      bookingId: order.bookingId,
      status: order.status,
      // Admin prints the raw enum (spec §3.1); the storefront prints the Bahasa
      // label. Same dialog, two vocabularies, decided by the caller.
      statusLabel: order.status,
      dateLabel,
      grandTotalLabel: formatRupiah(order.grandTotal),
      sessionName: sessionNames.get(order.sessionId) ?? null,
      jubelioSoId: order.jubelioSoId,
      steps: buildStatusSteps({
        status: order.status,
        createdAt: order.createdAt,
        history: historyByOrder.get(order.id) ?? [],
      }),
      items,
      transferProofUrl: order.transferProofUrl,
      trackingNumber: order.trackingNumber,
      shipper: order.shipper,
      contact: waLink ? { label: "Hubungi pelanggan", href: waLink } : null,
      contactHint:
        "Tidak ada nomor WhatsApp untuk pesanan ini — hubungi pelanggan lewat profilnya.",
    };

    return {
      orderId: order.id,
      bookingId: order.bookingId,
      status: order.status,
      dateLabel,
      jubelioSoId: order.jubelioSoId,
      grandTotalLabel: formatRupiah(order.grandTotal),
      items,
      transferProofUrl: order.transferProofUrl,
      trackingNumber: order.trackingNumber,
      shipper: order.shipper,
      detail,
      cancel,
    };
  });

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
          <AdminOrdersFilter rows={adminRows} initialTab={initialTab} />
        )}
      </Panel>
    </main>
  );
}
