import { describe, expect, it } from "vitest";

import type { StockEntry } from "@/lib/jubelio";
import type { StockMap } from "@/server/jubelio-catalog";
import { rosterProducts, type RosterDbRow } from "@/server/roster-products";

/**
 * Pure-join tests for the admin roster page: `sessionProducts` rows (the drizzle
 * shape the page selects) + the cached v2 `StockMap` → `SessionProduct[]`.
 * The page itself only wires `getStockMap`, so everything observable here is a
 * mapping rule.
 */

/** Full `sessionProducts` row with the live-shaped defaults of the schema. */
function dbRow(
  overrides: Partial<RosterDbRow> & { itemId: number },
): RosterDbRow {
  return {
    id: `row-${overrides.itemId}`,
    sessionId: "11111111-1111-1111-1111-111111111111",
    skuCode: `SKU-${overrides.itemId}`,
    itemGroupName: "Kuangyu Dream - SLA",
    jubelioStock: 3,
    originalPrice: 3700000,
    sessionQuota: 5,
    claimed: 1,
    minOrder: 1,
    flashPrice: 2500000,
    category: "Skincare",
    type: "single",
    ...overrides,
  };
}

/** Literal map (`Map` generics need the hint), same helper shape as catalog tests. */
function stockMap(entries: Array<[number, StockEntry]>): StockMap {
  return new Map(entries);
}

describe("rosterProducts", () => {
  it("joins availableStock + image from the v2 map by itemId", () => {
    const products = rosterProducts(
      [dbRow({ itemId: 2685, jubelioStock: 12 })],
      stockMap([
        [2685, { available: 42, image: "https://cdn.example.com/2685.jpg" }],
      ]),
    );

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      availableStock: 42,
      image: "https://cdn.example.com/2685.jpg",
    });
  });

  it("Review Focus 4 — null map → availableStock: null, image: null on every row", () => {
    const rows = [dbRow({ itemId: 2685 }), dbRow({ itemId: 999 })];
    const products = rosterProducts(rows, null);

    expect(products).toHaveLength(2); // a v2 outage never drops a roster row
    expect(products.map((p) => [p.availableStock, p.image])).toEqual([
      [null, null],
      [null, null],
    ]);
    // `null` is the unknown marker; the UI renders "—" / letter tile, never `0`.
    expect(products.some((p) => p.availableStock === 0)).toBe(false);
  });

  it("SKU absent from map → that row null/null, others keep their numbers", () => {
    const products = rosterProducts(
      [dbRow({ itemId: 2685 }), dbRow({ itemId: 999 })],
      stockMap([[2685, { available: 7, image: "u" }]]),
    );

    expect(products[0]).toMatchObject({ availableStock: 7, image: "u" });
    expect(products[1]).toMatchObject({ availableStock: null, image: null });
    // A real `0` from the ERP is a number, not a miss — `??` must keep it.
    const zero = rosterProducts(
      [dbRow({ itemId: 100 })],
      stockMap([[100, { available: 0, image: null }]]),
    );
    expect(zero[0]).toMatchObject({ availableStock: 0, image: null });
  });

  it("carries the DB fields through unchanged (id, quota, claimed, prices, category, type)", () => {
    const row = dbRow({
      itemId: 2685,
      id: "abc-123",
      skuCode: "SKU-2685",
      itemGroupName: "Kuangyu Dream - SLA",
      originalPrice: 3700000,
      sessionQuota: 15,
      claimed: 4,
      minOrder: 2,
      flashPrice: 2500000,
      category: null,
      type: "variable",
    });
    const [product] = rosterProducts(
      [row],
      stockMap([[2685, { available: 42, image: "u" }]]),
    );

    expect(product).toEqual({
      id: "abc-123",
      itemId: 2685,
      skuCode: "SKU-2685",
      itemGroupName: "Kuangyu Dream - SLA",
      originalPrice: 3700000,
      sessionQuota: 15,
      claimed: 4,
      minOrder: 2,
      flashPrice: 2500000,
      category: null,
      type: "variable",
      availableStock: 42,
      image: "u",
    });
  });

  it("never emits the stale jubelioStock column as availableStock when the map has a DIFFERENT number", () => {
    const products = rosterProducts(
      [dbRow({ itemId: 2685, jubelioStock: 3 })],
      stockMap([[2685, { available: 1, image: null }]]),
    );

    // Parity ≤60s is the feature: the live v2 number beats the snapshot.
    expect(products[0]?.availableStock).toBe(1);
    expect(products[0]?.availableStock).not.toBe(3);
  });
});
