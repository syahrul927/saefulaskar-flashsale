import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { env } from "@/env";
import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { jubelioSoSnapshots } from "@/server/db/schema";
import { JubelioError } from "@/lib/jubelio";
import { withSystemClient } from "@/server/jubelio-token";
import { diffProbeFields, readProbeFields } from "@/server/jubelio-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/jubelio/snapshot — one read of `GET /sales/orders/{id}`,
 * stored verbatim, diffed against the previous read of the same SO.
 *
 * This is the manual half of the rig (spec §4.7): snapshot an SO, create its
 * faktur in Jubelio, snapshot again, and the diff answers the question the docs
 * cannot — which fields does invoicing actually move. It is observation only:
 * nothing here writes `orders.status`. Production sync stays where it is.
 */

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

const Body = z.object({
  salesorderId: z.number().int().positive(),
  orderId: z.string().uuid().optional(),
  label: z.string().trim().max(60).optional(),
});

export async function POST(request: Request) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "salesorderId wajib nomor positif");

  const { salesorderId, orderId, label } = parsed.data;

  let raw: unknown;
  try {
    raw = await withSystemClient((client) => client.getSalesOrder(salesorderId));
  } catch (e) {
    if (e instanceof JubelioError) {
      return jsonError(502, `Jubelio: ${e.message}`);
    }
    console.error("so snapshot: fetch failed", e);
    return jsonError(502, "Gagal mengambil sales order dari Jubelio");
  }

  const fields = readProbeFields(raw);
  const trimmed = label?.trim() ? label.trim() : null;

  const [previous] = await db
    .select()
    .from(jubelioSoSnapshots)
    .where(and(eq(jubelioSoSnapshots.salesorderId, salesorderId)))
    .orderBy(desc(jubelioSoSnapshots.capturedAt))
    .limit(1);

  const [stored] = await db
    .insert(jubelioSoSnapshots)
    .values({
      salesorderId,
      orderId: orderId ?? null,
      label: trimmed,
      capturedBy: auth.user.email ?? auth.user.id,
      internalStatus: fields?.internalStatus ?? null,
      channelStatus: fields?.channelStatus ?? null,
      wmsStatus: fields?.wmsStatus ?? null,
      invoiceNo: fields?.invoiceNo ?? null,
      trackingNumber: fields?.trackingNumber ?? null,
      raw,
    })
    .returning();

  return Response.json({
    ok: true,
    snapshot: stored,
    fields,
    // What changed since this SO's previous read — empty on the first one, and
    // the response says so via `previousCapturedAt: null` so the UI can tell
    // "nothing moved" apart from "nothing to compare against".
    diff: previous ? diffProbeFields(previous.raw, raw) : [],
    previousCapturedAt: previous?.capturedAt ?? null,
    sinkEnabled: Boolean(env.JUBELIO_WEBHOOK_SINK_TOKEN?.trim()),
  });
}
