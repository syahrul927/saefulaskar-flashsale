"use client";

import { useState } from "react";
import { CopyIcon, ReceiptIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProofUploadButton } from "./proof-upload-button";
import {
  isPulseStatus,
  orderStatusTone,
  StatusBadge,
  type OrderStatus,
} from "./status-badge";

/**
 * Server-side resolved recipient — `resolveRecipient` output, mapped on the
 * orders page (snapshot ?? contact ?? null, field by field). `null` means the
 * value genuinely does not exist (pre-snapshot order with a deleted contact);
 * the receipt renders it as an em dash, never a blank cell and never a crash.
 */
export type ReceiptRecipient = {
  name: string | null;
  phone: string | null;
  address: string | null;
};

/**
 * One order rendered to display-ready strings on the server. Everything here
 * is JSON-serializable (no `Date`, no functions) — `formatRupiah` and the
 * `id-ID` date live in the page so no client copy of the formatter appears.
 */
export type ReceiptOrderData = {
  orderId: string;
  bookingId: string;
  status: OrderStatus;
  statusLabel: string;
  dateLabel: string;
  paymentMethod: string | null;
  recipient: ReceiptRecipient;
  items: {
    id: string;
    name: string;
    qty: number;
    priceLabel: string;
    subtotalLabel: string;
  }[];
  grandTotalLabel: string;
};

const MISSING = "—";

/** Pure display mapper for the recipient rows (Review Focus 3): every null —
 * or whitespace-only leftover — collapses to the em dash. */
function mapRecipientRows(recipient: ReceiptRecipient): {
  name: string;
  phone: string;
  address: string;
} {
  const orDash = (value: string | null) =>
    value !== null && value.trim().length > 0 ? value : MISSING;
  return {
    name: orDash(recipient.name),
    phone: orDash(recipient.phone),
    address: orDash(recipient.address),
  };
}

/** Clipboard write mirroring `payment-panel.tsx` — same "Disalin" toast and
 * the same manual-copy fallback message. */
async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Disalin");
  } catch {
    toast.error("Gagal menyalin — salin manual dari layar ini.");
  }
}

function CopyChip({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={`Salin ${label}`}
      className="shrink-0 rounded-lg bg-neutral-100 text-neutral-800 hover:bg-neutral-200 hover:text-neutral-950 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      onClick={() => void copyToClipboard(value)}
    >
      <CopyIcon weight="bold" className="size-3.5" />
    </Button>
  );
}

/**
 * Official receipt — mockup "MODAL 4: TRANSACTION DETAIL & OFFICIAL RECEIPT"
 * transplant (docs/design.html:1155-1270): gradient bar + header band
 * (checkout-dialog idiom), status band with the `orderStatusTone` badge,
 * mono data plates (booking / pembayar), product table and payment breakdown,
 * and a footer CTA row. Read-only by design — the only mutation reachable
 * from here is the UNPAID proof upload. No countdown anywhere (D7).
 */
