import type { Metadata } from "next";
import Link from "next/link";

import { cn } from "cn";

import { Panel } from "@/app/_components/panel";
import { SessionActions } from "@/app/_components/session-actions";
import {
  sessionStatusTone,
  StatusBadge,
} from "@/app/_components/status-badge";
import {
  formatClaimPercent,
  formatCompactRupiah,
} from "@/app/admin/format";
import { formatRupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { db } from "@/server/db";
import { flashSessions } from "@/server/db/schema";
import { getSessionKpis, type SessionKpis } from "@/server/session-query";

export const metadata: Metadata = {
  title: "Konsol — Flash Studio Admin",
};

export const dynamic = "force-dynamic";

function formatRange(start: Date | null, end: Date | null): string {
  if (!start || !end) return "—";
  const fmt = (d: Date) =>
    d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  return `${fmt(start)} — ${fmt(end)}`;
}

/** KPI tile shell — design.html:235-253. */
function KpiTile({
  label,
  value,
  unit,
  hint,
  valueClassName,
}: {
  label: string;
  value: string;
  /** Suffix sitting on the value line, e.g. `SKU` / `unit`. */
  unit?: string;
  /** Small mono line under the value: quota share or compact rupiah. */
  hint?: string;
  /** Colour override for the value (reserved = brand, GMV = emerald). */
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-3 dark:border-border dark:bg-muted">
      <span className="block text-[8px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <span
        title={value}
        className={cn(
          "mt-1 flex min-w-0 items-baseline gap-1 font-mono text-lg font-bold tabular-nums",
          // Default wins when the caller passes no colour, so exactly one
          // text-colour class lands on the value line.
          valueClassName ?? "text-neutral-950 dark:text-neutral-50",
        )}
      >
        <span className="min-w-0 truncate">{value}</span>
        {unit && (
          <span className="shrink-0 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
            {unit}
          </span>
        )}
      </span>
      {hint && (
        <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * KPI tiles for the live sale. Numbers come from `getSessionKpis`, which only
 * answers for the primary ACTIVE session — so the row is hidden entirely when
 * nothing is running, rather than showing a wall of zeros.
 */
function KpiRow({ kpis }: { kpis: SessionKpis }) {
  return (
    <section aria-label="KPI sesi aktif" className="space-y-2">
      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        Metrik Sesi Aktif
      </p>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <KpiTile
          label="PRODUK DIDAFTARKAN"
          value={String(kpis.productCount)}
          unit="SKU"
        />
        <KpiTile
          label="TOTAL KUOTA SALE"
          value={String(kpis.totalQuota)}
          unit="unit"
        />
        <KpiTile
          label="RESERVED / TERJUAL"
          value={String(kpis.totalClaimed)}
          unit="unit"
          valueClassName="text-brand-secondary"
          hint={`${kpis.totalClaimed}/${kpis.totalQuota} (${formatClaimPercent(
            kpis.totalClaimed,
            kpis.totalQuota,
          )})`}
        />
        <KpiTile
          label="ESTIMASI GMV"
          value={formatRupiah(kpis.estimatedGmv)}
          valueClassName="text-emerald-600"
          hint={formatCompactRupiah(kpis.estimatedGmv)}
        />
      </div>
    </section>
  );
}

/**
 * Admin session list (spec §4.2), mockup §2 treatment: KPI tiles for the live
 * sale, then every session in one Panel — status via `StatusBadge`, date
 * window and quota figures in mono `tabular-nums`, status-transition actions.
 * A PAUSED session shows the lock note: it must be ENDed before a new one can
 * start.
 */
export default async function AdminSessionsPage() {
  const [rows, kpis] = await Promise.all([
    db.select().from(flashSessions),
    getSessionKpis(db),
  ]);

  const paused = rows.some((r) => r.status === "PAUSED");

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-lg font-black uppercase tracking-wider text-neutral-950 sm:text-xl dark:text-neutral-50">
            Konsol
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Kelola jadwal flash sale, atur status, dan pilih produk.
          </p>
        </div>
        <Button variant="ink" render={<Link href="/admin/sessions/new" />}>
          Sesi Baru
        </Button>
      </div>

      {kpis && <KpiRow kpis={kpis} />}

      {paused && (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600 dark:border-border dark:bg-muted dark:text-neutral-300">
          Ada sesi berstatus <span className="font-medium">PAUSED</span>.
          Akhiri sesi yang sedang dijeda sebelum membuat sesi baru.
        </div>
      )}

      <Panel title="Daftar Sesi" count={`${rows.length} sesi`}>
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Belum ada sesi. Mulai dengan &ldquo;Sesi Baru&rdquo;.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-border">
            {rows.map((s) => (
              <li key={s.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate font-semibold text-neutral-950 dark:text-neutral-50">
                        {s.name}
                      </h4>
                      <StatusBadge
                        tone={sessionStatusTone(s.status)}
                        pulse={s.status === "ACTIVE"}
                      >
                        {s.status}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 font-mono text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                      {formatRange(s.startTime, s.endTime)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    render={<Link href={`/admin/sessions/${s.id}/products`} />}
                  >
                    Produk
                  </Button>
                </div>

                <div className="mt-4">
                  <SessionActions sessionId={s.id} status={s.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
