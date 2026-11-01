import { describe, expect, it, vi } from "vitest";

import {
  createThrottledSync,
  runOrderSync,
  shouldRunSync,
  type SyncDeps,
} from "@/server/order-sync";
import type { LocalOrderSnapshot } from "@/server/daily-sync";

/**
 * Order-status sync: shared by the cron route and the throttled "admin opened
 * the dashboard" hook, so both go through one implementation and one set of
 * guarantees (forward-only, failure-isolated, no duplicate writes).
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
    expect(result).toEqual({ checked: 2, synced: 1, failed: 0 });
  });

  it("isolates a failed SO fetch: the rest of the run still lands", async () => {
    // A 404 (SO deleted upstream) or a 15 s timeout must not abort the sync —
    // that is how one bad row would silently freeze every order's status.
    const d = deps({
      fetchState: async (soId) => {
        if (soId === 209) throw new Error("Jubelio request failed: 404");
        return { ...PAID, internal_status: "SHIPPED", tracking_number: "TN-1" };
      },
    });
    const result = await runOrderSync(d);
    expect(result).toEqual({ checked: 2, synced: 1, failed: 1 });
    expect(d.applied).toEqual([{ orderId: "b", trackingNumber: "TN-1" }]);
  });

  it("skips an SO whose body has no internal_status", async () => {
    const d = deps({ fetchState: async () => ({ salesorder_id: 1 }) });
    const result = await runOrderSync(d);
    expect(result).toEqual({ checked: 2, synced: 0, failed: 0 });
    expect(d.applied).toEqual([]);
  });

  it("applies an isolated apply failure without losing the other patches", async () => {
    const d = deps({
      apply: async (patch) => {
        if ((patch as { orderId: string }).orderId === "a") throw new Error("db down");
      },
    });
    const result = await runOrderSync(d);
    expect(result).toEqual({ checked: 2, synced: 0, failed: 1 });
  });

  it("reports zero work when nothing is linked yet", async () => {
    const d = deps({ listLinkedOrders: async () => [] });
    expect(await runOrderSync(d)).toEqual({ checked: 0, synced: 0, failed: 0 });
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

  it("collapses concurrent callers into one run", async () => {
    let release: () => void = () => {};
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
    expect(await sync.maybe()).toEqual({ checked: 0, synced: 0, failed: 0 });
  });
});
