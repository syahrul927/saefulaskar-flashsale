import { describe, expect, it } from "vitest";

import { formatGmvDelta, wibDayBounds } from "@/server/console-kpi";

describe("wibDayBounds", () => {
  it("anchors a mid-day WIB instant to local-midnight bounds (UTC+7)", () => {
    // 2026-10-26T09:30Z is 16:30 WIB on Oct 26 → day runs
    // Oct 25 17:00Z .. Oct 26 17:00Z.
    const { start, end } = wibDayBounds(new Date("2026-10-26T09:30:00Z"));
    expect(start.toISOString()).toBe("2026-10-25T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-26T17:00:00.000Z");
  });

  it("keeps 16:59:59Z inside the previous WIB day", () => {
    // 23:59:59 WIB on Oct 26 — one second before the seam.
    const { start, end } = wibDayBounds(new Date("2026-10-26T16:59:59Z"));
    expect(start.toISOString()).toBe("2026-10-25T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-26T17:00:00.000Z");
  });

  it("rolls to the new WIB day exactly at the 17:00Z seam", () => {
    // 00:00:00 WIB on Oct 27 — the seam instant belongs to the new day.
    const { start, end } = wibDayBounds(new Date("2026-10-26T17:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-26T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-27T17:00:00.000Z");
  });
});

describe("formatGmvDelta", () => {
  it("shows a signed percent gain vs yesterday", () => {
    expect(formatGmvDelta(1_120_000, 1_000_000)).toBe("+12% vs kemarin");
  });

  it("shows a signed percent drop vs yesterday", () => {
    expect(formatGmvDelta(920_000, 1_000_000)).toBe("-8% vs kemarin");
  });

  it("reports fresh sales with no yesterday baseline", () => {
    expect(formatGmvDelta(500_000, 0)).toBe("baru vs kemarin");
  });

  it("stays neutral when both days are empty", () => {
    expect(formatGmvDelta(0, 0)).toBe("— vs kemarin");
  });
});
