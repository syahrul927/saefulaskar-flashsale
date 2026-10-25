import { eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { env } from "@/env";
import { db } from "@/server/db";
import { orders } from "@/server/db/schema";
import { planSync } from "@/server/daily-sync";
import { withSystemClient } from "@/server/jubelio-token";

/**
 * Daily cron: poll Jubelio sales orders and advance local order statuses
 * (spec §4.6). Guarded by the `x-cron-secret` header (=== `env.CRON_SECRET`).
 *
 * Scheduled by Vercel via `vercel.json` (`0 0 * * *`, midnight UTC). For
 * non-Vercel hosts, invoke with `node-cron` or any scheduler hitting this
 * endpoint with the secret header — the route itself is host-agnostic.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (request.headers.get("x-cron-secret") !== env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const raw = await withSystemClient((client) => client.listSalesOrders());

  const localOrders = await db
    .select({
      id: orders.id,
      jubelioSoId: orders.jubelioSoId,
      status: orders.status,
    })
    .from(orders)
    .where(isNotNull(orders.jubelioSoId));

  const patches = planSync(localOrders, raw);

  for (const patch of patches) {
    await db
      .update(orders)
      .set({ status: patch.status })
      .where(eq(orders.id, patch.orderId));
  }

  return NextResponse.json({
    ok: true,
    synced: patches.length,
    skipped: localOrders.length - patches.length,
  });
}