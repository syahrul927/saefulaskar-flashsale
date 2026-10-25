import { describe, expect, it } from "vitest";

import {
  formatClaimPercent,
  formatCompactRupiah,
  formatRupiah,
} from "@/app/admin/format";

// Intl's id-ID currency format separates "Rp" from the amount with a
// no-break space, so expectations spell it explicitly instead of typing it.
const NB = String.fromCharCode(0xa0);

describe("formatRupiah", () => {
  it("formats full rupiah with id-ID separators", () => {
    expect(formatRupiah(0)).toBe(`Rp${NB}0`);
    expect(formatRupiah(1_234_567)).toBe(`Rp${NB}1.234.567`);
  });
});

describe("formatCompactRupiah", () => {
  it("abbreviates juta, miliar and ribu with one decimal", () => {
    expect(formatCompactRupiah(1_200_000)).toBe("Rp 1,2 jt");
    expect(formatCompactRupiah(12_500_000)).toBe("Rp 12,5 jt");
    expect(formatCompactRupiah(1_500_000_000)).toBe("Rp 1,5 M");
    expect(formatCompactRupiah(850_000)).toBe("Rp 850 rb");
  });

  it("rounds the scaled value instead of truncating it", () => {
    expect(formatCompactRupiah(1_999_999)).toBe("Rp 2 jt");
    // The scale is picked before rounding, so just under a juta keeps the
    // `rb` suffix and rounds up to four digits. Deliberate, not a bug.
    expect(formatCompactRupiah(999_999)).toBe("Rp 1.000 rb");
  });

  it("keeps sub-thousand amounts exact", () => {
    expect(formatCompactRupiah(1_000)).toBe("Rp 1 rb");
    expect(formatCompactRupiah(999)).toBe(formatRupiah(999));
    expect(formatCompactRupiah(0)).toBe(formatRupiah(0));
  });
});

describe("formatClaimPercent", () => {
  it("rounds the share to whole percent", () => {
    expect(formatClaimPercent(12, 100)).toBe("12%");
    expect(formatClaimPercent(1, 3)).toBe("33%");
    expect(formatClaimPercent(2, 3)).toBe("67%");
    expect(formatClaimPercent(100, 100)).toBe("100%");
    expect(formatClaimPercent(140, 100)).toBe("140%");
    // 62.5 exactly — pins Math.round's half-up choice.
    expect(formatClaimPercent(5, 8)).toBe("63%");
  });

  it("has no share to report when quota is zero", () => {
    expect(formatClaimPercent(0, 0)).toBe("—");
  });
});
