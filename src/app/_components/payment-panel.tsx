"use client";

import { useEffect, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  WarningCircleIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { BankAccount } from "@/server/checkout";
import { ProofUploadButton } from "./proof-upload-button";
import { StatusBadge } from "./status-badge";

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Cadence for the proof-status poll (ms). This only gates the status chip
 * and the upload control — the panel itself shows NO timer (D7). */
const PROOF_POLL_MS = 4000;

/** The order fields from `GET /api/orders` this panel actually reads. */
export type OrderProofRow = {
  id?: unknown;
  bookingId?: unknown;
  transferProofUrl?: unknown;
};

/**
 * Pure matcher: locate the order row for `bookingId`, normalise
 * `transferProofUrl` into an "uploaded" flag, and reject a malformed payload
 * (no string id → null) so a broken row can never become a bogus
 * `orderId` for the upload endpoint.
 */
export function findOrderProof(
  rows: readonly OrderProofRow[],
  bookingId: string,
): { orderId: string; uploaded: boolean } | null {
  const row = rows.find((r) => r.bookingId === bookingId);
  if (!row || typeof row.id !== "string") return null;
  return {
    orderId: row.id,
    uploaded:
      typeof row.transferProofUrl === "string" &&
      row.transferProofUrl.length > 0,
  };
}

/** Clipboard write + the verbatim "Disalin" toast. A missing/insecure
 * `navigator.clipboard` throws into the catch, which is the fallback path. */
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
      size="icon-sm"
      variant="ghost"
      aria-label={`Salin ${label}`}
      className="shrink-0 rounded-lg bg-neutral-100 text-neutral-800 hover:bg-neutral-200 hover:text-neutral-950 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      onClick={() => void copyToClipboard(value)}
    >
      <CopyIcon weight="bold" className="size-3.5" />
    </Button>
  );
}

type ProofPhase =
  | { phase: "checking" }
  | { phase: "ready"; orderId: string; uploaded: boolean }
  | { phase: "unavailable" };

export type PaymentPanelProps = {
  bookingId: string;
  grandTotal: number;
  bankAccounts: BankAccount[];
  waLink: string;
  onDone: () => void;
  /**
   * Controlled-dialog switch. Pass `open` and the panel renders inside a
   * `Dialog` (Task 15 mounts it from the transactions page; dialog dismissal
   * routes to `onDone`). Omit it and the panel renders inline — the post-
   * checkout view inside the cart drawer.
   */
  open?: boolean;
};

/**
 * Payment instructions panel — mockup "MODAL 3: PAYMENT INSTRUCTIONS"
 * transplant (docs/design.html:1072-1148) minus its countdown/timer block,
 * which D7 forbids entirely. Panel-idiom shell (gradient bar + dot band),
 * billing plate with copy chips (design.html:1106-1126, Copy pattern :1115),
 * one destination-account row per bank, WA proof CTA, and the proof-upload
 * control with a polled status chip ("BUKTI TERUNGGAH" once the upload is on
 * the order row, skeleton while polling).
 */
