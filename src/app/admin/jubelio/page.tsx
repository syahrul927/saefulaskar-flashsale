import { desc } from "drizzle-orm";
import { headers } from "next/headers";
import type { Metadata } from "next";

import {
  AdminJubelioProbe,
  type ProbeCapture,
} from "@/app/_components/admin-jubelio-probe";
import { env } from "@/env";
import { db } from "@/server/db";
import { webhookCaptures } from "@/server/db/schema";

export const metadata: Metadata = {
  title: "Jejak Jubelio — Flash Sale Grosir Admin",
};

export const dynamic = "force-dynamic";

/** Newest first for the viewer. */
const RECENT_LIMIT = 40;

/**
 * Jubelio observation rig (spec §4.7). Not a reporting page — a bench.
 *
 * The question this exists to answer, because upstream documents neither a
 * payload schema nor a signature scheme: what does a Jubelio webhook POST
 * actually carry? Every read here is verbatim webhook JSON; nothing writes
 * `orders.status`, so the production sync path is untouched by whatever this
 * discovers. The per-SO snapshot panels were retired 2026-11-04 — the sync
 * sweep on the orders page already reads each linked SO, so they answered a
 * question nothing asks.
 */
export default async function JubelioProbePage() {
  const caps = await db
    .select()
    .from(webhookCaptures)
    .orderBy(desc(webhookCaptures.receivedAt))
    .limit(RECENT_LIMIT);

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
          Rekam webhook yang masuk dari Jubelio — payload aslinya, apa adanya.
        </p>
      </div>

      <AdminJubelioProbe
        captures={captureRows}
        // Token unset ⇒ the sink accepts any path segment; `open` is that
        // placeholder, and it starts failing the moment a token is set.
        sinkUrl={`${proto}://${host}/api/jubelio/webhook-sink/${token ?? "open"}`}
        tokenConfigured={Boolean(token)}
      />
    </main>
  );
}