function ReceiptDialog({
  order,
  open,
  onOpenChange,
}: {
  order: ReceiptOrderData;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const recipient = mapRecipientRows(order.recipient);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        {/* Gradient bar — same treatment as checkout-dialog/payment-panel
            (design.html:466); not a new variant. */}
        <div
          aria-hidden="true"
          className="h-1.5 shrink-0 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-primary"
        />

        {/* Header band — mockup invoice header (design.html:1165-1176).
            `pr-14` clears the DialogContent close button. */}
        <div className="shrink-0 border-b border-neutral-200 bg-neutral-50/70 px-5 py-4 pr-14 dark:border-border dark:bg-neutral-900/40">
          <DialogTitle className="text-sm font-bold uppercase tracking-wide text-neutral-950 sm:text-base dark:text-neutral-50">
            STRUK PESANAN RESMI
          </DialogTitle>
          <DialogDescription className="mt-1 font-mono text-xs">
            Pesanan {order.bookingId} — rincian resmi transaksi Anda.
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {/* Status & date band — mockup :1181-1198, tinted StatusBadge
              replaces the raw status text. */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-neutral-50 p-3 dark:border-border dark:bg-neutral-900/40">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase text-neutral-400">
                Status Pesanan
              </div>
              <div className="mt-1">
                <StatusBadge
                  tone={orderStatusTone(order.status)}
                  pulse={isPulseStatus(order.status)}
                >
                  {order.statusLabel}
                </StatusBadge>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[10px] uppercase text-neutral-400">
                Tanggal
              </div>
              <div className="mt-0.5 font-mono text-xs font-bold text-neutral-800 dark:text-neutral-100">
                {order.dateLabel}
              </div>
            </div>
          </div>

          {/* Data plate — mockup "Fulfillment & Logistics" box (:1201-1215)
              repurposed to what the app stores: Booking ID (mono + copy) and
              the Pembayar rows; nulls render "—" (Step 2 fallback). */}
          <div className="space-y-2 rounded-xl border border-neutral-200 bg-neutral-50/40 p-3.5 font-mono text-xs dark:border-border dark:bg-neutral-900/20">
            <div className="text-[10px] font-bold uppercase text-neutral-400">
              Detail Pesanan
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-neutral-500">Booking ID</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-bold text-neutral-900 dark:text-neutral-100">
                  {order.bookingId}
                </span>
                <CopyChip value={order.bookingId} label="Booking ID" />
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="shrink-0 text-neutral-500">Pembayar</span>
              <span className="min-w-0 truncate text-right font-semibold text-neutral-800 dark:text-neutral-100">
                {recipient.name}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="shrink-0 text-neutral-500">No. Telepon</span>
              <span className="font-semibold text-neutral-800 dark:text-neutral-100">
                {recipient.phone}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-neutral-500">Alamat</span>
              <span className="max-w-[240px] break-words text-right font-semibold text-neutral-800 dark:text-neutral-100">
                {recipient.address}
              </span>
            </div>
          </div>

          {/* Items table — mockup :1218-1237; each row carries the mono
              `Rp price × qty = subtotal` formula instead of the mockup image
              thumb (no per-item image is stored on order_item). */}
          <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-border">
            <div className="flex justify-between bg-neutral-100 px-3 py-2 font-mono text-[10px] font-bold uppercase text-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-400">
              <span>Detail Produk</span>
              <span>Subtotal</span>
            </div>
            {order.items.length === 0 ? (
              <p className="px-3 py-3 text-xs text-neutral-500">
                Tidak ada item pada pesanan ini.
              </p>
            ) : (
              <div className="divide-y divide-neutral-100 dark:divide-border">
                {order.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 p-3 text-xs"
                  >
                    <div className="min-w-0 truncate font-bold text-neutral-950 dark:text-neutral-50">
                      {item.name}
                    </div>
                    <div className="shrink-0 whitespace-nowrap font-mono font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
                      {item.priceLabel} × {item.qty} = {item.subtotalLabel}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Breakdown plate — mockup :1240-1253: fee rows in emerald and the
              grand total on the rule, all mono. */}
          <div className="space-y-1.5 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 font-mono text-xs dark:border-border dark:bg-neutral-900/40">
            {order.paymentMethod != null && (
              <div className="flex justify-between gap-3 text-neutral-500">
                <span>Metode Pembayaran</span>
                <span className="text-right font-bold text-neutral-900 dark:text-neutral-100">
                  {order.paymentMethod}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-3 text-neutral-500">
              <span>Ongkir Reguler</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400">
                Gratis (Promo)
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-neutral-200 pt-1.5 text-sm font-black text-neutral-950 dark:border-border dark:text-neutral-50">
              <span>Total</span>
              <span className="tabular-nums">{order.grandTotalLabel}</span>
            </div>
          </div>
        </div>

        {/* Footer CTAs — mockup :1258-1267. Copy moved onto the Booking ID
            row (per brief), so the footer stacks the UNPAID upload CTA over
            "Tutup" full-width, the payment-panel footer idiom. */}
        <div className="shrink-0 space-y-2 border-t border-neutral-200 bg-white px-4 py-3 dark:border-border dark:bg-card sm:px-5">
          {order.status === "UNPAID" && (
            <ProofUploadButton orderId={order.orderId} />
          )}
          <Button
            variant="ink"
            size="lg"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Per-order client island for the server-rendered transactions list: owns the
 * dialog open state and renders the mockup's dark "Receipt" pill
 * (design.html:757-763) as the trigger. The page passes the order's JSON in
 * as props so no list-wide client island is needed.
 */
function ReceiptTrigger({ order }: { order: ReceiptOrderData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ink"
        size="xs"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <ReceiptIcon />
        Struk
      </Button>
      <ReceiptDialog order={order} open={open} onOpenChange={setOpen} />
    </>
  );
}

export { mapRecipientRows, ReceiptDialog, ReceiptTrigger };
