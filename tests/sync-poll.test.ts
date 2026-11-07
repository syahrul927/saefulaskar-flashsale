import { describe, expect, it } from "vitest";

import {
  POLL_INTERVAL_MS,
  formatLastSyncLabel,
  shouldPollTick,
} from "@/app/_components/sync-poll";

describe("POLL_INTERVAL_MS", () => {
  it("is the 10-second poll cadence in milliseconds", () => {
    expect(POLL_INTERVAL_MS).toBe(10_000);
  });
});

describe("shouldPollTick", () => {
  it("polls when the tab is visible and no fetch is in flight", () => {
    expect(shouldPollTick({ visible: true, inFlight: false })).toBe(true);
  });

  it("never polls from a hidden tab", () => {
    expect(shouldPollTick({ visible: false, inFlight: false })).toBe(false);
  });

  it("does not stack a second sweep while one is in flight", () => {
    // A sweep can take longer than one 10 s interval (one upstream read per
    // linked SO) — the interval keeps firing, but a second overlapping fetch
    // would double-read the upstream API for nothing.
    expect(shouldPollTick({ visible: true, inFlight: true })).toBe(false);
  });

  it("never polls from a hidden tab even with nothing in flight", () => {
    expect(shouldPollTick({ visible: false, inFlight: true })).toBe(false);
  });
});

describe("formatLastSyncLabel", () => {
  // Local components (no offset string), same rationale as
  // `formatStepTimestamp`: a `+07:00`-pinned instant would go red under
  // `TZ=UTC`. Hand-assembled `id-ID` clock — dots, not colons — because CLDR
  // renders `19.04` on this Node and `19:04` on some engines.
  it("formats HH.mm.ss with dots", () => {
    expect(formatLastSyncLabel(new Date(2026, 0, 1, 14, 32, 5))).toBe(
      "14.32.05",
    );
  });

  it("zero-pads each h23 unit", () => {
    expect(formatLastSyncLabel(new Date(2026, 0, 1, 3, 7, 0))).toBe("03.07.00");
  });
});
