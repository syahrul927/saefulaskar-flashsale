import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { env } from "@/env";
import { db } from "@/server/db";
import { webhookCaptures } from "@/server/db/schema";
import {
  captureBody,
  checkSinkToken,
  detectCaptureRefs,
  redactHeaders,
} from "@/server/jubelio-probe";

/**
 * Public webhook sink — the observation half of the Jubelio rig (spec §4.7).
 *
 * Jubelio's dashboard takes one callback URL per event and offers no place to
 * add a header, so the credential rides in the path:
 * `POST /api/jubelio/webhook-sink/<JUBELIO_WEBHOOK_SINK_TOKEN>?event=<name>`.
 * The route accepts ANY JSON body with ANY headers and stores what arrived —
 * the capture is the documentation, because upstream publishes neither a payload
 * schema nor a signature scheme, and has been wrong about everything else we
 * assumed here.
 *
 * Two deliberate limits:
 * - Unset token ⇒ 503 and nothing stored. A public, unauthenticated,
 *   DB-writing endpoint has to be switched on on purpose, never by default.
 * - Bodies over `SINK_MAX_BODY_BYTES` are cut and flagged; headers are
 *   credential-redacted before they are written, because this table is readable
 *   by any admin and a live JWT has already been pasted around this repo once.
 *
 * Always answers 2xx/4xx fast — a handler that stalls makes Jubelio retry, and
 * duplicated captures are noise we have to read through later.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Captures kept before the oldest are pruned. Debug data, not a ledger. */
const KEEP_CAPTURES = 200;

async function readText(request: Request): Promise<string> {
  try {
    return await request.text();
  } catch {
    // Malformed/aborted upload still counts as an arrival worth recording.
    return "";
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const verdict = checkSinkToken(token, env.JUBELIO_WEBHOOK_SINK_TOKEN);
  if (!verdict.ok) {
    return NextResponse.json(
      verdict.reason === "not-configured"
        ? {
            ok: false,
            error:
              "Sink tidak dikonfigurasi — set JUBELIO_WEBHOOK_SINK_TOKEN untuk menyimpan webhook.",
          }
        : { ok: false, error: "Token webhook tidak valid." },
      { status: verdict.reason === "not-configured" ? 503 : 401 },
    );
  }

  const text = await readText(request);
  const contentType = request.headers.get("content-type");
  const captured = captureBody(text, contentType);
  const refs = detectCaptureRefs(captured.body ?? captured.rawBody);

  // `?event=` is how we tell two callbacks apart when both hit this URL; when
  // Jubelio does not send it, the body's own keys are the only label we get.
  const source =
    new URL(request.url).searchParams.get("event")?.slice(0, 60) || "unknown";

  try {
    const [row] = await db
      .insert(webhookCaptures)
      .values({
        source,
        method: request.method,
        contentType,
        headers: redactHeaders(Object.fromEntries(request.headers.entries())),
        body: captured.body,
        rawBody: captured.rawBody,
        truncated: captured.truncated,
        byteLength: captured.byteLength,
        salesorderId: refs.salesorderId,
        invoiceId: refs.invoiceId,
        refNo: refs.refNo,
      })
      .returning({ id: webhookCaptures.id });

    // Pruning is best-effort: a failure here must not lose the capture that
    // already landed, and the cap is a courtesy, not a guarantee.
    try {
      await db.delete(webhookCaptures).where(sql`${webhookCaptures.id} not in (
          select id from ${webhookCaptures}
          order by received_at desc, id desc
          limit ${KEEP_CAPTURES}
        )`);
    } catch (e) {
      console.error("webhook sink: prune failed", e);
    }

    return NextResponse.json({ ok: true, id: row?.id, ...refs });
  } catch (e) {
    console.error("webhook sink: store failed", e);
    return NextResponse.json(
      { ok: false, error: "Gagal menyimpan capture" },
      { status: 500 },
    );
  }
}
