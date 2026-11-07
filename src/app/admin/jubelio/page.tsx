import { desc, lt } from "drizzle-orm";
import { headers } from "next/headers";
import type { Metadata } from "next";

import {
  AdminJubelioProbe,
  type ProbeCapture,
} from "@/app/_components/admin-jubelio-probe";
import {
  Pagination,
  PaginationContent,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { env } from "@/env";
import { db } from "@/server/db";
import { webhookCaptures } from "@/server/db/schema";

export const metadata: Metadata = {
  title: "Jejak Jubelio — Flash Sale Grosir Admin",
};

export const dynamic = "force-dynamic";

/** Cursor-based pagination — newest-first by id. */

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
export default async function JubelioProbePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const cursorStr = typeof sp.cursor === "string" ? sp.cursor : undefined;
  const limit = Math.min(
    Number(typeof sp.limit === "string" ? sp.limit : 20),
    100,
  );

  const caps = await db
    .select()
    .from(webhookCaptures)
    .where(cursorStr ? lt(webhookCaptures.id, cursorStr) : undefined)
    .orderBy(desc(webhookCaptures.id))
    .limit(limit + 1);

  const hasMore = caps.length > limit;
  if (hasMore) caps.pop();
  const nextCursor = hasMore ? (caps.at(-1)?.id ?? null) : null;

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
        <h1 className="font-heading text-lg font-black tracking-wider text-neutral-950 uppercase sm:text-xl dark:text-neutral-50">
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

      <Pagination>
        <PaginationContent>
          <PaginationPrevious
            href="?"
            aria-disabled={!cursorStr}
            className={
              !cursorStr ? "pointer-events-none opacity-50" : undefined
            }
          />
          {cursorStr ? (
            <a
              href="?"
              className="text-muted-foreground hover:text-foreground mx-2 text-sm"
            >
              Reset filter
            </a>
          ) : null}
          <PaginationNext
            href={nextCursor ? `?cursor=${nextCursor}` : "?"}
            aria-disabled={!nextCursor}
            className={
              !nextCursor ? "pointer-events-none opacity-50" : undefined
            }
          />
        </PaginationContent>
      </Pagination>
    </main>
  );
}
