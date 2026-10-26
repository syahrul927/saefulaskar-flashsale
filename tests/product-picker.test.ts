import { describe, expect, it } from "vitest";

import {
  canSaveRow,
  categoryText,
  filterCatalog,
  mergeProductsById,
  selectedItemIds,
  type SearchResult,
  type SessionProduct,
} from "@/app/_components/product-picker";

const valid = { quota: "50", minOrder: "2", flashPrice: "150000" };

function rosterRow(itemId: number, overrides: Partial<SessionProduct> = {}) {
  return {
    id: `row-${itemId}`,
    itemId,
    skuCode: `SKU-${itemId}`,
    itemGroupName: `Produk ${itemId}`,
    originalPrice: 100000,
    sessionQuota: 50,
    claimed: 0,
    minOrder: 1,
    flashPrice: 99000,
    category: null,
    type: "single" as SessionProduct["type"],
    availableStock: null,
    ...overrides,
  } satisfies SessionProduct;
}

describe("canSaveRow", () => {
  it("accepts a fully valid numeric draft", () => {
    expect(canSaveRow(valid)).toBe(true);
    // Flash price 0 is allowed (server schema: int().nonnegative()).
    expect(canSaveRow({ ...valid, flashPrice: "0" })).toBe(true);
  });

  it("blocks a cleared cell so Number(\"\") === 0 is never sent", () => {
    expect(canSaveRow({ ...valid, quota: "" })).toBe(false);
    expect(canSaveRow({ ...valid, minOrder: "" })).toBe(false);
    expect(canSaveRow({ ...valid, flashPrice: "" })).toBe(false);
    expect(canSaveRow({ ...valid, quota: "   " })).toBe(false);
  });

  it("blocks zero or negative quota/min-order drafts", () => {
    expect(canSaveRow({ ...valid, quota: "0" })).toBe(false);
    expect(canSaveRow({ ...valid, quota: "-3" })).toBe(false);
    expect(canSaveRow({ ...valid, minOrder: "0" })).toBe(false);
    expect(canSaveRow({ ...valid, flashPrice: "-100" })).toBe(false);
  });

  it("blocks non-integer or non-numeric junk before it reaches the API", () => {
    expect(canSaveRow({ ...valid, quota: "1.5" })).toBe(false);
    expect(canSaveRow({ ...valid, flashPrice: "abc" })).toBe(false);
    expect(canSaveRow({ ...valid, flashPrice: "Infinity" })).toBe(false);
  });
});

describe("categoryText", () => {
  it("shows null categories as Umum", () => {
    expect(categoryText(null)).toBe("Umum");
  });

  it("shows legacy empty-string imports (POST default) as Umum, not blank", () => {
    expect(categoryText("")).toBe("Umum");
    expect(categoryText("  ")).toBe("Umum");
  });

  it("passes real categories through", () => {
    expect(categoryText("Aksesoris")).toBe("Aksesoris");
  });
});

describe("selectedItemIds", () => {
  it("indexes the roster by itemId for the picker toggle lookup", () => {
    const ids = selectedItemIds([rosterRow(11), rosterRow(12)]);
    expect([...ids].sort()).toEqual([11, 12]);
    expect(ids.has(11)).toBe(true);
    expect(ids.has(13)).toBe(false);
  });

  it("counts every roster row once for the `N dipilih` footer", () => {
    expect(selectedItemIds([rosterRow(1), rosterRow(2), rosterRow(3)]).size).toBe(3);
    expect(selectedItemIds([]).size).toBe(0);
  });
});

describe("mergeProductsById", () => {
  it("appends freshly added items keyed by itemId", () => {
    const merged = mergeProductsById([rosterRow(1)], [rosterRow(2)]);
    expect(merged.map((p) => p.itemId)).toEqual([1, 2]);
  });

  it("replaces an existing row in place instead of duplicating it", () => {
    const stale = rosterRow(1, { sessionQuota: 10 });
    const fresh = rosterRow(1, { sessionQuota: 77 });
    const merged = mergeProductsById([rosterRow(9), stale], [fresh]);
    expect(merged.map((p) => p.itemId)).toEqual([9, 1]);
    expect(merged[1]?.sessionQuota).toBe(77);
  });

  it("merges a multi-item POST response in one pass", () => {
    const merged = mergeProductsById([], [rosterRow(5), rosterRow(6)]);
    expect(selectedItemIds(merged).size).toBe(2);
  });

  it("leaves the roster untouched for an empty incoming list", () => {
    const prev = [rosterRow(1)];
    expect(mergeProductsById(prev, [])).toEqual(prev);
  });
});

function catalogRow(
  itemId: number,
  itemGroupName: string,
  skuCode: string,
): SearchResult {
  return {
    itemId,
    skuCode,
    itemGroupName,
    price: 1000,
    minOrder: 1,
    stock: null,
  };
}

const CATALOG: SearchResult[] = [
  catalogRow(1, "Kuangyu Dream - SLA", "[SLA]UA000044N"),
  catalogRow(2, "Sepeda Listrik X1", "SKU-SPD-X1"),
  catalogRow(3, "Helm Standar", "SKU-HELM-01"),
];

describe("filterCatalog", () => {
  it("matches item names case-insensitively", () => {
    expect(filterCatalog(CATALOG, "sepeda").map((r) => r.itemId)).toEqual([2]);
  });

  it("matches SKU substrings, including bracketed codes", () => {
    expect(filterCatalog(CATALOG, "sla").map((r) => r.itemId)).toEqual([1]);
    expect(filterCatalog(CATALOG, "helm-01").map((r) => r.itemId)).toEqual([3]);
  });

  it("returns the whole catalog for empty or whitespace queries", () => {
    expect(filterCatalog(CATALOG, "")).toHaveLength(3);
    expect(filterCatalog(CATALOG, "   ")).toHaveLength(3);
  });

  it("caps results at the limit (default 100)", () => {
    const big = Array.from({ length: 150 }, (_, i) =>
      catalogRow(i, `Produk ${i}`, `SKU-${i}`),
    );
    expect(filterCatalog(big, "produk")).toHaveLength(100);
    expect(filterCatalog(big, "produk", 5)).toHaveLength(5);
  });

  it("never matches on price or stock digits", () => {
    expect(filterCatalog(CATALOG, "1000")).toEqual([]);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(filterCatalog(CATALOG, "  helm  ").map((r) => r.itemId)).toEqual([3]);
  });
});
