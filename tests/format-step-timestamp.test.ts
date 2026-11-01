import { describe, expect, it } from "vitest";

import { formatStepTimestamp } from "@/lib/format";

describe("formatStepTimestamp", () => {
  // Fixed UTC offset rather than the runner's zone: the assertion below spells
  // the instant, so it pins the shape (dd MMM yyyy, HH.mm with a dot between
  // hour and minute) independently of where the suite happens to run. Local
  // `id-ID` `format()` renders `19.04` on this Node but `19:04` on some
  // engines — the same CLDR disagreement `formatRupiah` guards against, which
  // is why the implementation assembles `formatToParts` by hand.
  it("formats a step timestamp as dd MMM yyyy, HH.mm in id-ID", () => {
    const d = new Date("2026-10-28T19:04:00+07:00");
    expect(formatStepTimestamp(d)).toBe("28 Okt 2026, 19.04");
  });

  it("zero-pads single-digit day, hour and minute", () => {
    expect(formatStepTimestamp(new Date("2026-01-05T09:07:00+07:00"))).toBe(
      "05 Jan 2026, 09.07",
    );
  });
});
