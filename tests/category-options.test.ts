import { describe, expect, it } from "vitest";

import { categoryOptions } from "@/app/_components/category-options";

describe("categoryOptions", () => {
  it("appends a legacy category once after the fixed defaults, ignoring nulls", () => {
    expect(categoryOptions(["Minuman", "Aksesoris", null, "Minuman"])).toEqual([
      "Minuman",
      "Fashion",
      "Elektronik",
      "Rumah Tangga",
      "Aksesoris",
    ]);
  });

  it("keeps the default order when nothing extra exists", () => {
    expect(categoryOptions(["Elektronik", "Minuman"])).toEqual([
      "Minuman",
      "Fashion",
      "Elektronik",
      "Rumah Tangga",
    ]);
  });

  it("handles an empty roster (all nulls) with just the defaults", () => {
    expect(categoryOptions([null, null])).toEqual([
      "Minuman",
      "Fashion",
      "Elektronik",
      "Rumah Tangga",
    ]);
  });

  it("preserves first-seen order for multiple extras without duplicating", () => {
    expect(categoryOptions(["Aksesoris", "Minuman", "Sneakers", "Aksesoris"])).toEqual([
      "Minuman",
      "Fashion",
      "Elektronik",
      "Rumah Tangga",
      "Aksesoris",
      "Sneakers",
    ]);
  });
});
