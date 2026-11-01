import { describe, expect, it, vi } from "vitest";

import { resolveUnits, type ProductUnitLookup } from "@/server/confirm-units";

/** Minimal `getProductResponse` fragment the resolver reads. */
function product(
  itemCode: string,
  uomName: string | undefined,
): { item_id: number; item_code: string; uom_name?: string } {
  return {
    item_id: 1,
    item_code: itemCode,
    ...(uomName === undefined ? {} : { uom_name: uomName }),
  };
}

describe("resolveUnits", () => {
  it("resolves each unique SKU once and maps uom_name onto its items", async () => {
    const fetchUom = vi.fn(async (sku: string) =>
      product(sku, sku === "SKU-1" ? "Buah" : "Botol"),
    );
    const units = await resolveUnits(
      [
        { sku: "SKU-1" },
        { sku: "SKU-1" },
        { sku: "SKU-2" },
      ],
      fetchUom,
    );
    expect(units).toEqual(["Buah", "Buah", "Botol"]);
    expect(fetchUom).toHaveBeenCalledTimes(2);
  });

  it("falls back to 'Buah' when the lookup throws", async () => {
    const failing = async (_sku: string): Promise<never> => {
      throw new Error("upstream down");
    };
    expect(await resolveUnits([{ sku: "A" }], failing)).toEqual(["Buah"]);
  });

  it("falls back to 'Buah' when uom_name is absent", async () => {
    const empty = async () => product("X", undefined);
    expect(await resolveUnits([{ sku: "A" }], empty)).toEqual(["Buah"]);
  });
});
