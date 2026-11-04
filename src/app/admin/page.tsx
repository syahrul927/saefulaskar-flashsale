import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { KpiRow, KpiTile } from "@/app/_components/kpi-tiles";
import { Panel } from "@/app/_components/panel";
import { SessionActions } from "@/app/_components/session-actions";
import { SessionListFilter } from "@/app/_components/session-list-filter";
import {
  sessionStatusTone,
  StatusBadge,
  type SessionStatus,
} from "@/app/_components/status-badge";
import { formatClaimPercent } from "@/app/admin/format";
import { formatRupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { formatGmvDelta, getGlobalKpis } from "@/server/console-kpi";
import { db } from "@/server/db";
import { flashSessions } from "@/server/db/schema";
import { activationPreview, type ActivationBlockReason } from "@/server/session-rules";
import { getSessionKpis } from "@/server/session-query";

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

/**
 * One session row — server-rendered, handed to the client filter island as a
 * ReactNode prop (same pattern as the admin orders list). Markup unchanged
 * from the pre-filter inline version, except `blockReason`: the proactive
 * activation verdict (see `activationPreview`) so a doomed Aktifkan is
 * disabled before the click instead of failing with a 409 toast after it.
 */
function SessionListItem({
  s,
  blockReason,
}: {
  s: typeof flashSessions.$inferSelect;
  blockReason: ActivationBlockReason | null;
}) {
  return (
    <li className="p-4 sm:p-5">
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
          nativeButton={false}
          render={<Link href={`/admin/sessions/${s.id}/products`} />}
        >
          Produk
        </Button>
      </div>

      <div className="mt-4">
        <SessionActions
          sessionId={s.id}
          status={s.status}
          blockReason={blockReason}
        />
      </div>
    </li>
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
  const [rows, kpis, global] = await Promise.all([
    // Newest first (spec decision 3): the session an admin cares about is
    // the one they just created, not whatever the DB returns unordered.
    db.select().from(flashSessions).orderBy(desc(flashSessions.createdAt)),
    getSessionKpis(db),
    getGlobalKpis(db),
  ]);

  const paused = rows.some((r) => r.status === "PAUSED");

  // Tile 3's copy + deep link: prefer the ACTIVE session, else the next
  // SCHEDULED one. `formatRange` is deliberately NOT reused here — it
  // collapses to "—" whenever either bound is null, and SCHEDULED sessions
  // may have no startTime yet (review-focus pin: must not crash the copy).
  const when = global.nextScheduled?.startTime
    ? global.nextScheduled.startTime.toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
  const sessionTile = global.activeSession
    ? {
        value: global.activeSession.name,
        hint: "sedang berlangsung",
        href: `/admin/sessions/${global.activeSession.id}/products`,
      }
    : global.nextScheduled
      ? {
          value: "Tidak ada",
          hint: `berikutnya: ${global.nextScheduled.name} · ${when}`,
          href: `/admin/sessions/${global.nextScheduled.id}/products`,
        }
      : { value: "Tidak ada", hint: "belum ada sesi terjadwal", href: undefined };

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
        <Button variant="ink" nativeButton={false} render={<Link href="/admin/sessions/new" />}>
          Sesi Baru
        </Button>
      </div>

      {/* Global summary (spec decision 5) — cross-session numbers first,
          then the live session's own metrics below. */}
      <section aria-label="Ringkasan" className="space-y-2">
        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Ringkasan
        </p>

        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <KpiTile
            label="PERLU KONFIRMASI"
            value={String(global.unpaidWithProof)}
            hint={`${global.unpaidWithProof} dari ${global.unpaidTotal} belum bayar`}
            // Brand colour only when there is work to do; at 0 the default
            // ink wins so exactly one text-colour class lands (KpiTile rule).
            valueClassName={
              global.unpaidWithProof > 0 ? "text-brand-primary" : undefined
            }
            href="/admin/orders?status=UNPAID"
          />
          <KpiTile
            label="GMV HARI INI"
            value={formatRupiah(global.gmvToday)}
            hint={formatGmvDelta(global.gmvToday, global.gmvYesterday)}
            valueClassName="text-emerald-600"
          />
          <KpiTile
            label="SESI AKTIF"
            value={sessionTile.value}
            hint={sessionTile.hint}
            href={sessionTile.href}
          />
          <KpiTile
            label="KLAIM vs KUOTA"
            value={`${global.totalClaimed}/${global.totalQuota}`}
            hint={formatClaimPercent(global.totalClaimed, global.totalQuota)}
          />
        </div>
      </section>

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
          <SessionListFilter
            rows={rows.map((s) => ({
              id: s.id,
              status: s.status,
              // Pre-compute the activation verdict from the already-loaded
              // list (same rules as the API's `canActivate`) — only SCHEDULED
              // rows render an Aktifkan button, so only they need it.
              node: (
                <SessionListItem
                  key={s.id}
                  s={s}
                  blockReason={
                    s.status === "SCHEDULED"
                      ? activationPreview(rows, s.id)
                      : null
                  }
                />
              ),
            }))}
            counts={rows.reduce<Record<"ALL" | SessionStatus, number>>(
              (acc, s) => {
                acc.ALL += 1;
                acc[s.status] += 1;
                return acc;
              },
              { ALL: 0, SCHEDULED: 0, ACTIVE: 0, PAUSED: 0, ENDED: 0 },
            )}
          />
        )}
      </Panel>
    </main>
  );
}
