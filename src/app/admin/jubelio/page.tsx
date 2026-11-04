import { desc, isNotNull } from "drizzle-orm";
import { headers } from "next/headers";
import type { Metadata } from "next";

import {
  AdminJubelioProbe,
  type ProbeCapture,
  type ProbeOrder,
  type ProbeSnapshot,
} from "@/app/_components/admin-jubelio-probe";
import { env } from "@/env";
import { db } from "@/server/db";
import { jubelioSoSnapshots, orders, webhookCaptures } from "@/server/db/schema";
import { diffProbeFields } from "@/server/jubelio-probe";

export const metadata: Metadata = {
  title: "Jejak Jubelio — Flash Sale Grosir Admin",
};

export const dynamic = "force-dynamic";

/** Newest reads first for the viewer; the diff pass re-sorts per SO anyway. */
const RECENT_LIMIT = 40;
const LINKED_LIMIT = 50;

/**
 * Jubelio observation rig (spec §4.7). Not a reporting page — a bench.
 *
 * Two things this exists to find out, because upstream documents neither: what
 * a Jubelio webhook POST actually carries (the sink), and which sales-order
 * fields a created faktur moves (the snapshot diff). Every read here is
 * verbatim Jubelio JSON; nothing writes `orders.status`, so the production sync
 * path is untouched by whatever this discovers.
 */
export default async function JubelioProbePage() {
  const [linked, snaps, caps] = await Promise.all([
    db
      .select({
        orderId: orders.id,
        bookingId: orders.bookingId,
        status: orders.status,
        salesorderId: orders.jubelioSoId,
      })
      .from(orders)
      .where(isNotNull(orders.jubelioSoId))
      .orderBy(desc(orders.createdAt))
      .limit(LINKED_LIMIT),
    db
      .select()
      .from(jubelioSoSnapshots)
      .orderBy(desc(jubelioSoSnapshots.capturedAt))
      .limit(RECENT_LIMIT),
    db
      .select()
      .from(webhookCaptures)
      .orderBy(desc(webhookCaptures.receivedAt))
      .limit(RECENT_LIMIT),
  ]);

  // Diff each snapshot against the one before it for the SAME SO, keyed by
  // snapshot id. The pair's earlier timestamp is stored with it: without it,
  // "0 changes" cannot be told apart from "there was nothing to compare".
  const comparisons: Record<
    string,
    { entries: ReturnType<typeof diffProbeFields>; against: string }
  > = {};
  const bySo = new Map<number, typeof snaps>();
  for (const snap of snaps) {
    bySo.set(snap.salesorderId, [...(bySo.get(snap.salesorderId) ?? []), snap]);
  }
  for (const group of bySo.values()) {
    // Rows came newest-first; walk oldest→newest so `prev` is the earlier read.
    const chronological = [...group].reverse();
    for (let i = 1; i < chronological.length; i += 1) {
      const prev = chronological[i - 1];
      const current = chronological[i];
      if (!prev || !current) continue;
      comparisons[current.id] = {
        entries: diffProbeFields(prev.raw, current.raw),
        against: prev.capturedAt.toISOString(),
      };
    }
  }

  const bookingBySo = new Map(
    linked.map((o) => [o.salesorderId as number, o.bookingId]),
  );

  const snapshotRows: ProbeSnapshot[] = snaps.map((s) => ({
    id: s.id,
    salesorderId: s.salesorderId,
    bookingId: bookingBySo.get(s.salesorderId) ?? null,
    label: s.label,
    capturedBy: s.capturedBy,
    capturedAt: s.capturedAt.toISOString(),
    internalStatus: s.internalStatus,
    channelStatus: s.channelStatus,
    wmsStatus: s.wmsStatus,
    invoiceNo: s.invoiceNo,
    trackingNumber: s.trackingNumber,
    raw: s.raw,
    diff: comparisons[s.id]?.entries ?? [],
    previousCapturedAt: comparisons[s.id]?.against ?? null,
  }));

  const captureRows: ProbeCapture[] = caps.map((c) => ({
    id: c.id,
    source: c.source,
    receivedAt: c.receivedAt.toISOString(),
    method: c.method,
    contentType: c.contentType,
    headers: c.headers,
    body: c.body,
    rawBody: c.rawBody,
    truncated: c.truncated,
    byteLength: c.byteLength,
    salesorderId: c.salesorderId,
    invoiceId: c.invoiceId,
    refNo: c.refNo,
  }));

  const orderRows: ProbeOrder[] = linked.map((o) => ({
    orderId: o.orderId,
    bookingId: o.bookingId,
    status: o.status,
    // The WHERE clause already excludes NULL; the alias just hides it from TS.
    salesorderId: o.salesorderId as number,
  }));

  // The callback URL is built from the live request, not an env var: this page
  // gets opened from localhost, a preview URL and production, and a URL copied
  // from the wrong one silently sends test traffic to the wrong place.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const token = env.JUBELIO_WEBHOOK_SINK_TOKEN?.trim();

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-heading text-lg font-black uppercase tracking-wider text-neutral-950 sm:text-xl dark:text-neutral-50">
          Jejak Jubelio
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Rekam webhook yang masuk dan bandingkan dua pembacaan sales order —
          untuk melihat apa yang berubah ketika faktur dibuat.
        </p>
      </div>

      <AdminJubelioProbe
        orders={orderRows}
        snapshots={snapshotRows}
        captures={captureRows}
        sinkUrl={token ? `${proto}://${host}/api/jubelio/webhook-sink/${token}` : null}
      />
    </main>
  );
}
