import { describe, expect, it } from "vitest";

import { formatRemainingParts } from "@/app/_components/countdown-timer";

describe("formatRemainingParts", () => {
  it("splits zero into all-zero parts", () => {
    expect(formatRemainingParts(0)).toEqual({ h: 0, m: 0, s: 0 });
  });

  it("clamps negative durations to zero", () => {
    expect(formatRemainingParts(-5000)).toEqual({ h: 0, m: 0, s: 0 });
  });

  it("formats 9_638_000 ms as 02:40:38", () => {
    expect(formatRemainingParts(9_638_000)).toEqual({ h: 2, m: 40, s: 38 });
  });

  it("floors sub-second remainders", () => {
    expect(formatRemainingParts(59_999)).toEqual({ h: 0, m: 0, s: 59 });
  });
});
