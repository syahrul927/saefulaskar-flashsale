import { beforeEach, describe, expect, it, vi } from "vitest";

// The route's own two decisions are what this file pins: the OWNER door check,
// and handing the pass's counters back verbatim for the toast. Auth and the
// sync module are mocked — the throttle/join semantics are `createThrottledSync`
// tests' job (tests/order-sync.test.ts), and re-running them over HTTP would
// prove the mock, not the code. Same seam idiom as `tests/cancel-route.test.ts`.
vi.mock("@/server/better-auth/server", () => ({ getSession: vi.fn() }));
vi.mock("@/server/order-sync", () => ({ forceRunOrderSync: vi.fn() }));

import { POST } from "@/app/api/admin/sync/route";
import { forceRunOrderSync } from "@/server/order-sync";
import { getSession } from "@/server/better-auth/server";

const ADMIN = {
  user: {
    id: "owner-1",
    role: "OWNER",
    email: "admin@example.com",
    token: "tok",
  },
};
const CUSTOMER = {
  user: {
    id: "cust-1",
    role: "CUSTOMER",
    email: "customer@example.com",
    token: "tok",
  },
};
const RESULT = { checked: 3, synced: 1, cancelled: 1, skipped: 0, failed: 1 };

beforeEach(() => {
  vi.mocked(getSession).mockReset();
  vi.mocked(forceRunOrderSync).mockReset();
});

function post() {
  // The handler takes no request args — the door check and the forced pass
  // are the whole body — so the call is bare.
  return POST();
}

describe("POST /api/admin/sync", () => {
  it("401s with no session and never reaches the sweep", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(401);
    expect(forceRunOrderSync).not.toHaveBeenCalled();
  });

  it("403s a non-OWNER and never reaches the sweep", async () => {
    // The sweep spends one upstream API read per linked SO; a customer
    // clicking this is a metered-DDoS vector, so the door is the whole point.
    vi.mocked(getSession).mockResolvedValue(CUSTOMER as never);
    const res = await post();
    expect(res.status).toBe(403);
    expect(forceRunOrderSync).not.toHaveBeenCalled();
  });

  it("runs the forced pass and returns its counters verbatim", async () => {
    vi.mocked(getSession).mockResolvedValue(ADMIN as never);
    vi.mocked(forceRunOrderSync).mockResolvedValue(RESULT);
    const res = await post();
    expect(res.status).toBe(200);
    // `verbatim` matters: the toast is only honest if zeros survive the trip
    // (`synced: 0` means "checked, nothing changed", not "nothing was checked").
    await expect(res.json()).resolves.toEqual({ ok: true, result: RESULT });
    expect(forceRunOrderSync).toHaveBeenCalledTimes(1);
  });

  it("maps a pass that threw to the Bahasa 500 the toast reads", async () => {
    // Per-order Jubelio failures are isolated inside `runOrderSync` and come
    // back as `failed`; a throw here means the WHOLE pass died (system login,
    // DB) — exactly when the button must say "Coba lagi." rather than hang up
    // a non-JSON error page the `data?.error` read finds nothing in.
    vi.mocked(getSession).mockResolvedValue(ADMIN as never);
    vi.mocked(forceRunOrderSync).mockRejectedValue(new Error("jubelio down"));
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const res = await post();
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual({
        ok: false,
        error: "Sinkronisasi gagal. Coba lagi.",
      });
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
