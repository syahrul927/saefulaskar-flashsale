import { describe, expect, it } from "vitest";

import { formatStepTimestamp } from "@/lib/format";

describe("formatStepTimestamp", () => {
  // Local components, not an offset string: `STEP_TIME` carries no `timeZone`,
  // so the formatter renders in the RUNNER's zone and an assertion pinned to a
  // `+07:00` instant goes red under `TZ=UTC` (verified) with a correct
  // implementation. These dates pin the shape — dd MMM yyyy, HH.mm with a dot
  // between hour and minute — wherever the suite runs, exactly like
  // `tests/status-steps.test.ts`. Local `id-ID` `format()` renders `19.04` on
  // this Node but `19:04` on some engines — the same CLDR disagreement
  // `formatRupiah` guards against, which is why the implementation assembles
  // `formatToParts` by hand.
  it("formats a step timestamp as dd MMM yyyy, HH.mm in id-ID", () => {
    const d = new Date(2026, 9, 28, 19, 4);
    expect(formatStepTimestamp(d)).toBe("28 Okt 2026, 19.04");
  });

  it("zero-pads single-digit day, hour and minute", () => {
    expect(formatStepTimestamp(new Date(2026, 0, 5, 9, 7))).toBe(
      "05 Jan 2026, 09.07",
    );
  });
});
