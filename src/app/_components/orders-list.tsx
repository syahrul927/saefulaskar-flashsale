"use client";

import { useState, type ReactNode } from "react";
import { CheckCircleIcon, ShoppingBagIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import type { BankAccount } from "@/server/checkout";
import { ProofUploadButton } from "./proof-upload-button";
import { FilterPill } from "./filter-pill";
import { PaymentPanel } from "./payment-panel";
import { ReceiptTrigger, type ReceiptOrderData } from "./receipt-dialog";
import { ShipmentBand } from "./shipment-band";
import {
  isPulseStatus,
  orderStatusTone,
  StatusBadge,
} from "./status-badge";
import { filterOrders, statusCounts, type OrderFilterTab } from "./order-filters";

/**
 * One order serialized for the client list (Task 15). It IS the Task 14
 * `ReceiptOrderData` (so `ReceiptTrigger` takes it untouched) plus the three
 * fields the card CTAs need beyond the receipt: the raw `grandTotal` number
 * `PaymentPanel` formats itself, the proof URL for the sent/un-sent line, and
 * the WhatsApp link built server-side from the first bank account.
 * JSON-serializable — no `Date`, every display string is formatted on the
 * page exactly like the receipt data already was.
 */
export type TransactionRow = ReceiptOrderData & {
  grandTotal: number;
  transferProofUrl: string | null;
  waLink: string;
  /** Pulled from the Jubelio SO by the order-status sync once it ships;
   *  both null until then, which is what hides the resi strip. */
  trackingNumber: string | null;
  shipper: string | null;
  /** WhatsApp deep link for the "hubungi CS" line on a COMPLETED order. */
  csLink: string;
};

/** Pill copy: mockup labels (:614-617 "All Orders / Waiting Payment /
 *  Confirmed / In Transit") in the app's Bahasa status vocabulary, uppercase
 *  mono per the pill treatment. "DIKIRIM" became "DIPROSES" when SHIPPED was
 *  skipped (spec §4.7) — the pill marks the last state we can see, and that
 *  state now covers both processed and shipped.
 */
const TABS: { id: OrderFilterTab; label: string }[] = [
  { id: "all", label: "SEMUA" },
  { id: "UNPAID", label: "BELUM BAYAR" },
  { id: "CONFIRMED", label: "DIKONFIRMASI" },
  { id: "COMPLETED", label: "DIPROSES" },
  { id: "CANCEL", label: "DIBATALKAN" },
];

function EmptyPlate({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-14 text-center shadow-xs dark:border-border dark:bg-card">
      {children}
    </div>
  );
}

/** No orders at all (brief Step 4): quiet bag + one line + ink CTA home. */
function NoOrdersPlate() {
  return (
    <EmptyPlate>
      <ShoppingBagIcon
        aria-hidden="true"
        className="mx-auto mb-3 w-12 h-12 text-neutral-300"
      />
      <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
        Belum ada transaksi
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-500 dark:text-neutral-400">
        Mulai belanja saat flash sale aktif — pesananmu akan muncul di sini.
      </p>
      <Button
        variant="ink"
        className="mt-4"
        render={<Link href="/" />}
        nativeButton={false}
      >
        Lihat Produk Flash
      </Button>
    </EmptyPlate>
  );
}

/** Orders exist but none for the selected status (mockup :631-644). */
function NoMatchPlate({ label }: { label: string }) {
  return (
    <EmptyPlate>
      <ShoppingBagIcon
        aria-hidden="true"
        className="mx-auto mb-3 w-12 h-12 text-neutral-300"
      />
      <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
        Tidak ada pesanan {label}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-500 dark:text-neutral-400">
        Coba ganti filter status di atas, atau buat pesanan baru dari flash
        deal.
      </p>
      <Button
        variant="brand"
        className="mt-4"
        render={<Link href="/" />}
        nativeButton={false}
      >
        Lihat Produk Flash
      </Button>
    </EmptyPlate>
  );
}

/**
 * One transaction card — mockup treatment (:648-768): amber ring/tint while
 * payment is pending (:648-652, verbatim), mono booking ID + tinted pulsing
 * `StatusBadge` on the top rule, item rows with a thumb frame + mono
 * `qty × Rp…` line and the subtotal right-aligned (:713-726), and the Total +
 * CTA summary on the bottom rule (:729-766). `order_item` stores no per-line
 * image, so the thumb frame carries the product initial instead of an `<img>`
 * (same substitution the Task 14 receipt documented).
 */
function TransactionCard({
  row,
  onPay,
}: {
  row: TransactionRow;
  onPay: () => void;
}) {
  const unpaid = row.status === "UNPAID";
  return (
    <article
      className={cn(
        "rounded-xl border bg-white p-4 shadow-xs transition dark:bg-card sm:p-5",
        unpaid
          ? "border-amber-300 bg-amber-50/20 ring-1 ring-amber-200"
          : "border-neutral-200 hover:border-neutral-300 dark:border-border",
      )}
    >
      {/* Top rule — ID + status tag left, date right (design.html:655-687). */}
      <div className="mb-3 flex flex-col gap-2 border-b border-neutral-100 pb-3 dark:border-border sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
            {row.bookingId}
          </span>
          <StatusBadge
            tone={orderStatusTone(row.status)}
            pulse={isPulseStatus(row.status)}
          >
            {row.statusLabel.toUpperCase()}
          </StatusBadge>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
          {row.dateLabel}
        </span>
      </div>

      {/* Items (design.html:713-726) */}
      <ul className="mb-3 space-y-2">
        {row.items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-2 py-1 text-xs"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex w-9 h-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 font-mono text-sm font-bold uppercase text-neutral-500 dark:border-border dark:bg-neutral-800/60 dark:text-neutral-300"
              >
                {item.name.charAt(0)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold text-neutral-950 dark:text-neutral-50">
                  {item.name}
                </p>
                <p className="font-mono text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
                  {item.qty} × {item.priceLabel}
                </p>
              </div>
            </div>
            <span className="shrink-0 font-mono font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
              {item.subtotalLabel}
            </span>
          </li>
        ))}
      </ul>

      {/* Unpaid action band — mockup banner slot (:689-710) without any
          countdown text (D7): the proof status line plus the two entry
          points. Upload hides once the proof is on the order; the sent line
          replaces the old ✅ emoji with CheckCircleIcon. */}
      {unpaid && (
        <div className="mb-3 space-y-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
          {row.transferProofUrl ? (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-950">
              <CheckCircleIcon
                aria-hidden="true"
                weight="fill"
                className="w-4 h-4 shrink-0 text-emerald-600"
              />
              Bukti terkirim —{" "}
              <a
                className="underline underline-offset-4"
                href={row.transferProofUrl}
                target="_blank"
                rel="noreferrer"
              >
                lihat
              </a>
            </p>
          ) : (
            <p className="font-mono text-[11px] text-amber-900">
              Transfer sesuai instruksi lalu kirim buktinya — pesanan belum
              terkonfirmasi dapat dibatalkan admin.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="brand" onClick={onPay}>
              Instruksi Pembayaran
            </Button>
            {/* `w-full` makes the upload drop to its own line in this row. */}
            {!row.transferProofUrl && <ProofUploadButton orderId={row.orderId} />}
          </div>
        </div>
      )}

      {/* Resi strip, in the same slot the payment band uses: one band per
          order, whichever state it is in. Absent until the sync pulls a
          tracking number off the Jubelio SO. */}
      {row.trackingNumber ? (
        <ShipmentBand
          className="mb-3"
          trackingNumber={row.trackingNumber}
          shipper={row.shipper}
        />
      ) : null}

      {/* COMPLETED means "out of our hands", not "arrived" (spec §4.7) — the
          order may be packed, picked up, or on a courier's truck, and we cannot
          tell from here. Say exactly that, and put the question somewhere to
          take it. Shares the unpaid band's slot: one note per order. */}
      {row.status === "COMPLETED" && (
        <p className="mb-3 rounded-xl border border-neutral-200 bg-neutral-50/60 px-3 py-2 text-xs text-neutral-600 dark:border-border dark:bg-input/20 dark:text-neutral-300">
          Order sudah diproses atau dikirim —{" "}
          <a
            className="font-semibold text-neutral-950 underline underline-offset-4 dark:text-neutral-50"
            href={row.csLink}
            target="_blank"
            rel="noreferrer"
          >
            hubungi CS
          </a>{" "}
          untuk informasi lebih lanjut.
        </p>
      )}

      {/* Bottom rule — payment meta left, Total + Struk right (:729-766). */}
      <div className="flex flex-col gap-3 border-t border-neutral-100 pt-3 font-mono text-xs dark:border-border sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Pembayaran:{" "}
          <strong className="font-bold text-neutral-800 dark:text-neutral-100">
            {row.paymentMethod ?? "—"}
          </strong>
        </span>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <div>
            <span className="mr-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              Total:
            </span>
            <span className="text-sm font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
              {row.grandTotalLabel}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <ReceiptTrigger order={row} />
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Customer transactions list island (Task 15). The page keeps every query
 * server-side and hands in the finished rows — this component only owns two
 * pieces of client state: the status tab (instant filter over loaded data,
 * zero refetch) and which order's `PaymentPanel` dialog is open (one
 * controlled panel instance for the whole list; dismissal routes to
 * `onDone`).
 */
function OrdersList({
  rows,
  bankAccounts,
}: {
  rows: TransactionRow[];
  bankAccounts: BankAccount[];
}) {
  const [tab, setTab] = useState<OrderFilterTab>("all");
  const [paymentOrderId, setPaymentOrderId] = useState<string | null>(null);

  // The page owns the `<main>` padding chrome and the heading — this island
  // only ever renders content.
  if (rows.length === 0) return <NoOrdersPlate />;

  const counts = statusCounts(rows);
  const visible = filterOrders(rows, tab);
  const selected =
    paymentOrderId === null
      ? null
      : rows.find((row) => row.orderId === paymentOrderId) ?? null;

  return (
    <div className="space-y-5">
      {/* Pills (design.html:612-628) — filter loaded data, no refetch. */}
      <div
        role="group"
        aria-label="Filter status"
        className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0"
      >
        {TABS.map(({ id, label }) => (
          <FilterPill
            key={id}
            label={label}
            count={counts[id]}
            active={tab === id}
            emphasis={id === "UNPAID"}
            onClick={() => setTab(id)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <NoMatchPlate
          label={TABS.find(({ id }) => id === tab)?.label ?? ""}
        />
      ) : (
        <div className="space-y-3.5">
          {visible.map((row) => (
            <TransactionCard
              key={row.orderId}
              row={row}
              onPay={() => setPaymentOrderId(row.orderId)}
            />
          ))}
        </div>
      )}

      {selected && (
        <PaymentPanel
          bookingId={selected.bookingId}
          grandTotal={selected.grandTotal}
          bankAccounts={bankAccounts}
          waLink={selected.waLink}
          open
          onDone={() => setPaymentOrderId(null)}
          initialOrderId={selected.orderId}
          initialUploaded={!!selected.transferProofUrl}
        />
      )}
    </div>
  );
}

export { OrdersList };
