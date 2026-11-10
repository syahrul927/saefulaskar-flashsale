"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { formatSalesOrderCode } from "@/lib/format";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CaretDownIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ADMIN_STATUS_LABEL, TABS, type AdminTab } from "./admin-order-tabs";
import {
  CancelOrderButton,
  type CancelOrderTarget,
} from "./cancel-order-button";
import { ConfirmOrderButton } from "./confirm-order-button";
import { FilterPill } from "./filter-pill";
import {
  OrderDetailTrigger,
  type OrderDetailData,
} from "./order-detail-dialog";
import { ShipmentBand } from "./shipment-band";
import {
  isPulseStatus,
  orderStatusTone,
  StatusBadge,
  type OrderStatus,
} from "./status-badge";

/**
 * One admin order row serialized for the client filter (adjudication F).
 * JSON-serializable — money and dates arrive as display strings formatted by
 * the page, mirroring the customer list island.
 */
export type AdminOrderRow = {
  orderId: string;
  bookingId: string;
  status: OrderStatus;
  dateLabel: string;
  jubelioSoId: number | null;
  grandTotalLabel: string;
  items: {
    id: string;
    name: string;
    qtyPriceLabel: string;
    subtotalLabel: string;
  }[];
  transferProofData: string | null;
  /** Filled by the order-status sync from the Jubelio SO once it ships. */
  trackingNumber: string | null;
  shipper: string | null;
  /** Everything the detail dialog shows, serialized by the page. */
  detail: OrderDetailData;
  /**
   * The cancel target, or `null` when the row cannot be cancelled. The page
   * decides this with `isCancellable`, never this island — a row parked on
   * legacy `SHIPPED` answers 409 from the route, so offering it a button would
   * only produce a failure toast (spec §3.3).
   */
  cancel: CancelOrderTarget | null;
};

// TABS/AdminTab/resolveInitialTab live in ./admin-order-tabs — the orders
// page resolves the deep-link tab during SERVER render, and calling an
// export of this "use client" module from the server throws.

/**
 * Admin orders chips + rows (fold for Task 15): the same `FilterPill`
 * treatment as the customer transactions list (design.html:606-628 doubles
 * for admin in the mockup's single role switcher). Filtering is instant over
 * the loaded rows — no refetch. The customer `filterOrders`/`statusCounts`
 * helpers keep their pinned `"all" | UNPAID | CONFIRMED | COMPLETED` shape
 * (spec §4.7) and are deliberately not widened for this; the admin fold also
 * needs `ALL` + the legacy `SHIPPED`, so the one-line visibility filter lives
 * here.
 */
