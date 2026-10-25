import { describe, expect, it } from "vitest";

import { derivePills, pillIdFor } from "@/app/_components/category-pills";

describe("derivePills", () => {
  it("keeps Semua first, orders by first appearance and buckets nulls as Umum", () => {
    const products = [
      { category: "Minuman" },
      { category: null },
      { category: "Minuman" },
      { category: "Aksesoris" },
    ];

    expect(derivePills(products)).toEqual([
      { id: "All", label: "Semua" },
      { id: "Minuman", label: "Minuman" },
      { id: "Umum", label: "Umum" },
      { id: "Aksesoris", label: "Aksesoris" },
    ]);
  });

  it("always yields the Semua pill, even with no products", () => {
    expect(derivePills([])).toEqual([{ id: "All", label: "Semua" }]);
  });

  it("leaves no product unreachable — every category maps to a pill", () => {
    const products = [
      { category: "Minuman" },
      { category: "" },
      { category: "   " },
      { category: null },
      { category: "Aksesoris" },
      { category: "Minuman" },
    ];

    const pills = derivePills(products);
    const buckets = products.map((p) => pillIdFor(p.category));

    for (const bucket of buckets) {
      expect(pills.some((pill) => pill.id === bucket)).toBe(true);
    }

    // null, "" and whitespace-only all collapse into the ONE "Umum" pill.
    expect(pills.filter((pill) => pill.label === "Umum")).toHaveLength(1);
    expect(pills.map((pill) => pill.label)).toEqual([
      "Semua",
      "Minuman",
      "Umum",
      "Aksesoris",
    ]);
  });
});
