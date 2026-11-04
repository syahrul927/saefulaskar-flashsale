import { describe, expect, it } from "vitest";

import {
  canSaveRow,
  categoryText,
  dirtyPatches,
  filterCatalog,
  mergeProductsById,
  selectedItemIds,
  shouldLoadCatalog,
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
    hidden: false,
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

/**
 * What POST/PUT actually answer: the raw drizzle row — roster fields yes, v2
 * join no. `image` and `availableStock` keys are ABSENT (only GET joins them
 * from the v2 map), so a merge that replaces a row wholesale loses both.
 */
function postedRow(
  itemId: number,
  overrides: Partial<SessionProduct> = {},
): SessionProduct {
  const bare: Partial<SessionProduct> = rosterRow(itemId, overrides);
  delete bare.availableStock;
  delete bare.image;
  return bare as SessionProduct;
}

describe("mergeProductsById keeps the roster's live v2 fields", () => {
  it("a freshly added row keeps the thumbnail the admin just saw", () => {
    const picked = catalogRow(7, "Sepeda Listrik X1", "SKU-SPD-X1", {
      image: "https://cdn.jubelio.example/7.jpg",
      stock: 12,
    });
    const merged = mergeProductsById([], [postedRow(7)], [picked]);
    expect(merged[0]?.image).toBe("https://cdn.jubelio.example/7.jpg");
    expect(merged[0]?.availableStock).toBe(12);
  });

  it("a saved row keeps its thumbnail and stock across the PUT replace", () => {
    const prev = [
      rosterRow(3, {
        image: "https://cdn.jubelio.example/3.jpg",
        availableStock: -14,
      }),
    ];
    const merged = mergeProductsById(prev, [
      postedRow(3, { sessionQuota: 4 }),
    ]);
    expect(merged.map((p) => p.itemId)).toEqual([3]);
    expect(merged[0]?.sessionQuota).toBe(4);
    expect(merged[0]?.image).toBe("https://cdn.jubelio.example/3.jpg");
    // Raw negatives survive untouched (parity with the dashboard).
    expect(merged[0]?.availableStock).toBe(-14);
  });

  it("a picked row with no v2 data still merges with both fallbacks", () => {
    // Letter tile + "—", never a stale value: the answer is null, not absent.
    const picked = catalogRow(8, "Helm Standar", "SKU-HELM-08");
    const merged = mergeProductsById([], [postedRow(8)], [picked]);
    expect(merged[0]?.image).toBeNull();
    expect(merged[0]?.availableStock).toBeNull();
  });

  it("two-arg merges behave exactly as before for full SessionProduct rows", () => {
    const stale = rosterRow(1, { sessionQuota: 10, availableStock: 5 });
    const fresh = rosterRow(1, {
      sessionQuota: 77,
      image: "https://cdn.jubelio.example/new.jpg",
    });
    const merged = mergeProductsById([stale], [fresh]);
    expect(merged[0]?.sessionQuota).toBe(77);
    expect(merged[0]?.availableStock).toBe(5);
    expect(merged[0]?.image).toBe("https://cdn.jubelio.example/new.jpg");
  });
});

function catalogRow(
  itemId: number,
  itemGroupName: string,
  skuCode: string,
  overrides: Partial<SearchResult> = {},
): SearchResult {
  return {
    itemId,
    skuCode,
    itemGroupName,
    price: 1000,
    minOrder: 1,
    stock: null,
    image: null,
    ...overrides,
  };
}

const CATALOG: SearchResult[] = [
  catalogRow(1, "Kuangyu Dream - SLA", "[SLA]UA000044N"),
  catalogRow(2, "Sepeda Listrik X1", "SKU-SPD-X1"),
  catalogRow(3, "Helm Standar", "SKU-HELM-01"),
];

describe("shouldLoadCatalog", () => {
  const fresh = { open: true, loaded: false, inFlight: false, errored: false };

  it("fetches once: dialog open, nothing loaded, nothing in flight", () => {
    expect(shouldLoadCatalog(fresh)).toBe(true);
  });

  it("never fetches while the dialog is closed", () => {
    expect(shouldLoadCatalog({ ...fresh, open: false })).toBe(false);
  });

  it("never refetches once the catalog has arrived", () => {
    expect(shouldLoadCatalog({ ...fresh, loaded: true })).toBe(false);
  });

  it("never overlaps an in-flight request", () => {
    expect(shouldLoadCatalog({ ...fresh, inFlight: true })).toBe(false);
  });

  it("does NOT auto-retry after a failed load (final review C-1 loop pin)", () => {
    // The failure path flips `inFlight` false while `catalog` stays null —
    // without the `errored` guard that state change re-runs the effect and
    // every cycle is one fresh upstream hit (toast storm + ERP hammering).
    // Retry is deliberate: close/reopen resets `errored`.
    expect(shouldLoadCatalog({ ...fresh, errored: true })).toBe(false);
  });

  it("retries after close+reopen: errored cleared, guard opens again", () => {
    expect(shouldLoadCatalog({ ...fresh, errored: false })).toBe(true);
  });
});

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

  it("ignores the new v2 fields — stock numbers and image URLs never match", () => {
    // Task 4 puts `image` on every row and makes `stock` real; matching is
    // still name/SKU-only, so a raw ERP figure like -14 or a CDN fragment
    // must not surface rows.
    const withV2 = [
      catalogRow(1, "Sepeda Listrik X1", "SKU-SPD-X1", {
        stock: -14,
        image: "https://cdn.jubelio.example/img/sku-spd-x1.jpg",
      }),
      catalogRow(2, "Helm Standar", "SKU-HELM-01", { stock: 1775 }),
    ];
    expect(filterCatalog(withV2, "-14")).toEqual([]);
    expect(filterCatalog(withV2, "1775")).toEqual([]);
    expect(filterCatalog(withV2, "jubelio.example")).toEqual([]);
    expect(filterCatalog(withV2, "x1").map((r) => r.itemId)).toEqual([1]);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(filterCatalog(CATALOG, "  helm  ").map((r) => r.itemId)).toEqual([3]);
  });
});

