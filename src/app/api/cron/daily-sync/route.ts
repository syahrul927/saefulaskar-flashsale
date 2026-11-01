import { NextResponse } from "next/server";

import { env } from "@/env";
import { runOrderSyncNow } from "@/server/order-sync";

/**
 * Order-status sync endpoint (spec §4.6). Two accepted credentials, because two
 * different senders hit it:
 * - `x-cron-secret: <CRON_SECRET>` — external pingers (curl, cron-job.org,
 *   GitHub Actions), any method.
 * - `Authorization: Bearer <CRON_SECRET>` — how **Vercel's own cron sender**
 *   calls a `vercel.json` path: a GET with the bearer token, never a custom
 *   header. POST + header-only would have 405/401'd every nightly run while the
 *   dashboard showed the job as configured.
 *
 * Scheduled by Vercel via `vercel.json` (`0 0 * * *`, midnight UTC = 07:00
 * WIB). Vercel Hobby allows only that one daily cron, so an external pinger
 * (cron-job.org, a GitHub Actions schedule) can hit this same route hourly with
 * the same header for fresher statuses — the work is idempotent and
 * forward-only, so overlapping schedules are safe.
 *
 * The sweep reads each linked SO by id (`GET /sales/orders/{id}`): the list
 * endpoint cannot find our orders (184 072 rows, 200/page, no usable sort) and
 * its rows carry no `status` field — which is why the previous list-based
 * version reported `synced: 0` forever. See `src/server/daily-sync.ts`.
 *
 * The same pass also runs, throttled by `ORDER_SYNC_INTERVAL_MS`, when an admin
 * opens the orders page — see `src/app/admin/orders/page.tsx`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  // `env.CRON_SECRET` can never be the empty string: `emptyStringAsUndefined`
  // in src/env.js turns `CRON_SECRET=` into undefined and `z.string()` then
  // refuses to boot — so a missing header (null) can never match by accident.
  const secret = env.CRON_SECRET;
  if (request.headers.get("x-cron-secret") === secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function sync(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const result = await runOrderSyncNow();

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return sync(request);
}

export async function POST(request: Request) {
  return sync(request);
}
