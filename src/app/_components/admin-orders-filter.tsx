"use client";

import { useState } from "react";

import { ConfirmOrderButton } from "./confirm-order-button";
import { FilterPill } from "./filter-pill";
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
  transferProofUrl: string | null;
};

/**
 * Raw-enum uppercase chips — the admin label precedent (Tasks 6/9), widened
 * to the full status enum so no admin row can become unreachable.
 */
const TABS: readonly ("ALL" | OrderStatus)[] = [
  "ALL",
  "UNPAID",
  "CONFIRMED",
  "SHIPPED",
  "COMPLETED",
];

type AdminTab = (typeof TABS)[number];

/**
 * Admin orders chips + rows (fold for Task 15): the same `FilterPill`
 * treatment as the customer transactions list (design.html:606-628 doubles
 * for admin in the mockup's single role switcher). Filtering is instant over
 * the loaded rows — no refetch. The customer `filterOrders`/`statusCounts`
 * helpers keep their pinned `"all" | UNPAID | CONFIRMED | SHIPPED` shape and
 * are deliberately not widened for this; the admin fold needs `ALL` +
 * `COMPLETED` too, so the one-line visibility filter lives here.
 */
function AdminOrdersFilter({ rows }: { rows: AdminOrderRow[] }) {
  const [tab, setTab] = useState<AdminTab>("ALL");

  const visible = tab === "ALL" ? rows : rows.filter((r) => r.status === tab);

  return (
    <div>
      <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-neutral-100 bg-neutral-50/70 px-4 py-3 dark:border-border dark:bg-neutral-900/40">
        {TABS.map((t) => (
          <FilterPill
            key={t}
            label={t}
            count={t === "ALL" ? rows.length : rows.filter((r) => r.status === t).length}
            active={tab === t}
            emphasis={t === "UNPAID"}
            onClick={() => setTab(t)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="p-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
          Tidak ada pesanan {tab}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-border">
          {visible.map((order) => (
            <li key={order.orderId} className="p-4 sm:p-5">
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
                    {order.dateLabel}
                    {order.jubelioSoId !== null
                      ? ` · SO #${order.jubelioSoId}`
                      : ""}
                  </p>
                </div>
                <span className="font-mono text-sm font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
                  {order.grandTotalLabel}
                </span>
              </div>

              <ul className="mt-3 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50/60 dark:divide-border dark:border-border dark:bg-input/20">
                {order.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-neutral-950 dark:text-neutral-50">
                        {item.name}
                      </p>
                      <p className="font-mono text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                        {item.qtyPriceLabel}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-neutral-950 dark:text-neutral-50">
                      {item.subtotalLabel}
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
                    orderId={order.orderId}
                    bookingId={order.bookingId}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { AdminOrdersFilter };
