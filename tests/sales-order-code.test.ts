import { describe, expect, it } from "vitest";

import { formatSalesOrderCode } from "@/lib/format";

describe("formatSalesOrderCode", () => {
  it("pads to the 9-digit shape Jubelio's console prints", () => {
    // The admin compares this string against upstream character for character
    // (PRD §6 row 16), so the padding IS the feature: `192297` on its own
    // would not match `SO-000192297` in the console.
    expect(formatSalesOrderCode(192297)).toBe("SO-000192297"); // the dead SO of 2026-10-28
    expect(formatSalesOrderCode(192626)).toBe("SO-000192626");
    expect(formatSalesOrderCode(27)).toBe("SO-000000027");
    expect(formatSalesOrderCode(0)).toBe("SO-000000000");
  });

  it("stops padding past nine digits rather than truncating", () => {
    // `padStart` is a floor, not a mask: a 10-digit id keeps every digit, so
    // the display never silently drops information the admin needs upstream.
    expect(formatSalesOrderCode(1234567890)).toBe("SO-1234567890");
  });
});
