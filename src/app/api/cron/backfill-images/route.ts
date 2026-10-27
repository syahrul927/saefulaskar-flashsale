import { eq, isNull } from "drizzle-orm";

import { env } from "@/env";
import { db } from "@/server/db";
import { sessionProducts } from "@/server/db/schema";
import { getStockMap } from "@/server/jubelio-catalog";
import { withSystemClient } from "@/server/jubelio-token";
import { planImageBackfill } from "@/server/backfill-images";

/**
 * One-time (idempotent) backfill: `session_products.image_url` was added
 * after products had already been imported, so existing rows have the stock
 * snapshot but no photo. This fills them from the same v2 thumbnail the
 * import path would have stored, using the system token — no admin session
 * needed, no re-import. Guarded by `x-cron-secret` exactly like
 * `daily-sync` (spec §4.6 idiom):
 *
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/backfill-images
 *
 * Only rows with `image_url IS NULL` are read, so a second run after the
 * first is a cheap no-op, and rows v2 has no picture for stay untouched
 * (they keep the letter tile and remain eligible).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (request.headers.get("x-cron-secret") !== env.CRON_SECRET) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({ id: sessionProducts.id, itemId: sessionProducts.itemId })
    .from(sessionProducts)
    .where(isNull(sessionProducts.imageUrl));

  // The v2 fetch is the only upstream step; db writes happen outside the
  // auth-retry wrapper so a mid-write failure never re-fetches behind it.
  const map = await withSystemClient((client) => getStockMap(client));

  const patches = planImageBackfill(rows, map);
  for (const patch of patches) {
    await db
      .update(sessionProducts)
      .set({ imageUrl: patch.imageUrl })
      .where(eq(sessionProducts.id, patch.id));
  }

  return Response.json({
    ok: true,
    scanned: rows.length,
    filled: patches.length,
  });
}