function AdminOrdersFilter({
  rows,
  initialTab = "ALL",
  statusCounts,
}: {
  rows: AdminOrderRow[];
  initialTab?: AdminTab;
  /** Dataset-wide counts per status, GROUP BY'd by the page. Absent counts
   * fall back to the loaded rows — page-local, honest only on the last page,
   * which is why the page always passes them once pagination is on. */
  statusCounts?: { status: OrderStatus; n: number }[];
}) {
  const [tab, setTab] = useState<AdminTab>(initialTab);

  const visible = tab === "ALL" ? rows : rows.filter((r) => r.status === tab);
  const countFor = (t: AdminTab): number =>
    t === "ALL"
      ? statusCounts
        ? statusCounts.reduce((acc, c) => acc + c.n, 0)
        : rows.length
      : (statusCounts?.find((c) => c.status === t)?.n ??
        rows.filter((r) => r.status === t).length);

  return (
    <div>
      <div
        role="group"
        aria-label="Filter status"
        className="no-scrollbar dark:border-border flex items-center gap-1.5 overflow-x-auto border-b border-neutral-100 bg-neutral-50/70 px-4 py-3 dark:bg-neutral-900/40"
      >
        {TABS.map((t) => (
          <FilterPill
            key={t}
            label={t === "ALL" ? "Semua" : ADMIN_STATUS_LABEL[t]}
            count={countFor(t)}
            active={tab === t}
            emphasis={t === "UNPAID"}
            onClick={() => setTab(t)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="p-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {/* Plain copy on purpose: interpolating `tab` once rendered
              "Tidak ada pesanan ALL" (R2). The chips themselves are Bahasa
              now, but the empty state still reads better without one. */}
          Tidak ada pesanan
        </p>
      ) : (
        <ul className="dark:divide-border divide-y divide-neutral-100">
          {visible.map((order) => (
            <OrderCard key={order.orderId} order={order} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One admin order card. Owns the items collapsible's open state — the
 * expanded marker (ring) and the Sembunyikan label both read from it.
 */
function OrderCard({ order }: { order: AdminOrderRow }) {
  const [itemsOpen, setItemsOpen] = useState(false);
  return (
    <li
      className={cn(
        "p-4 transition sm:p-5",
        itemsOpen ? "ring-ring ring-1 ring-inset" : "",
      )}
    >
      <div className="dark:border-border flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-neutral-950 tabular-nums dark:text-neutral-50">
              {order.bookingId}
            </span>
            <StatusBadge
              tone={orderStatusTone(order.status)}
              pulse={isPulseStatus(order.status)}
            >
              {ADMIN_STATUS_LABEL[order.status]}
            </StatusBadge>
          </div>
          {/* `SO-000192626`, the shape Jubelio's console prints — the
                      admin compares this string against upstream, so it must
                      be upstream's format, not ours. */}
          <p className="mt-1 font-mono text-[11px] text-neutral-500 tabular-nums dark:text-neutral-400">
            {order.dateLabel}
            {order.jubelioSoId !== null
              ? ` · ${formatSalesOrderCode(order.jubelioSoId)}`
              : ""}
          </p>
        </div>
        <span className="font-mono text-sm font-bold text-neutral-950 tabular-nums dark:text-neutral-50">
          {order.grandTotalLabel}
        </span>
      </div>

      <Collapsible
        open={itemsOpen}
        onOpenChange={setItemsOpen}
        className="mt-3"
      >
        {/* Always-visible first 3 items */}
        <ul className="dark:divide-border dark:border-border dark:bg-input/20 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50/60">
          {order.items.slice(0, 3).map((item) => (
            <AdminItemRow key={item.id} item={item} />
          ))}
        </ul>

        {/* Remaining items behind collapsible */}
        {order.items.length > 3 && (
          <>
            <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
              <ul className="dark:divide-border dark:border-border dark:bg-input/20 mt-1 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50/60">
                {order.items.slice(3).map((item) => (
                  <AdminItemRow key={item.id} item={item} />
                ))}
              </ul>
            </CollapsibleContent>

            {/* Expand trigger — accent-tint ghost (approved v2). className
                goes on the trigger itself: it already renders a <button>, and
                a nested <button> is invalid DOM nesting. */}
            <CollapsibleTrigger className="bg-accent text-accent-foreground hover:bg-accent/70 active:bg-accent/50 mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold transition-colors">
              <CaretDownIcon
                className={cn(
                  "size-3.5 transition-transform",
                  itemsOpen ? "rotate-180" : "",
                )}
              />
              {itemsOpen
                ? "Sembunyikan"
                : `Lihat ${order.items.length - 3} item lainnya`}
            </CollapsibleTrigger>
          </>
        )}
      </Collapsible>

      {/* Resi strip — only once the sync has pulled a tracking number
                  off the Jubelio SO, so its absence means "hasn't shipped". */}
      {order.trackingNumber ? (
        <ShipmentBand
          className="mt-3"
          trackingNumber={order.trackingNumber}
          shipper={order.shipper}
        />
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {order.transferProofData ? (
          <a
            className="text-primary inline-flex items-center text-sm underline-offset-4 hover:underline"
            href={order.transferProofData}
            target="_blank"
            rel="noreferrer"
          >
            Lihat bukti transfer
          </a>
        ) : (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            Belum ada bukti transfer
          </span>
        )}
        {/* Quiet to loud, left to right (mockup A): detail, cancel,
                    confirm. Every action stays one click from the row, and the
                    dialog never has to be opened to reach one. */}
        <div className="flex flex-wrap items-center gap-2">
          <OrderDetailTrigger order={order.detail} cancel={order.cancel} />
          {order.cancel && (
            <CancelOrderButton target={order.cancel} size="sm" />
          )}
          {order.status === "UNPAID" && (
            <ConfirmOrderButton
              orderId={order.orderId}
              bookingId={order.bookingId}
            />
          )}
          {/* The original ask for the cancelled tab, answered in the
                      row: on a CANCEL order the admin's next move is the
                      customer, not another status. Same link the dialog footer
                      carries, so there is nothing to decide about which one
                      renders. */}
          {order.status === "CANCEL" && order.detail.contact && (
            <Button
              variant="outline"
              size="xs"
              render={
                <a
                  href={order.detail.contact.href}
                  target="_blank"
                  rel="noreferrer"
                />
              }
              nativeButton={false}
            >
              {order.detail.contact.label}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * One admin item line — plain text `name` over `qty × price`, subtotal
 * right-aligned, no avatar (admin reads codes, not pictures). Rendered twice
 * per card (first 3 visible, rest behind the collapsible), so the markup
 * lives in exactly one place.
 */
function AdminItemRow({ item }: { item: AdminOrderRow["items"][number] }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate text-neutral-950 dark:text-neutral-50">
          {item.name}
        </p>
        <p className="font-mono text-[11px] text-neutral-500 tabular-nums dark:text-neutral-400">
          {item.qtyPriceLabel}
        </p>
      </div>
      <span className="shrink-0 font-mono text-xs font-medium text-neutral-950 tabular-nums dark:text-neutral-50">
        {item.subtotalLabel}
      </span>
    </li>
  );
}

export { AdminOrdersFilter };
