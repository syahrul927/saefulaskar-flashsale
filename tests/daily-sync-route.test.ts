import { beforeEach, describe, expect, it, vi } from "vitest";

// The route is a thin shell over `runOrderSyncNow`; what it owns is the secret
// guard and the reported counts. Mocking the sync module keeps this off the DB
// and off Jubelio.
vi.mock("@/server/order-sync", () => ({
  runOrderSyncNow: vi.fn(async () => ({ checked: 3, synced: 1, failed: 0 })),
}));

import { GET, POST } from "@/app/api/cron/daily-sync/route";
import { env } from "@/env";
import { runOrderSyncNow } from "@/server/order-sync";

function request(secret?: string) {
  return POST(makeRequest("POST", secret));
}

function makeRequest(
  method: "GET" | "POST",
  secret?: string,
  scheme: "header" | "bearer" = "header",
) {
  const headers: Record<string, string> = {};
  if (secret !== undefined) {
    headers[scheme === "bearer" ? "authorization" : "x-cron-secret"] =
      scheme === "bearer" ? `Bearer ${secret}` : secret;
  }
  return new Request("http://test/api/cron/daily-sync", { method, headers });
}

beforeEach(() => {
  vi.mocked(runOrderSyncNow).mockClear();
});

describe("daily-sync cron route", () => {
  it("401s without the secret and does not touch Jubelio", async () => {
    const res = await request();
    expect(res.status).toBe(401);
    expect(runOrderSyncNow).not.toHaveBeenCalled();
  });

  it("401s on a wrong secret", async () => {
    expect((await request("not-the-secret")).status).toBe(401);
    expect(runOrderSyncNow).not.toHaveBeenCalled();
  });

  it("runs the sweep and reports checked/synced/failed", async () => {
    const res = await request(env.CRON_SECRET);
    expect(res.status).toBe(200);
    expect(runOrderSyncNow).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({
      ok: true,
      checked: 3,
      synced: 1,
      failed: 0,
    });
  });
});

/**
 * Vercel's own cron sender does not read `vercel.json` secrets into custom
 * headers: it issues a **GET** to the path with
 * `Authorization: Bearer ${CRON_SECRET}` (docs "Managing Cron Jobs"). A
 * POST + `x-cron-secret`-only route therefore 405/401s every nightly run — the
 * schedule looks configured and never actually sweeps. Both schemes must work
 * on both methods; external pingers keep sending the custom header.
 */
describe("daily-sync cron route: Vercel bearer scheme", () => {
  it("accepts GET with the bearer token (how Vercel invokes it)", async () => {
    const res = await GET(makeRequest("GET", env.CRON_SECRET, "bearer"));
    expect(res.status).toBe(200);
    expect(runOrderSyncNow).toHaveBeenCalledTimes(1);
    expect((await res.json()).ok).toBe(true);
  });

  it("accepts POST with the bearer token too", async () => {
    const res = await POST(makeRequest("POST", env.CRON_SECRET, "bearer"));
    expect(res.status).toBe(200);
  });

  it("401s on a wrong bearer token and does not touch Jubelio", async () => {
    const res = await GET(makeRequest("GET", "not-the-secret", "bearer"));
    expect(res.status).toBe(401);
    expect(runOrderSyncNow).not.toHaveBeenCalled();
  });

  it("401s on a bearer token with no scheme prefix", async () => {
    const res = await GET(
      new Request("http://test/api/cron/daily-sync", {
        method: "GET",
        headers: { authorization: env.CRON_SECRET },
      }),
    );
    expect(res.status).toBe(401);
    expect(runOrderSyncNow).not.toHaveBeenCalled();
  });

  it("still accepts the custom header on GET (external pingers)", async () => {
    const res = await GET(makeRequest("GET", env.CRON_SECRET, "header"));
    expect(res.status).toBe(200);
  });
});
