"use client";

import { useEffect, useState } from "react";
import {
  CheckIcon,
  WarningCircleIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRupiah } from "@/lib/format";
import type { BankAccount } from "@/server/checkout";
import { CopyChip } from "./copy-chip";
import { ProofUploadButton } from "./proof-upload-button";
import { StatusBadge } from "./status-badge";

/** Cadence for the proof-status poll (ms). This only gates the status chip
 * and the upload control — the panel itself shows NO timer (D7). */
const PROOF_POLL_MS = 4000;

/** Consecutive not-found / 401-403 ticks tolerated before the poll gives up.
 * A booking that is absent from the list or a dead session is permanent —
 * without the cap the panel would re-hit `GET /api/orders` every 4s for its
 * whole lifetime. Transient network/5xx errors never count. */
const MAX_POLL_MISSES = 3;

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

/** One poll tick's classification, fed to `reduceMissStreak`. */
export type PollOutcome = "found" | "miss" | "transient";

/**
 * Pure miss-streak reducer: `miss` (booking absent from the list, or 401/403
 * auth failure) extends the consecutive streak; `found` resets it; `transient`
 * (network/5xx) is neutral — it never counts toward giving up, so a brief
 * offline blip cannot silently freeze a still-valid panel. `giveUp` flips once
 * the streak reaches `maxMisses`.
 */
export function reduceMissStreak(
  misses: number,
  outcome: PollOutcome,
  maxMisses = MAX_POLL_MISSES,
): { misses: number; giveUp: boolean } {
  const next =
    outcome === "found" ? 0 : outcome === "miss" ? misses + 1 : misses;
  return { misses: next, giveUp: next >= maxMisses };
}

type ProofPhase =
  | { phase: "checking" }
  | { phase: "ready"; orderId: string; uploaded: boolean }
  | { phase: "unavailable" };

/**
 * Pure seeding decision (Task orderId contract, I-2): when the caller already
 * knows which order row the panel talks about (`initialOrderId` from the POST
 * response or the serialized list row), the proof phase starts `ready`
 * immediately — `uploaded` mirrors `initialUploaded` — and the list poll must
 * NEVER start. Returns `null` without a usable id, which keeps the bounded
 * `GET /api/orders` poll as the fallback path.
 */
export function seedInitialProof(
  initialOrderId: string | undefined,
  initialUploaded: boolean | undefined,
): ProofPhase | null {
  if (initialOrderId === undefined || initialOrderId.length === 0) return null;
  return {
    phase: "ready",
    orderId: initialOrderId,
    uploaded: initialUploaded ?? false,
  };
}

/** Equality across the union — drives the "skip unchanged state" bail-out
 * so a steady poll tick never re-renders the panel. */
export function sameProofPhase(a: ProofPhase, b: ProofPhase): boolean {
  if (a.phase !== b.phase) return false;
  if (a.phase === "ready" && b.phase === "ready") {
    return a.orderId === b.orderId && a.uploaded === b.uploaded;
  }
  return true;
}

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
  /**
   * Known order UUID (the POST response or the serialized list row). When
   * present, the proof phase seeds `ready` from `seedInitialProof` and the
   * `GET /api/orders` poll never starts; when absent, the bounded poll stays
   * the fallback. See I-2 of the final-review brief.
   */
  initialOrderId?: string;
  /** Whether the order row already carries a transfer proof. Only consulted
   * together with `initialOrderId`. */
  initialUploaded?: boolean;
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
  initialOrderId,
  initialUploaded,
}: PaymentPanelProps) {
  const isDialog = open !== undefined;
  const [proof, setProof] = useState<ProofPhase>(
    () =>
      seedInitialProof(initialOrderId, initialUploaded) ?? {
        phase: "checking",
      },
  );

  // Fallback proof status — used ONLY when no `initialOrderId` was handed in
  // (an older drawer session whose POST predates the orderId contract): the
  // panel resolves bookingId → order row by polling the order list and
  // mirrors `transferProofUrl`. With `initialOrderId` the phase above is
  // already `ready` and this effect never starts. Bounded lifecycle: ticks are
  // skipped while the tab is hidden (the interval itself is not torn down —
  // deps stay honest); the streak caps at MAX_POLL_MISSES consecutive
  // permanent misses (absent booking, 401/403) so an unreachable order can't
  // re-hit the unpaginated list forever; success (uploaded) stops polling;
  // unchanged state never re-renders.
  useEffect(() => {
    if ((open ?? true) === false || bookingId.length === 0) return;
    if (seedInitialProof(initialOrderId, initialUploaded)) return;
    let active = true;
    let misses = 0;
    // Held in an object so `tick()`'s async continuation can clear the
    // interval it started, while the binding itself stays `const`.
    const polling = { id: undefined as number | undefined };
    const stopPolling = () => {
      if (polling.id !== undefined) {
        window.clearInterval(polling.id);
        polling.id = undefined;
      }
    };
    const setProofIfChanged = (next: ProofPhase) => {
      setProof((prev) => (sameProofPhase(prev, next) ? prev : next));
    };
    const tick = async () => {
      // Background tab: no request, no state churn; the next visible tick
      // resumes the poll.
      if (document.visibilityState !== "visible") return;
      let outcome: PollOutcome = "found";
      let nextPhase: ProofPhase | null = null;
      let uploaded = false;
      try {
        const res = await fetch("/api/orders", { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          // Auth is gone — the order is permanently unreadable from here.
          outcome = "miss";
          nextPhase = { phase: "unavailable" };
        } else if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        } else {
          const data = (await res.json()) as { orders?: OrderProofRow[] };
          const match = findOrderProof(data.orders ?? [], bookingId);
          if (!match) {
            outcome = "miss";
            nextPhase = { phase: "unavailable" };
          } else {
            uploaded = match.uploaded;
            nextPhase = {
              phase: "ready",
              orderId: match.orderId,
              uploaded: match.uploaded,
            };
          }
        }
      } catch {
        // Transient network/5xx blip: neutral for the streak, never toasts.
        outcome = "transient";
      }
      if (!active) return;
      const streak = reduceMissStreak(misses, outcome);
      misses = streak.misses;
      if (nextPhase) {
        setProofIfChanged(nextPhase);
      } else {
        // Transient failure: only drop the skeleton while it is still the
        // first answer; later failures keep the last known state.
        setProof((prev) =>
          prev.phase === "checking" ? { phase: "unavailable" } : prev,
        );
      }
      if (streak.giveUp || uploaded) stopPolling();
    };
    setProof({ phase: "checking" });
    void tick();
    polling.id = window.setInterval(() => void tick(), PROOF_POLL_MS);
    return () => {
      active = false;
      stopPolling();
    };
  }, [open, bookingId, initialOrderId, initialUploaded]);

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
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-100 p-3 dark:border-red-900 dark:bg-red-950/40">
          <WarningCircleIcon
            weight="fill"
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400"
          />
          <p className="font-mono text-[11px] leading-relaxed text-red-700 dark:text-red-300">
            Selesaikan pembayaran sebelum sesi berakhir — pesanan belum
            terkonfirmasi dapat dibatalkan admin.
          </p>
        </div>

        {/* Billing plate — mockup VA box (design.html:1106-1126): label,
            white inset with mono value + copy chip, total right-aligned. */}
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-border dark:bg-neutral-900/40">
          <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            ID Booking
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-border dark:bg-card">
            <span className="min-w-0 truncate font-mono text-sm font-black tracking-wider text-neutral-950 dark:text-neutral-50 sm:text-base">
              {bookingId}
            </span>
            <CopyChip value={bookingId} label="ID Booking" />
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
            nativeButton={false}
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
