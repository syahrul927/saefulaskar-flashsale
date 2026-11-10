"use client";

import { useState } from "react";

import { formatSalesOrderCode } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { CancelOrderButton, type CancelOrderTarget } from "./cancel-order-button";
import { ProofImage } from "./proof-image";
import { ShipmentBand } from "./shipment-band";
import { StatusBadge, orderStatusTone, type OrderStatus } from "./status-badge";
import { StatusStepper } from "./status-stepper";
import type { StatusStep } from "@/server/status-steps";

/**
 * One order, fully explained: identity, the status history as a stepper, the
 * items, the shipping detail, and the two things an admin or a customer can do
 * from here (spec §4.6). Anatomy follows `receipt-dialog.tsx` on purpose — same
 * gradient bar, same header band with `pr-14` to clear the close button, same
 * scrollable body and footer band — because the two dialogs are read one after
 * the other and a second visual language would make them look like unrelated
 * screens.
 *
 * Every field is a display string built by the page. No `Date` crosses this
 * boundary: the page formats with `id-ID` and `formatRupiah`, so the island
 * never needs the raw values and a client clock can disagree with the server's.
 */
export type OrderDetailData = {
  orderId: string;
  bookingId: string;
  status: OrderStatus;
  /** Bahasa on every surface: `ADMIN_STATUS_LABEL` here, `CUSTOMER_STATUS_LABEL` on the storefront (final review I-1 — no raw enums). */
  statusLabel: string;
  dateLabel: string;
  grandTotalLabel: string;
  sessionName: string | null;
  /** `null` on the storefront: the customer never sees our upstream ids. */
  jubelioSoId: number | null;
  steps: StatusStep[];
  items: {
    id: string;
    name: string;
    qtyPriceLabel: string;
    subtotalLabel: string;
  }[];
  hasProof: boolean;
  trackingNumber: string | null;
  shipper: string | null;
  /** `null` renders no button and the `contactHint` line instead — never a dead link. */
  contact: { label: string; href: string } | null;
  contactHint: string | null;
};

function OrderDetailDialog({
  order,
  cancel,
  open,
  onOpenChange,
}: {
  order: OrderDetailData;
  /** Omitted (or `null`) on any surface that must not cancel — the storefront. */
  cancel?: CancelOrderTarget | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <div
          aria-hidden="true"
          className="h-1.5 shrink-0 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-primary"
        />

        {/* Header band: identity first, because this is the screen an admin
            opens to decide about ONE order among hundreds. */}
        <div className="shrink-0 border-b border-neutral-200 bg-neutral-50/70 px-5 py-4 pr-14 dark:border-border dark:bg-neutral-900/40">
          <DialogTitle className="flex flex-wrap items-center gap-2 font-mono text-sm font-bold text-neutral-950 sm:text-base dark:text-neutral-50">
            {order.bookingId}
            <StatusBadge tone={orderStatusTone(order.status)}>
              {order.statusLabel}
            </StatusBadge>
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            {order.dateLabel}
          </DialogDescription>
          {/* Labeled cells, the receipt's own idiom, rather than one dotted
              string: the total is the figure an admin reads first, and a
              missing session or a never-linked SO says nothing at all rather
              than holding a placeholder open. */}
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs">
            <span className="font-mono text-base font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
              {order.grandTotalLabel}
            </span>
            {order.sessionName && (
              <span className="text-neutral-500 dark:text-neutral-400">
                Sesi{" "}
                <span className="font-semibold text-neutral-700 dark:text-neutral-200">
                  {order.sessionName}
                </span>
              </span>
            )}
            {order.jubelioSoId !== null && (
              <span className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                {formatSalesOrderCode(order.jubelioSoId)}
              </span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
              Riwayat status
            </h3>
            <StatusStepper steps={order.steps} />
          </section>

          {/* Items — the receipt's table frame, so the two dialogs read as one
              product: mono uppercase header, divided rows. */}
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
                    <div className="shrink-0 whitespace-nowrap text-right">
                      <div className="font-mono text-[11px] tabular-nums text-neutral-500">
                        {item.qtyPriceLabel}
                      </div>
                      <div className="font-mono font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
                        {item.subtotalLabel}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {order.hasProof && <ProofImage orderId={order.orderId} variant="full" />}

          {order.trackingNumber && (
            <ShipmentBand
              trackingNumber={order.trackingNumber}
              shipper={order.shipper}
            />
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t border-neutral-200 bg-white px-4 py-3 dark:border-border dark:bg-card sm:px-5">
          {order.contact ? (
            <Button
              variant="outline"
              size="sm"
              render={
                <a href={order.contact.href} target="_blank" rel="noreferrer" />
              }
              nativeButton={false}
            >
              {order.contact.label}
            </Button>
          ) : (
            order.contactHint && (
              <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                {order.contactHint}
              </p>
            )
          )}
          {cancel && <CancelOrderButton target={cancel} size="sm" />}
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
 * Per-row open state plus the trigger, copying `ReceiptTrigger`: one dialog per
 * row, held locally, so opening a detail never re-renders the whole list. The
 * pages import this; `OrderDetailDialog` is exported beside it because the
 * trigger renders it in the same module and no page needs the controlled form
 * today.
 */
function OrderDetailTrigger({
  order,
  cancel,
  label = "Lihat detail",
}: {
  order: OrderDetailData;
  cancel?: CancelOrderTarget | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ink"
        size="xs"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {label}
      </Button>
      <OrderDetailDialog
        order={order}
        cancel={cancel}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

export { OrderDetailDialog, OrderDetailTrigger };
