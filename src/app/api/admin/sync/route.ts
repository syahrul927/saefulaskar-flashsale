import { getSession } from "@/server/better-auth/server";
import { forceRunOrderSync } from "@/server/order-sync";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

/**
 * POST /api/admin/sync — the manual order-status sync behind the `Sinkron
 * sekarang` button on `/admin/orders`. OWNER-only, same door check as the
 * other admin writes.
 *
 * There is no webhook and no cron (PRD §4.2): statuses move on the throttled
 * page-load pass or on this button. The button bypasses the 5-minute throttle
 * but shares the throttled instance — a click while a sweep is in flight JOINS
 * that pass, and a completed run stamps the clock so the next page load does
 * not sweep twice for nothing.
 *
 * The response is the pass's own counters, verbatim, so the toast can say what
 * actually happened. Per-order Jubelio failures are isolated inside
 * `runOrderSync` and surface as `failed` — a 500 here means the whole pass
 * threw: the system-account login or the DB, not one bad SO.
 */
export async function POST() {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

  try {
    const result = await forceRunOrderSync();
    return Response.json({ ok: true, result });
  } catch (e) {
    console.error("manual sync failed", e);
    return jsonError(500, "Sinkronisasi gagal. Coba lagi.");
  }
}
