import { describe, expect, it } from "vitest";

import { canSaveRow, categoryText } from "@/app/_components/product-picker";

const valid = { quota: "50", minOrder: "2", flashPrice: "150000" };

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
