import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { KpiRow } from "@/app/_components/kpi-tiles";
import { Panel } from "@/app/_components/panel";
import { SessionActions } from "@/app/_components/session-actions";
import {
  sessionStatusTone,
  StatusBadge,
} from "@/app/_components/status-badge";
import { Button } from "@/components/ui/button";
import { db } from "@/server/db";
import { flashSessions } from "@/server/db/schema";
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
 * Admin session list (spec §4.2), mockup §2 treatment: KPI tiles for the live
 * sale, then every session in one Panel — status via `StatusBadge`, date
 * window and quota figures in mono `tabular-nums`, status-transition actions.
 * A PAUSED session shows the lock note: it must be ENDed before a new one can
 * start.
 */
export default async function AdminSessionsPage() {
  const [rows, kpis] = await Promise.all([
    // Newest first (spec decision 3): the session an admin cares about is
    // the one they just created, not whatever the DB returns unordered.
    db.select().from(flashSessions).orderBy(desc(flashSessions.createdAt)),
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
        <Button variant="ink" nativeButton={false} render={<Link href="/admin/sessions/new" />}>
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
                    nativeButton={false}
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