describe("dirtyPatches", () => {
  /** Draft-map shorthand: the picker's `Map<number, draft>` shape. */
  const drafts = (
    entries: Array<[number, { quota: string; minOrder: string; flashPrice: string }]>,
  ) => new Map(entries);

  it("returns [] for a row with no draft and for a row whose draft equals the saved values", () => {
    const products = [rosterRow(1)]; // saved: quota 50, min 1, flash 99000
    expect(dirtyPatches(products, drafts([]))).toEqual([]);
    expect(
      dirtyPatches(products, drafts([[1, { quota: "50", minOrder: "1", flashPrice: "99000" }]])),
    ).toEqual([]);
  });

  it("emits exactly one patch with only `sessionQuota` when quota alone changed", () => {
    const products = [rosterRow(1), rosterRow(2)];
    const patches = dirtyPatches(
      products,
      drafts([
        [1, { quota: "75", minOrder: "1", flashPrice: "99000" }],
        [2, { quota: "40", minOrder: "3", flashPrice: "80000" }],
      ]),
    );
    const first = patches.find((p) => p.itemId === 1);
    expect(patches).toHaveLength(2);
    expect(first?.patch).toEqual({ sessionQuota: 75 });
    expect(patches[1]?.patch).toEqual({
      sessionQuota: 40,
      minOrder: 3,
      flashPrice: 80000,
    });
  });

  it("ignores an empty cell — it yields no patch key, never a 0", () => {
    const products = [rosterRow(1)];
    // Empty quota among otherwise-saved values → the row is not dirty at all.
    expect(
      dirtyPatches(products, drafts([[1, { quota: "", minOrder: "1", flashPrice: "99000" }]])),
    ).toEqual([]);
    // Empty quota alongside a real change → patch without `sessionQuota`.
    expect(
      dirtyPatches(products, drafts([[1, { quota: "", minOrder: "2", flashPrice: "99000" }]])),
    ).toEqual([{ itemId: 1, patch: { minOrder: 2 } }]);
  });

  it("treats string \"50\" as number 50 — an equal draft is not dirty", () => {
    const products = [rosterRow(1, { sessionQuota: 50, minOrder: 50, flashPrice: 50 })];
    expect(
      dirtyPatches(products, drafts([[1, { quota: "50", minOrder: "50", flashPrice: "50" }]])),
    ).toEqual([]);
  });

  it("skips unparsable drafts silently and leaves untouched rows absent", () => {
    const products = [rosterRow(1), rosterRow(2), rosterRow(3)];
    const patches = dirtyPatches(
      products,
      drafts([
        // Every numeric field unparsable or equal → the row never appears.
        [1, { quota: "1.5", minOrder: "abc", flashPrice: "99000" }],
        [2, { quota: "999", minOrder: "1", flashPrice: "99000" }],
        // row 3 has no draft entry at all
      ]),
    );
    expect(patches).toEqual([{ itemId: 2, patch: { sessionQuota: 999 } }]);
  });
});
