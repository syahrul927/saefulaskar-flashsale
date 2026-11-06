"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import { useSessionExpiry } from "@/app/_components/use-session-expiry";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OrderStatus } from "@/server/order-status";

/**
 * The "Batalkan" action (spec §4.2, mockup option A): one quiet outline button
 * per cancellable row, and the DIALOG is what holds the admin up, not the
 * button. Nothing here blocks — the warning tells the admin to contact the
 * customer first and `Ya, batalkan` stays pressable with no timer and no second
 * confirmation (spec §8.3), because an admin who has decided to cancel has
 * already weighed what the warning says.
 */

/**
 * Everything the button needs about one order. Built by the page, not by this
 * component: the unit count is a sum over `order_items` and the WhatsApp link is
 * resolved from the customer's phone, both of which need the DB.
 *
 * `customerWaLink` is `""` when no phone resolved — the contact row then renders
 * nothing at all rather than a dead link.
 */
export type CancelOrderTarget = {
  orderId: string;
  bookingId: string;
  /** `UNPAID` | `CONFIRMED` in practice; anything else renders no button. */
  status: OrderStatus;
  /** Summed `order_item.qty` — the sentence the admin is told about the quota. */
  unitCount: number;
  /** Named in the CONFIRMED warning so it cannot be read as an unpaid booking. */
  jubelioSoId: number | null;
  customerWaLink: string;
};

/** Both warnings share a shape and the caution red — a warning never wears the
 *  brand colour, so the two are told apart by weight, not hue. */
const WARN_BASE = "rounded-xl border px-3 py-2.5 text-xs";
const WARN_TONES = {
  // Unpaid: worth a call before the units go back, but a soft stop — the
  // shared caution recipe (5.30:1 on paper).
  unpaid:
    "border-red-200 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  // Paid: real money, and the refund happens outside this system — paler
  // plate, darker ink.
  paid: "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200",
} as const;

function CancelOrderButton({
  target,
  size = "sm",
}: {
  target: CancelOrderTarget;
  size?: "xs" | "sm";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const signOutOnExpiry = useSessionExpiry();

  const cancel = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${target.orderId}/cancel`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        order?: { releasedUnits?: number };
      } | null;
      if (res.status === 401) {
        await signOutOnExpiry();
        return;
      }
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Gagal membatalkan pesanan. Coba lagi.");
        return;
      }
      // The route reports what it actually gave back; `unitCount` is only the
      // fallback for a response that predates the field.
      const released = data.order?.releasedUnits ?? target.unitCount;
      toast.success(
        `Pesanan ${target.bookingId} dibatalkan — ${released} unit kembali ke kuota sesi.`,
      );
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
      >
        <XIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
        Batalkan
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Batalkan {target.bookingId}?</DialogTitle>
          <DialogDescription>
            Status jadi CANCEL. {target.unitCount} unit kembali ke kuota sesi.
          </DialogDescription>
        </DialogHeader>

        {target.status === "UNPAID" ? (
          <p className={`${WARN_BASE} ${WARN_TONES.unpaid}`}>
            Pelanggan belum membayar. Sebaiknya hubungi dulu lewat WhatsApp
            sebelum membatalkan.
          </p>
        ) : (
          <p className={`${WARN_BASE} ${WARN_TONES.paid}`}>
            Pelanggan sudah membayar
            {target.jubelioSoId ? ` (SO #${target.jubelioSoId})` : ""}.
            Membatalkan berarti kamu menghubungi pelanggan dan mengatur refund di
            luar sistem.
          </p>
        )}

        <DialogFooter className="items-center justify-between gap-2 sm:justify-between">
          {target.customerWaLink.length > 0 && (
            <Button
              variant="outline"
              size="xs"
              render={<a href={target.customerWaLink} target="_blank" rel="noreferrer" />}
              nativeButton={false}
            >
              Hubungi pelanggan
            </Button>
          )}
          {/* `ml-auto` because `justify-between` with one child leaves it on the
              LEFT, which is every row whose customer has no phone. */}
          <span className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
              Kembali
            </Button>
            <Button
              variant="destructive"
              size="xs"
              isLoading={loading}
              onClick={cancel}
            >
              <XIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
              Ya, batalkan
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { CancelOrderButton };
