import { describe, expect, it, vi } from "vitest";

import { JubelioError } from "@/lib/jubelio";
import type { LocalOrderSnapshot } from "@/server/daily-sync";
import {
  createThrottledSync,
  runOrderSync,
  shouldRunSync,
  type SyncDeps,
} from "@/server/order-sync";

/**
 * Order-status sync orchestration. There is one trigger now — the throttled pass
 * an admin opening `/admin/orders` starts (spec §4.7) — so every guarantee lives
 * in one implementation: forward-only, failure-isolated, no duplicate writes,
 * bounded concurrency, and "only a definitive 404 cancels".
 *
 * The deps below are fakes, which is why the SQL the REAL deps emit is pinned in
 * `tests/order-sync.filter.test.ts` instead.
 */
const SHIPPED = {
  salesorder_id: 209,
  internal_status: "SHIPPED",
  tracking_number: "001818714258",
  shipper: "SiCepat HALU",
};
const PAID = { salesorder_id: 192297, internal_status: "PAID", tracking_number: "", shipper: "" };

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps & {
  applied: unknown[];
  fetched: number[];
} {
  const applied: unknown[] = [];
  const fetched: number[] = [];
  const orders: LocalOrderSnapshot[] = overrides.listLinkedOrders
    ? []
    : [
        { id: "a", jubelioSoId: 209, status: "CONFIRMED" },
        { id: "b", jubelioSoId: 192297, status: "CONFIRMED" },
      ];
  return {
    applied,
    fetched,
    listLinkedOrders: async () => orders,
    fetchState: async (soId) => {
      fetched.push(soId);
      return soId === 209 ? SHIPPED : PAID;
    },
    apply: async (patch) => {
      applied.push(patch);
    },
    ...overrides,
  };
}

describe("shouldRunSync", () => {
  const base = { now: 1_000, lastRunAt: null, intervalMs: 300_000, inFlight: false };

  it("runs the first time (nothing has run yet)", () => {
    expect(shouldRunSync(base)).toBe(true);
  });

  it("waits out the interval", () => {
    const at = { ...base, now: 400_000 };
    expect(shouldRunSync({ ...at, lastRunAt: 399_999 })).toBe(false);
    expect(shouldRunSync({ ...at, lastRunAt: 100_001 })).toBe(false);
    expect(shouldRunSync({ ...at, lastRunAt: 100_000 })).toBe(true); // exactly one interval ago
  });

  it("never starts a second run while one is in flight", () => {
    expect(shouldRunSync({ ...base, inFlight: true })).toBe(false);
  });

  it("treats interval 0 as no throttle (env escape hatch)", () => {
    expect(shouldRunSync({ ...base, lastRunAt: 999, intervalMs: 0 })).toBe(true);
  });
});

