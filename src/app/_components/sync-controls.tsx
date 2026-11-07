"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ArrowsClockwise } from "@phosphor-icons/react/ssr";

import { useSessionExpiry } from "@/app/_components/use-session-expiry";
import {
  POLL_INTERVAL_MS,
  formatLastSyncLabel,
  shouldPollTick,
} from "@/app/_components/sync-poll";
import { Button } from "@/components/ui/button";
import type { SyncRunResult } from "@/server/order-sync";

/**
 * The orders-page header's sync controls: the same loud-free manual button
 * the page always had, plus a silent 10-second poll that keeps the panel
 * fresh while an admin keeps it open — statuses then move without waiting
 * for the page-load throttle or a manual click. The poll runs only while the
 * tab is visible and never stacks on an in-flight sweep (`shouldPollTick`),
 * and it is deliberately SILENT: no toast on any outcome, or a failing
 * upstream would toast-spam every 10 s. A failed tick just skips updating
 * the timestamp; the next tick tries again.
 *
 * Manual click keeps the old `SyncNowButton` behavior — spinner-in-place via
 * the base `Button`'s `isLoading` (which also collapses double-clicks into
 * the joined in-flight run server-side), a toast carrying the REAL counters,
 * and `router.refresh()` so the rows re-render with what the sweep wrote.
 * `Diperbarui HH.mm.ss` renders only once a run has completed, so a fresh
 * page load doesn't claim an update that hasn't happened in this tab.
 */
function SyncControls({ className }: { className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const signOutOnExpiry = useSessionExpiry();
  const inFlightRef = useRef(false);

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
      setLastSync(new Date());
      router.refresh();
    } catch {
      toast.error("Sinkronisasi gagal. Coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  // The poll: one `setInterval` for the island's lifetime, gated per tick by
  // `shouldPollTick` (visible tab, nothing in flight) — a sweep slower than
  // 10 s must not stack a second overlapping fetch. The manual click has its
  // own guard (`loading` disables the Button) and the server joins concurrent
  // runs, so a tick landing inside a manual sweep joins it harmlessly.
  useEffect(() => {
    const tick = async () => {
      if (
        !shouldPollTick({
          visible: document.visibilityState === "visible",
          inFlight: inFlightRef.current,
        })
      ) {
        return;
      }
      inFlightRef.current = true;
      try {
        const res = await fetch("/api/admin/sync", { method: "POST" });
        if (res.status === 401) {
          await signOutOnExpiry();
          return;
        }
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          result?: SyncRunResult;
        } | null;
        if (!res.ok || !data?.ok || !data.result) return; // silent
        setLastSync(new Date());
        // Refresh only when something actually moved — a no-change sweep
        // would otherwise refetch the whole server component every 10 s for
        // identical rows.
        if (data.result.synced + data.result.cancelled > 0) {
          router.refresh();
        }
      } catch {
        // Silent: a failed poll must not toast-spam every 10 s. The next
        // tick retries.
      } finally {
        inFlightRef.current = false;
      }
    };
    // `void` swallows the promise: `no-misused-promises` rejects an async
    // callback straight into `setInterval`'s void-returning slot (same
    // pattern as `payment-panel.tsx`).
    const id = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [router, signOutOnExpiry]);

  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      <Button variant="outline" size="sm" isLoading={loading} onClick={sync}>
        <ArrowsClockwise className="size-4" aria-hidden="true" />
        Sinkron sekarang
      </Button>
      {lastSync ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Diperbarui {formatLastSyncLabel(lastSync)}
        </p>
      ) : null}
    </div>
  );
}

export { SyncControls };
