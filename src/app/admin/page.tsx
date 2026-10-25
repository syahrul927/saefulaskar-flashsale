import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/server/db";
import { flashSessions } from "@/server/db/schema";
import { SessionActions } from "@/app/_components/session-actions";

export const metadata: Metadata = {
  title: "Sesi — Flash Studio Admin",
};

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  SCHEDULED: "outline",
  ACTIVE: "default",
  PAUSED: "secondary",
  ENDED: "secondary",
};

function formatRange(start: Date | null, end: Date | null): string {
  if (!start || !end) return "—";
  const fmt = (d: Date) =>
    d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  return `${fmt(start)} — ${fmt(end)}`;
}

/**
 * Admin session list (spec §4.2). Overview of every session with status badge,
 * date window, product-count link, and status-transition actions. A PAUSED
 * session shows the lock note: it must be ENDed before a new one can start.
 */
export default async function AdminSessionsPage() {
  const rows = await db.select().from(flashSessions);

  const paused = rows.some((r) => r.status === "PAUSED");

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Sesi
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kelola jadwal flash sale, atur status, dan pilih produk.
          </p>
        </div>
        <Button render={<Link href="/admin/sessions/new" />}>
          Sesi Baru
        </Button>
      </div>

      {paused && (
        <div className="rounded-4xl border border-border bg-muted/60 p-4 text-sm text-muted-foreground">
          Ada sesi berstatus <span className="font-medium">PAUSED</span>.
          Akhiri sesi yang sedang dijeda sebelum membuat sesi baru.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-4xl border border-border bg-card p-10 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            Belum ada sesi. Mulai dengan &ldquo;Sesi Baru&rdquo;.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((s) => (
            <section
              key={s.id}
              className="rounded-4xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-semibold text-foreground">
                      {s.name}
                    </h2>
                    <Badge variant={STATUS_VARIANT[s.status] ?? "secondary"}>
                      {s.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatRange(s.startTime, s.endTime)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  render={
                    <Link href={`/admin/sessions/${s.id}/products`} />
                  }
                >
                  Produk
                </Button>
              </div>

              <div className="mt-4">
                <SessionActions sessionId={s.id} status={s.status} />
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}