describe("runOrderSync", () => {
  it("fetches each linked SO by id and applies the planned patches", async () => {
    const d = deps();
    const result = await runOrderSync(d);
    // Numeric sort: the default is lexicographic, which reorders these.
    expect(d.fetched.sort((a, b) => a - b)).toEqual([209, 192297]);
    // SO 209 is SHIPPED upstream; the local ladder has no SHIPPED step (spec
    // §4.7), so the row keeps CONFIRMED and only the resi is written.
    expect(d.applied).toEqual([
      {
        orderId: "a",
        trackingNumber: "001818714258",
        shipper: "SiCepat HALU",
      },
    ]);
    expect(result).toEqual({
      checked: 2,
      synced: 1,
      cancelled: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("isolates a failed SO read: the rest of the run still lands", async () => {
    // A timeout must not abort the sync — that is how one bad row would silently
    // freeze every order's status. Note the message SAYS 404 and the order is
    // still not cancelled: classification reads `JubelioError.status`, never
    // message text, so a wrapped or merely logged 404 cannot cancel anything.
    const d = deps({
      fetchState: async (soId) => {
        if (soId === 209) throw new Error("Jubelio request failed: 404");
        return { ...PAID, internal_status: "SHIPPED", tracking_number: "TN-1" };
      },
    });
    const result = await runOrderSync(d);
    expect(result).toEqual({
      checked: 2,
      synced: 1,
      cancelled: 0,
      skipped: 0,
      failed: 1,
    });
    expect(d.applied).toEqual([{ orderId: "b", trackingNumber: "TN-1" }]);
  });

  it("counts an unparseable 2xx as failed and leaves the order alone", async () => {
    // Changed from `failed: 0`: spec §4.4 counts every `unknown` verdict, and a
    // 2xx we could not read is one. We reached Jubelio and got no answer, which
    // is neither proof the SO is gone nor a clean pass.
    const d = deps({ fetchState: async () => ({ salesorder_id: 1 }) });
    const result = await runOrderSync(d);
    expect(result).toEqual({
      checked: 2,
      synced: 0,
      cancelled: 0,
      skipped: 0,
      failed: 2,
    });
    expect(d.applied).toEqual([]);
  });

  it("applies an isolated apply failure without losing the other patches", async () => {
    const d = deps({
      apply: async (patch) => {
        if ((patch as { orderId: string }).orderId === "a") throw new Error("db down");
      },
    });
    const result = await runOrderSync(d);
    expect(result).toEqual({
      checked: 2,
      synced: 0,
      cancelled: 0,
      skipped: 0,
      failed: 1,
    });
  });

  it("reports zero work when nothing is linked yet", async () => {
    const d = deps({ listLinkedOrders: async () => [] });
    expect(await runOrderSync(d)).toEqual({
      checked: 0,
      synced: 0,
      cancelled: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("bounds concurrency so a long backlog cannot stampede Jubelio", async () => {
    let inFlight = 0;
    let peak = 0;
    const orders: LocalOrderSnapshot[] = Array.from({ length: 12 }, (_, i) => ({
      id: `o${i}`,
      jubelioSoId: 209 + i,
      status: "CONFIRMED",
    }));
    const d = deps({
      listLinkedOrders: async () => orders,
      concurrency: 4,
      fetchState: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return SHIPPED;
      },
    });
    await runOrderSync(d);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("classifies a definitive 404 as missing and cancels exactly that order", async () => {
    const d = deps({
      fetchState: async (soId) => {
        if (soId === 209) {
          throw new JubelioError(404, "Not Found", "SalesOrder not found");
        }
        return SHIPPED;
      },
    });
    expect(await runOrderSync(d)).toEqual({
      checked: 2,
      synced: 1,
      cancelled: 1,
      skipped: 0,
      failed: 0,
    });
    // Order b's SO reads SHIPPED, so it takes the resi-only patch: one cancel
    // and one sync in the same pass, not two of either.
    expect(d.applied).toEqual([
      { orderId: "a", status: "CANCEL", cause: "SO #209 dihapus di Jubelio" },
      {
        orderId: "b",
        trackingNumber: "001818714258",
        shipper: "SiCepat HALU",
      },
    ]);
  });

  it("never cancels on a 403 — the sync reads with the system token, the SO was made with an admin's", async () => {
    // Review Focus 1. A token that lost scope answers 403 for every SO at once;
    // treating that as "gone" would cancel the whole book in one pass.
    const d = deps({
      fetchState: async () => {
        throw new JubelioError(403, "Forbidden", "Forbidden");
      },
    });
    expect(await runOrderSync(d)).toEqual({
      checked: 2,
      synced: 0,
      cancelled: 0,
      skipped: 0,
      failed: 2,
    });
    expect(d.applied).toEqual([]);
  });

  it("never cancels on a timeout or a 5xx", async () => {
    for (const e of [
      new Error("TimeoutError: The operation timed out"),
      new JubelioError(503, undefined, "Service Unavailable"),
    ]) {
      const d = deps({
        fetchState: async () => {
          throw e;
        },
      });
      const result = await runOrderSync(d);
      expect(result.cancelled).toBe(0);
      expect(d.applied).toEqual([]);
    }
  });

  it("does not count a cancel whose write failed", async () => {
    // Both SOs are gone, so two cancel patches are planned and both writes
    // throw. `cancelled` is what an operator reads as "orders we gave units
    // back for", so a refused write must land in `failed` and never inflate it.
    const d = deps({
      fetchState: async () => {
        throw new JubelioError(404, undefined, "gone");
      },
      apply: async () => {
        throw new Error("db down");
      },
    });
    expect(await runOrderSync(d)).toEqual({
      checked: 2,
      synced: 0,
      cancelled: 0,
      skipped: 0,
      failed: 2,
    });
  });

  it("counts a cancel the service refused as skipped, never as cancelled", async () => {
    // The race `cancelled` must not paper over: SO 209 is gone upstream, the
    // planner emits a cancel patch, but by the time `apply` runs an admin has
    // already cancelled the row and the service refuses it. No units were
    // released by THIS pass, so the number an operator reads as "orders we gave
    // units back for" stays 0 — and it is not a failure either, because a retry
    // would refuse again. Order b's resi-only patch still lands.
    const d = deps({
      fetchState: async (soId) => {
        if (soId === 209) throw new JubelioError(404, undefined, "gone");
        return SHIPPED;
      },
      apply: async (patch) =>
        patch.status === "CANCEL" ? { landed: false } : undefined,
    });
    expect(await runOrderSync(d)).toEqual({
      checked: 2,
      synced: 1,
      cancelled: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it("counts a dep that reports nothing as landed", async () => {
    // The other half of the `SyncApplyOutcome | void` contract: every fake in
    // this file returns `undefined`, and `skipped` must not swallow their work.
    const d = deps();
    expect(await runOrderSync(d)).toMatchObject({ synced: 1, skipped: 0 });
  });
});

describe("createThrottledSync", () => {
  it("runs once, then skips until the interval elapses", async () => {
    let now = 0;
    const d = deps();
    const listSpy = vi.spyOn(d, "listLinkedOrders");
    const sync = createThrottledSync(d, { intervalMs: 300_000, now: () => now });

    expect(await sync.maybe()).toMatchObject({ checked: 2 });
    expect(await sync.maybe()).toBeNull(); // 0 ms later
    now = 299_999;
    expect(await sync.maybe()).toBeNull();
    now = 300_000;
    expect(await sync.maybe()).not.toBeNull();
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it("logs one summary line per completed pass, none for a throttled one", async () => {
    // The admin page discards the result (spec §4.4) and the cron route that
    // used to return it as JSON is gone, so this line is the only place an
    // operator can see what a pass did — and the whole reason `cancelled` and
    // `skipped` are separate numbers is that a human reads them here.
    const info = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const sync = createThrottledSync(deps(), {
      intervalMs: 60_000,
      now: () => 0,
    });

    await sync.maybe();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "order-sync: checked 2, synced 1, cancelled 0, skipped 0, failed 0",
    );

    await sync.maybe(); // inside the interval: no pass ran, so nothing is logged
    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });

  it("collapses concurrent callers into one run", async () => {
    // Reassigned by the promise below; the initial no-op keeps `release`
    // definitely-assigned for the `release()` call at the end of the test.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const d = deps({
      fetchState: async () => {
        await gate;
        return SHIPPED;
      },
    });
    const sync = createThrottledSync(d, { intervalMs: 1, now: () => 0 });

    const first = sync.maybe(); // starts, then blocks on the gate
    const second = await sync.maybe();
    // Second caller is skipped, not queued — a page render must never wait on
    // another render's sync.
    expect(second).toBeNull();
    release();
    await expect(first).resolves.toMatchObject({ checked: 2 });
  });

  it("lets the next call run after a failure and does not cache the error", async () => {
    let now = 0;
    let calls = 0;
    const d = deps({
      listLinkedOrders: async () => {
        calls += 1;
        if (calls === 1) throw new Error("db down");
        return [];
      },
    });
    const sync = createThrottledSync(d, { intervalMs: 60_000, now: () => now });
    await expect(sync.maybe()).rejects.toThrow("db down");
    now = 60_000;
    expect(await sync.maybe()).toEqual({
      checked: 0,
      synced: 0,
      cancelled: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("force runs inside the interval and stamps the clock like a due pass", async () => {
    // The `Sinkron sekarang` contract: the button never waits for the
    // throttle, and a completed forced pass counts as a run — the next
    // page load must not sweep the same SOs twice for nothing.
    let now = 0;
    const d = deps();
    const sync = createThrottledSync(d, { intervalMs: 300_000, now: () => now });

    expect(await sync.maybe()).toMatchObject({ checked: 2 }); // first pass: due
    expect(await sync.maybe()).toBeNull(); // 0 ms later: throttled
    expect(await sync.force()).toMatchObject({ checked: 2 }); // the button does not wait
    expect(await sync.maybe()).toBeNull(); // force stamped lastRunAt
    now = 300_000;
    expect(await sync.maybe()).toMatchObject({ checked: 2 }); // due pass still runs after
  });

  it("force joins an in-flight pass instead of starting a second sweep", async () => {
    // Two admins clicking at once read each upstream SO ONCE: the second
    // force gets the SAME promise, not a queued second pass — and a page
    // load racing a forced pass still skips rather than doubling.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const d = deps({
      fetchState: async () => {
        await gate;
        return SHIPPED;
      },
    });
    const listSpy = vi.spyOn(d, "listLinkedOrders");
    const sync = createThrottledSync(d, { intervalMs: 1, now: () => 0 });

    const first = sync.force();
    expect(sync.force()).toBe(first); // the join is the promise itself
    expect(await sync.maybe()).toBeNull(); // a racing page load skips, as always
    release();
    await expect(first).resolves.toMatchObject({ checked: 2 });
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("a failed force leaves the clock unstamped and the lane free", async () => {
    // Mirrors the `maybe` failure test: the summary and `lastRunAt` are only
    // written when the pass COMPLETES, so a dead pass (system login, DB)
    // neither throttles the next attempt nor caches its error.
    let calls = 0;
    const d = deps({
      listLinkedOrders: async () => {
        calls += 1;
        if (calls === 1) throw new Error("jubelio down");
        return [];
      },
    });
    const sync = createThrottledSync(d, { intervalMs: 60_000, now: () => 0 });
    await expect(sync.force()).rejects.toThrow("jubelio down");
    expect(await sync.force()).toEqual({
      checked: 0,
      synced: 0,
      cancelled: 0,
      skipped: 0,
      failed: 0,
    });
  });
});
