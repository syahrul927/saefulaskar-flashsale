import { describe, expect, it } from "vitest";

import { toPickerRows } from "@/lib/jubelio";

/**
 * Masters item copied from the live probe 2026-10-26 (spec "Verified field
 * mapping"): `variants` is a JSON-ENCODED STRING whose entries carry
 * `item_id`/`item_code`; there is no top-level `item_id`/`sku_code`/`stock`.
 */
function mastersItem(
  overrides: Partial<{
    item_name: unknown;
    sell_price: unknown;
    variants: unknown;
  }> = {},
) {
  return {
    item_group_id: 1868,
    item_name: "Kuangyu Dream - SLA",
    sell_price: "3700000.0000",
    variants: JSON.stringify([
      { item_id: 2685, item_code: "[SLA]UA000044N", is_bundle: true, sell_price: 3700000 },
    ]),
    ...overrides,
  };
}

describe("toPickerRows", () => {
  it("maps the {data:[…]} envelope through variants[0] to picker rows", () => {
    expect(toPickerRows({ data: [mastersItem()] })).toEqual([
      {
        itemId: 2685,
        skuCode: "[SLA]UA000044N",
        itemGroupName: "Kuangyu Dream - SLA",
        price: 3700000,
        minOrder: 1,
        stock: null,
      },
    ]);
  });

  it("tolerates a bare array payload (no envelope)", () => {
    expect(toPickerRows([mastersItem()])).toHaveLength(1);
  });

  it("coerces the string sell_price to a number, falling back to the variant price", () => {
    const noTopPrice = mastersItem({ sell_price: undefined });
    expect(toPickerRows({ data: [noTopPrice] })[0]?.price).toBe(3700000);
    const junkPrice = mastersItem({ sell_price: "abc" });
    expect(toPickerRows({ data: [junkPrice] })[0]?.price).toBe(3700000);
  });

  it("accepts variants already parsed to an array", () => {
    const item = mastersItem({
      variants: [{ item_id: 7, item_code: "X-7", sell_price: 1000 }],
    });
    expect(toPickerRows({ data: [item] })[0]).toMatchObject({
      itemId: 7,
      skuCode: "X-7",
    });
  });

  it("yields the fallback row for empty, absent or garbage variants — never throws", () => {
    const fallback = {
      itemId: 0,
      skuCode: "",
      itemGroupName: "Kuangyu Dream - SLA",
      price: 3700000,
      minOrder: 1,
      stock: null,
    };
    expect(toPickerRows({ data: [mastersItem({ variants: "[]" })] })[0]).toEqual(
      fallback,
    );
    expect(toPickerRows({ data: [mastersItem({ variants: undefined })] })[0]).toEqual(
      fallback,
    );
    expect(toPickerRows({ data: [mastersItem({ variants: "{not json" })] })[0]).toEqual(
      fallback,
    );
  });

  it("keeps minOrder at 1 (masters carries no min) and stock null for every row", () => {
    const rows = toPickerRows({ data: [mastersItem(), mastersItem()] });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.minOrder).toBe(1);
      expect(row.stock).toBeNull();
    }
  });

  it("returns [] for null, junk envelope, or non-array data", () => {
    expect(toPickerRows(null)).toEqual([]);
    expect(toPickerRows({})).toEqual([]);
    expect(toPickerRows({ data: "nope" })).toEqual([]);
  });
});
