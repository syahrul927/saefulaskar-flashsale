import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { env } from "@/env";
import { db } from "@/server/db";
import { orders, webhookCaptures } from "@/server/db/schema";
import { decideHookFlip, parseHookEvent, checkHookToken } from "@/server/invoice-hook";
import {
  captureBody,
  detectCaptureRefs,
  redactHeaders,
} from "@/server/jubelio-probe";
import { readSalesOrderState } from "@/server/daily-sync";
import { cancelOrder } from "@/server/cancel-order";
import { END_STATUSES } from "@/server/order-status";
import { recordStatusChange } from "@/server/status-history";
import { withSystemClient } from "@/server/jubelio-token";

/**
 * The hook-invoice consumer — the write half of the Jubelio webhook rig
 * (spec 2026-11-08 §4.1–§4.3). When the faktur is formed upstream, Jubelio
 * POSTs `hook-invoice` with `ref_no` echoing the SO's `salesorder_no`
 * (`SO-000192297` for ours, `SP-…` for marketplace traffic). The hook is only
 * a hint: the route joins it to a local order, re-fetches the SO with the
 * system account, and lets THAT response decide — a webhook must never move an
 * order the fetched SO contradicts.
 *
 * Separate from the observation sink (`webhook-sink/[token]`), with one
 * inverted default: the sink is open while no token is configured (it has to
 * work before anyone mints a secret); this route WRITES ORDER STATUS, so an
 * unset `JUBELIO_WEBHOOK_SINK_TOKEN` means CLOSED — 401 to everything. One
 * secret to rotate, two very different failure modes.
 *
 * Every non-auth outcome answers `200 {ok: …}` fast — Jubelio retries what
 * looks like a failure, and duplicated deliveries are the expected shape, not
 * an emergency. A body we cannot consume is never a 5xx.
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
  if (!checkHookToken(token, env.JUBELIO_WEBHOOK_SINK_TOKEN)) {
    return NextResponse.json(
      { ok: false, error: "Token webhook tidak valid." },
      { status: 401 },
    );
  }

  const text = await readText(request);
  const contentType = request.headers.get("content-type");
  const captured = captureBody(text, contentType);
  const refs = detectCaptureRefs(captured.body ?? captured.rawBody);
  const event = parseHookEvent(captured.body);

  // Verbatim capture continues here (spec §4.1): repointing the invoice
  // callback to this route takes the event away from the sink, so the
  // consumer stores what arrived before deciding anything — the bench keeps
  // feeding while the join is young. Best-effort like the sink's prune: the
  // capture is evidence, not a dependency, and a failed insert must never
  // block the flip.
  const source =
    event === null
      ? "hook"
      : event.action === "other"
        ? `hook:${event.actionName}`
        : "hook:hook-invoice";
  try {
    await db.insert(webhookCaptures).values({
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
    });
    try {
      await db
        .delete(webhookCaptures)
        .where(sql`${webhookCaptures.id} not in (
            select id from ${webhookCaptures}
            order by received_at desc, id desc
            limit ${KEEP_CAPTURES}
          )`);
    } catch (e) {
      console.error("hook: capture prune failed", e);
    }
  } catch (e) {
    console.error("hook: capture store failed", e);
  }

  if (event === null) {
    return NextResponse.json({ ok: false, reason: "unparseable" });
  }
  if (event.action === "other") {
    // Unknown actions are expected traffic — the dashboard may deliver other
    // events to this URL. Logged above via the capture's source label.
    return NextResponse.json({ ok: false, reason: "unhandled action" });
  }
  const { salesorderId, invoiceId, invoiceNo } = event;
  if (salesorderId === null) {
    return NextResponse.json({ ok: false, reason: "unjoined" });
  }

  // Newest wins on a multi-match anomaly (no unique constraint on
  // jubelio_so_id): act on the head of the newest-first match set and LOG the
  // anomaly rather than silently burying it (spec §4.2). Two rows is the
  // smallest fetch that can prove "more than one"; the second row is read for
  // the count only, never acted on.
  const matches = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(eq(orders.jubelioSoId, salesorderId))
    .orderBy(desc(orders.createdAt))
    .limit(2);
  const [order] = matches;
  if (!order) {
    return NextResponse.json({ ok: false, reason: "unjoined" });
  }
  if (matches.length > 1) {
    console.error(
      `hook-invoice: multiple orders match SO #${salesorderId} — acting on the newest (${order.id})`,
    );
  }

  // The hint is only a reason to look; the fetched SO is the evidence
  // (spec §4.3). Same system-account rule as the sync: the write must not
  // depend on whichever admin's page happened to be open.
  let state;
  try {
    state = readSalesOrderState(
      await withSystemClient((client) => client.getSalesOrder(salesorderId)),
    );
  } catch (e) {
    console.error(`hook: SO ${salesorderId} unreadable for ${order.id}`, e);
    return NextResponse.json({ ok: false, reason: "upstream-unreadable" });
  }
  if (!state) {
    console.error(
      `hook: SO ${salesorderId} answered without internal_status for ${order.id}`,
    );
    return NextResponse.json({ ok: false, reason: "upstream-unreadable" });
  }

  if (decideHookFlip(state.internalStatus) === "cancel") {
    // A faktur hook for a since-cancelled SO is stale or out of order. The
    // cancel service is the one writer of CANCEL and releases quota correctly;
    // the hook must not lift the order to COMPLETED over its head (spec §4.3).
    const result = await cancelOrder(db, {
      orderId: order.id,
      source: "sync",
      note: `SO #${salesorderId} dibatalkan di Jubelio`,
    });
    return NextResponse.json({ ok: true, changed: result.cancelled });
  }

  if (order.status === "UNPAID") {
    console.info(
      `hook-invoice: SO #${salesorderId} arrived for an UNPAID order — confirm flow owns this`,
    );
    return NextResponse.json({ ok: false, reason: "not-confirmed" });
  }

  const outcome = await db.transaction(async (tx) => {
    // The confirm-route discipline (spec §4.5): the read at the top of the
    // handler is stale by the time we get here — a cancel or a confirm may
    // have landed in between. The write re-reads the LIVE status under
    // FOR UPDATE and commits only from it.
    const [current] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id))
      .for("update");
    if (!current) return { ok: false as const, reason: "unjoined" };

    if (current.status === "UNPAID") {
      console.info(
        `hook-invoice: SO #${salesorderId} arrived for an UNPAID order — confirm flow owns this`,
      );
      return { ok: false as const, reason: "not-confirmed" };
    }

    if (current.status === "COMPLETED" || current.status === "CANCEL") {
      // The retried hook (spec §4.3.4): refresh the faktur identity only —
      // idempotent rewrites are fine — and write no history row for a
      // transition that did not happen.
      await tx
        .update(orders)
        .set({ invoiceId, invoiceNo })
        .where(eq(orders.id, order.id));
      return { ok: true as const, changed: false };
    }

    // CONFIRMED, legacy SHIPPED, anything non-end non-UNPAID: the faktur is
    // the COMPLETED trigger. The end-state predicate stays on the UPDATE —
    // the belt if the lock is ever widened away.
    const rows = await tx
      .update(orders)
      .set({ status: "COMPLETED", invoiceId, invoiceNo })
      .where(
        and(eq(orders.id, order.id), notInArray(orders.status, [...END_STATUSES])),
      )
      .returning({ id: orders.id });
    if (rows.length !== 1) {
      // Race lost (an admin cancelled between pre-read and UPDATE). Answered
      // as a quiet no-op, never as an invented ledger row (spec §4.5).
      return { ok: true as const, changed: false };
    }
    await recordStatusChange(tx, {
      orderId: order.id,
      fromStatus: current.status,
      toStatus: "COMPLETED",
      source: "sync",
      note: null,
    });
    return { ok: true as const, changed: true };
  });

  return NextResponse.json(outcome);
}