function PaymentPanel({
  bookingId,
  grandTotal,
  bankAccounts,
  waLink,
  onDone,
  open,
}: PaymentPanelProps) {
  const isDialog = open !== undefined;
  const [proof, setProof] = useState<ProofPhase>({ phase: "checking" });

  // Proof status comes from polling the order list — the POST response never
  // returns the order UUID that `/api/orders/[id]/upload-proof` requires, so
  // the panel resolves bookingId → order row and mirrors `transferProofUrl`.
  // Polling stops the moment the upload is confirmed; failures never toast
  // (background loop) and only the first one drops the skeleton.
  useEffect(() => {
    if ((open ?? true) === false || bookingId.length === 0) return;
    let active = true;
    // Held in an object so `tick()`'s async continuation can clear the
    // interval it started, while the binding itself stays `const`.
    const polling = { id: undefined as number | undefined };
    const stopPolling = () => {
      if (polling.id !== undefined) {
        window.clearInterval(polling.id);
        polling.id = undefined;
      }
    };
    const tick = async () => {
      try {
        const res = await fetch("/api/orders", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { orders?: OrderProofRow[] };
        if (!active) return;
        const match = findOrderProof(data.orders ?? [], bookingId);
        if (!match) {
          setProof({ phase: "unavailable" });
          return;
        }
        setProof({
          phase: "ready",
          orderId: match.orderId,
          uploaded: match.uploaded,
        });
        if (match.uploaded) stopPolling();
      } catch {
        if (!active) return;
        setProof((prev) =>
          prev.phase === "checking" ? { phase: "unavailable" } : prev,
        );
      }
    };
    setProof({ phase: "checking" });
    void tick();
    polling.id = window.setInterval(() => void tick(), PROOF_POLL_MS);
    return () => {
      active = false;
      stopPolling();
    };
  }, [open, bookingId]);

  const root = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Gradient bar — same treatment as checkout-dialog/urgency banner
          (design.html:466); not a new variant. */}
      <div
        aria-hidden="true"
        className="h-1.5 shrink-0 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-primary"
      />
      {/* Dot band header — Panel idiom (panel.tsx). `pr-14` in dialog mode
          clears the DialogContent close button, as in checkout-dialog. */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-neutral-100 bg-neutral-50/70 px-4 py-3 dark:border-border dark:bg-neutral-900/40",
          isDialog && "pr-14",
        )}
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full bg-brand-secondary"
        />
        {isDialog ? (
          <DialogTitle className="text-xs font-bold uppercase tracking-wider text-neutral-950 dark:text-neutral-50">
            INSTRUKSI PEMBAYARAN
          </DialogTitle>
        ) : (
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-950 dark:text-neutral-50">
            INSTRUKSI PEMBAYARAN
          </h3>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-3">
        {/* Notice banner — the mockup timer slot (design.html:1095-1104)
            without a countdown (D7): the warning icon stands in for the
            clock so nothing reads as "time left". */}
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <WarningCircleIcon
            weight="fill"
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-amber-600"
          />
          <p className="font-mono text-[11px] leading-relaxed text-amber-900">
            Selesaikan pembayaran sebelum sesi berakhir — pesanan belum
            terkonfirmasi dapat dibatalkan admin.
          </p>
        </div>

        {/* Billing plate — mockup VA box (design.html:1106-1126): label,
            white inset with mono value + copy chip, total right-aligned. */}
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-border dark:bg-neutral-900/40">
          <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Booking ID
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <span className="min-w-0 truncate font-mono text-sm font-black tracking-wider text-neutral-950 dark:text-neutral-50 sm:text-base">
              {bookingId}
            </span>
            <CopyChip value={bookingId} label="Booking ID" />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-neutral-200 pt-2 dark:border-border">
            <span className="font-mono text-xs text-neutral-500">Total</span>
            <span className="text-right font-mono text-base font-black tabular-nums text-neutral-950 dark:text-neutral-50">
              {formatRupiah(grandTotal)}
            </span>
          </div>
        </div>

        {/* Destination accounts — one row per bank, same copy-chip idiom. */}
        <div className="space-y-2">
          <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Rekening Tujuan
          </div>
          {bankAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada rekening yang diatur. Hubungi admin.
            </p>
          ) : (
            bankAccounts.map((bank) => (
              <div
                key={`${bank.bank}-${bank.account_number}`}
                className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-border dark:bg-card"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-950 dark:text-neutral-50">
                    {bank.bank}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-sm font-bold tabular-nums tracking-wider text-neutral-900 dark:text-neutral-100">
                    {bank.account_number}
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    a.n. {bank.account_name}
                  </p>
                </div>
                <CopyChip
                  value={bank.account_number}
                  label={`nomor rekening ${bank.bank}`}
                />
              </div>
            ))
          )}
        </div>

        {/* Proof status — skeleton while the first poll is in flight,
            emerald chip once the upload is on the order. */}
        {proof.phase === "checking" && (
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-40 rounded-full" />
            <span className="sr-only">Memeriksa status bukti transfer…</span>
          </div>
        )}
        {proof.phase === "ready" && proof.uploaded && (
          <StatusBadge tone="emerald">
            <CheckIcon weight="bold" />
            BUKTI TERUNGGAH
          </StatusBadge>
        )}
      </div>

      {/* Actions footer — brand WA CTA over the mockup neutral secondaries
          (design.html:1137-1144). `target/rel` follow the old drawer CTA. */}
      <div className="shrink-0 space-y-2 border-t border-neutral-200 bg-white px-4 py-3 dark:border-border dark:bg-card">
        {waLink.length > 0 && (
          <Button
            size="lg"
            variant="brand"
            className="w-full"
            render={
              <a href={waLink} target="_blank" rel="noreferrer" />
            }
          >
            <WhatsappLogoIcon weight="fill" />
            Kirim Bukti via WhatsApp
          </Button>
        )}
        {proof.phase === "ready" && !proof.uploaded && (
          <ProofUploadButton orderId={proof.orderId} />
        )}
        <Button size="lg" variant="outline" className="w-full" onClick={onDone}>
          Selesai
        </Button>
      </div>
    </div>
  );

  if (!isDialog) return root;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Dismissal and "Selesai" are the same exit for the parent (Task 15
        // closes its own selection state here).
        if (!next) onDone();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogDescription className="sr-only">
          Transfer ke rekening yang tercantum, lalu kirim bukti pembayarannya.
        </DialogDescription>
        {root}
      </DialogContent>
    </Dialog>
  );
}

export { PaymentPanel };
