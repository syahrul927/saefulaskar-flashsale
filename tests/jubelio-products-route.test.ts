import { describe, expect, it } from "vitest";

import { toPickerRows } from "@/lib/jubelio";

describe("toPickerRows", () => {
  it("reshapes raw master items to camelCase and surfaces stock", () => {
    const [row] = toPickerRows([
      {
        item_id: 42,
        sku_code: "BRG-42",
        item_group_name: "Kopi Gayo 250g",
        price: 85000,
        min: 2,
        stock: 137,
      },
    ]);
    expect(row).toEqual({
      itemId: 42,
      skuCode: "BRG-42",
      itemGroupName: "Kopi Gayo 250g",
      price: 85000,
      minOrder: 2,
      stock: 137,
    });
  });

  it("yields stock null when the master API omits it (or sends junk)", () => {
    const rows = toPickerRows([
      { item_id: 1, sku_code: "A", item_group_name: "A", price: 100, min: 1 },
      { item_id: 2, stock: "lots" },
    ]);
    expect(rows[0]?.stock).toBeNull();
    expect(rows[1]?.stock).toBeNull();
  });

  it("keeps genuine zero stock as 0, not null", () => {
    expect(toPickerRows([{ item_id: 3, stock: 0 }])[0]?.stock).toBe(0);
  });

  it("applies per-field fallbacks and tolerates a non-array payload", () => {
    expect(toPickerRows({})).toEqual([]);
    expect(toPickerRows(null)).toEqual([]);
    const [row] = toPickerRows([{}]);
    expect(row).toEqual({
      itemId: 0,
      skuCode: "",
      itemGroupName: "",
      price: 0,
      minOrder: 1,
      stock: null,
    });
  });
});
