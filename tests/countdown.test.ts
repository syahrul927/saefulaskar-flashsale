import { describe, expect, it } from "vitest";

import { formatRemainingParts } from "@/app/_components/countdown-timer";

describe("formatRemainingParts", () => {
  it("splits zero into all-zero parts", () => {
    expect(formatRemainingParts(0)).toEqual({ d: 0, h: 0, m: 0, s: 0 });
  });

  it("clamps negative durations to zero", () => {
    expect(formatRemainingParts(-5000)).toEqual({ d: 0, h: 0, m: 0, s: 0 });
  });

  it("formats 9_638_000 ms as 0d 02:40:38", () => {
    expect(formatRemainingParts(9_638_000)).toEqual({ d: 0, h: 2, m: 40, s: 38 });
  });

  it("floors sub-second remainders", () => {
    expect(formatRemainingParts(59_999)).toEqual({ d: 0, h: 0, m: 0, s: 59 });
  });

  it("rolls over past 24 h into a day counter — 90_061 s is 1d 01:01:01", () => {
    expect(formatRemainingParts(90_061_000)).toEqual({ d: 1, h: 1, m: 1, s: 1 });
  });

  it("days are unbounded, hours stay 0-23", () => {
    // 10 days minus a second.
    expect(formatRemainingParts((10 * 86_400 - 1) * 1000)).toEqual({
      d: 9,
      h: 23,
      m: 59,
      s: 59,
    });
  });
});
