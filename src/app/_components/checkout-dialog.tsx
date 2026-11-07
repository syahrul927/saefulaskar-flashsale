"use client";

import { useEffect, useState } from "react";
import { ShoppingBagIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format";
import type { RecipientDefaults } from "@/server/recipient";
import { useCartContext } from "./cart-context";

export type CheckoutBankAccount = {
  bank: string;
  account_number: string;
  account_name: string;
  waLink: string;
};

/** The `POST /api/orders` success payload — CartDrawer keeps it as
 * `checkoutResult` and feeds it to `PaymentPanel` (Task 13). Per-account
 * `waLink`s ride on `bankAccounts`; the drawer hands the first one over.
 * `orderId` is the created order's UUID (orderId contract) — the panel seeds
 * its proof phase from it, so the order-list poll never starts. */
export type CheckoutResult = {
  bookingId: string;
  orderId: string;
  grandTotal: number;
  bankAccounts: CheckoutBankAccount[];
};

type FieldErrors = {
  name?: string;
  phone?: string;
  address?: string;
};

// Mirrors `recipientSchema` bounds so bad input never round-trips to a 400.
const LIMITS = {
  name: { min: 2, max: 120 },
  phone: { min: 6, max: 20 },
  address: { min: 10, max: 400 },
} as const;

/**
 * Checkout recipient step — mockup "MODAL 2: CHECKOUT" transplant
 * (docs/design.html, gradient bar + header band + mono breakdown). Collects
 * the recipient snapshot (name / phone / address) prefilled from the
 * shopper's latest contact, then owns the `POST /api/orders` fetch that used
 * to live in `CartDrawer`. On success the parent closes this dialog, clears
 * the cart and surfaces the payment screen; on failure the dialog stays open
 * with a sonner error (CLAUDE.md: in-flight CTA is `isLoading`, never
 * double-submits).
 */
function CheckoutDialog({
  open,
  onOpenChange,
  sessionId,
  recipientDefaults,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  sessionId?: string;
  recipientDefaults: RecipientDefaults;
  onSuccess: (result: CheckoutResult) => void;
}) {
  const { items, subtotal } = useCartContext();
  const [name, setName] = useState(recipientDefaults.name ?? "");
  const [phone, setPhone] = useState(recipientDefaults.phone ?? "");
  const [address, setAddress] = useState(recipientDefaults.address ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // Re-apply the SSR prefill every time the dialog opens, so a cancelled or
  // failed attempt never strands the drawer on stale edits or old errors.
  useEffect(() => {
    if (!open) return;
    setName(recipientDefaults.name ?? "");
    setPhone(recipientDefaults.phone ?? "");
    setAddress(recipientDefaults.address ?? "");
    setErrors({});
  }, [open, recipientDefaults]);

  const handleSubmit = async () => {
    const trimmed = {
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
    };
    const nextErrors: FieldErrors = {};
    if (trimmed.name.length < LIMITS.name.min) {
      nextErrors.name = `Nama penerima minimal ${LIMITS.name.min} karakter.`;
    }
    if (trimmed.phone.length < LIMITS.phone.min) {
      nextErrors.phone = `Nomor WhatsApp minimal ${LIMITS.phone.min} karakter.`;
    }
    if (trimmed.address.length < LIMITS.address.min) {
      nextErrors.address = `Alamat pengiriman minimal ${LIMITS.address.min} karakter.`;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    if (!sessionId) {
      toast.error("Belum ada flash sale aktif. Coba lagi saat sesi berjalan.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          items: items.map((row) => ({
            sessionProductId: row.sessionProductId,
            qty: row.qty,
          })),
          recipientName: trimmed.name,
          recipientPhone: trimmed.phone,
          recipientAddress: trimmed.address,
        }),
      });

      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        bookingId?: string;
        orderId?: string;
        grandTotal?: number;
        bankAccounts?: CheckoutBankAccount[];
      };

      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Checkout gagal, coba lagi.");
        return;
      }

      onSuccess({
        bookingId: data.bookingId ?? "",
        orderId: data.orderId ?? "",
        grandTotal: data.grandTotal ?? 0,
        bankAccounts: data.bankAccounts ?? [],
      });
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never dismiss mid-flight — the order may already be booked.
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        {/* Gradient bar — Panel/urgency-banner treatment (design.html:466). */}
        <div
          aria-hidden="true"
          className="from-brand-primary via-brand-secondary to-brand-primary h-1.5 shrink-0 bg-gradient-to-r"
        />

        <div className="dark:border-border shrink-0 border-b border-neutral-200 bg-neutral-50/70 px-5 py-4 pr-14 dark:bg-neutral-900/40">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-sm font-bold tracking-wide text-neutral-950 sm:text-base dark:text-neutral-50">
              Bayar Pesananmu Sekarang
            </DialogTitle>
            <DialogDescription className="text-xs">
              Stok terkunci saat pesanan dibuat. Lengkapi data penerima di
              bawah.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          <Field>
            <FieldLabel
              htmlFor="recipient-name"
              className="font-mono text-[10px] font-bold tracking-wider text-neutral-500 uppercase"
            >
              Nama Penerima
            </FieldLabel>
            <Input
              id="recipient-name"
              value={name}
              maxLength={LIMITS.name.max}
              aria-invalid={!!errors.name}
              onChange={(e) => setName(e.target.value)}
              className="dark:bg-input/30 rounded-lg bg-neutral-50"
            />
            {/* Hint shows whenever the field was SSR-prefilled from the
                account (kept while editing too — the value came from the
                account either way). */}
            {recipientDefaults.name != null && (
              <p className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                ← dari akun Anda
              </p>
            )}
            <FieldError
              errors={[errors.name ? { message: errors.name } : undefined]}
            />
          </Field>

          <Field>
            <FieldLabel
              htmlFor="recipient-phone"
              className="font-mono text-[10px] font-bold tracking-wider text-neutral-500 uppercase"
            >
              No. WhatsApp
            </FieldLabel>
            <Input
              id="recipient-phone"
              inputMode="tel"
              value={phone}
              maxLength={LIMITS.phone.max}
              aria-invalid={!!errors.phone}
              onChange={(e) => setPhone(e.target.value)}
              className="dark:bg-input/30 rounded-lg bg-neutral-50 font-mono"
            />
            {recipientDefaults.phone != null && (
              <p className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                ← dari akun Anda
              </p>
            )}
            <FieldError
              errors={[errors.phone ? { message: errors.phone } : undefined]}
            />
          </Field>

          <Field>
            <FieldLabel
              htmlFor="recipient-address"
              className="font-mono text-[10px] font-bold tracking-wider text-neutral-500 uppercase"
            >
              Alamat Pengiriman
            </FieldLabel>
            <Textarea
              id="recipient-address"
              value={address}
              maxLength={LIMITS.address.max}
              aria-invalid={!!errors.address}
              onChange={(e) => setAddress(e.target.value)}
              className="dark:bg-input/30 rounded-xl bg-neutral-50 font-mono"
            />
            {recipientDefaults.address != null && (
              <p className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                ← dari akun Anda
              </p>
            )}
            <FieldError
              errors={[
                errors.address ? { message: errors.address } : undefined,
              ]}
            />
          </Field>

          {/* Breakdown box — mono summary + grand total (design.html checkout
              modal "Breakdown"). */}
          <div className="dark:border-border space-y-1.5 rounded-xl border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs dark:bg-neutral-900/40">
            {items.map((row) => (
              <div
                key={row.sessionProductId}
                className="flex items-baseline justify-between gap-3 text-neutral-500"
              >
                <span className="min-w-0 truncate">
                  {row.name} × {row.qty}
                </span>
                <span className="shrink-0 font-bold text-neutral-900 dark:text-neutral-100">
                  {formatRupiah(row.price * row.qty)}
                </span>
              </div>
            ))}
            <div className="dark:border-border flex items-baseline justify-between border-t border-neutral-200 pt-1.5 font-bold text-neutral-950 dark:text-neutral-50">
              <span>Total</span>
              <span className="text-sm font-black tabular-nums">
                {formatRupiah(subtotal)}
              </span>
            </div>
          </div>
        </div>

        <div className="dark:border-border dark:bg-card shrink-0 border-t border-neutral-200 bg-white px-5 py-4">
          <Button
            type="button"
            variant="ink"
            size="lg"
            className="w-full"
            isLoading={submitting}
            disabled={items.length === 0}
            onClick={handleSubmit}
          >
            <ShoppingBagIcon
              weight="regular"
              className="size-4 shrink-0"
              aria-hidden="true"
            />
            {submitting ? "Mengunci stok..." : "Klaim Sekarang →"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { CheckoutDialog };
