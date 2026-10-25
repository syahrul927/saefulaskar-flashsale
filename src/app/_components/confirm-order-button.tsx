"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * "Konfirmasi Bayar" — calls `POST /api/orders/[id]/confirm` with a confirm
 * dialog (admin action, spec §4.5). isLoading during the call; toasts both
 * outcomes.
 */
function ConfirmOrderButton({ orderId, bookingId }: { orderId: string; bookingId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    const ok = window.confirm(
      `Konfirmasi pembayaran untuk ${bookingId}? Sales order Jubelio akan dibuat.`,
    );
    if (!ok) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/confirm`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Konfirmasi gagal, coba lagi.");
        return;
      }
      toast.success("Pembayaran dikonfirmasi, sales order dibuat.");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button size="sm" disabled={loading} onClick={handle}>
      {loading ? <Spinner /> : null}
      {loading ? "Memproses..." : "Konfirmasi Bayar"}
    </Button>
  );
}

export { ConfirmOrderButton };