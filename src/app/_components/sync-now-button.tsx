"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ArrowsClockwise } from "@phosphor-icons/react/ssr";

import { useSessionExpiry } from "@/app/_components/use-session-expiry";
import { Button } from "@/components/ui/button";
import type { SyncRunResult } from "@/server/order-sync";

/**
 * `Sinkron sekarang` (manual sync) — the orders-page header's one loud-free
 * action: an outline button next to the title, spinner-in-place while the
 * pass runs (the base `Button` disables itself and sets `aria-busy`), and a
 * toast that carries the REAL counters, the way the cancel button carries the
 * units it actually released. `router.refresh()` re-renders the rows with the
 * statuses the sweep just wrote.
 *
 * The pass can take seconds — one upstream read per linked SO. That is what
 * the spinner is for; the button staying disabled also collapses double-clicks
 * server-side into the joined in-flight run.
 */
function SyncNowButton({ className }: { className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const signOutOnExpiry = useSessionExpiry();

  const sync = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/sync", { method: "POST" });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        result?: SyncRunResult;
      } | null;
      if (res.status === 401) {
        await signOutOnExpiry();
        return;
      }
      if (!res.ok || !data?.ok || !data.result) {
        toast.error(data?.error ?? "Sinkronisasi gagal. Coba lagi.");
        return;
      }
      const r = data.result;
      // Zeros drop out except `checked`, which is the subject line: "36
      // pesanan diperiksa" with no changes is a SUCCESSFUL sync, and must not
      // read like a failure.
      const bits = [`${r.checked} pesanan diperiksa`];
      if (r.synced > 0) bits.push(`${r.synced} status diperbarui`);
      if (r.cancelled > 0) bits.push(`${r.cancelled} dibatalkan`);
      if (r.skipped > 0) bits.push(`${r.skipped} dilewati`);
      if (r.failed > 0) bits.push(`${r.failed} gagal dibaca`);
      toast.success(`Sinkronisasi selesai — ${bits.join(", ")}.`);
      router.refresh();
    } catch {
      toast.error("Sinkronisasi gagal. Coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      isLoading={loading}
      onClick={sync}
    >
      <ArrowsClockwise className="size-4" aria-hidden="true" />
      Sinkron sekarang
    </Button>
  );
}

export { SyncNowButton };
