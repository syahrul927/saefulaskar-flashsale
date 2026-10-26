import { describe, expect, it } from "vitest";

import {
  filterOrders,
  statusCounts,
  type OrderFilterTab,
} from "@/app/_components/order-filters";

/** Minimal structural fixture — `filterOrders` may only read `status`. */
const rows = [
  { id: "1", status: "UNPAID" },
  { id: "2", status: "CONFIRMED" },
  { id: "3", status: "UNPAID" },
  { id: "4", status: "SHIPPED" },
  { id: "5", status: "COMPLETED" },
];

describe("filterOrders", () => {
  it('"all" keeps every order (including COMPLETED) in original order', () => {
    expect(filterOrders(rows, "all")).toEqual(rows);
  });

  it("UNPAID returns only unpaid rows", () => {
    expect(filterOrders(rows, "UNPAID")).toEqual([rows[0], rows[2]]);
  });

  it("CONFIRMED returns only confirmed rows", () => {
    expect(filterOrders(rows, "CONFIRMED")).toEqual([rows[1]]);
  });

  it("SHIPPED returns only shipped rows", () => {
    expect(filterOrders(rows, "SHIPPED")).toEqual([rows[3]]);
  });

  it("yields an empty list when no order matches the tab", () => {
    expect(filterOrders([{ id: "x", status: "COMPLETED" }], "UNPAID")).toEqual(
      [],
    );
  });

  it("handles an empty input for every tab without throwing", () => {
    const tabs: OrderFilterTab[] = ["all", "UNPAID", "CONFIRMED", "SHIPPED"];
    for (const tab of tabs) {
      expect(filterOrders([], tab)).toEqual([]);
    }
  });
});

describe("statusCounts", () => {
  it("returns exactly the pinned shape { all, UNPAID, CONFIRMED, SHIPPED }", () => {
    const counts = statusCounts(rows);
    expect(Object.keys(counts).sort()).toEqual([
      "CONFIRMED",
      "SHIPPED",
      "UNPAID",
      "all",
    ]);
    // `all` counts every row — COMPLETED included — while the three status
    // keys stay true to their own status only.
    expect(counts).toEqual({
      all: 5,
      UNPAID: 2,
      CONFIRMED: 1,
      SHIPPED: 1,
    });
  });

  it("zeroes out for an empty list", () => {
    expect(statusCounts([])).toEqual({
      all: 0,
      UNPAID: 0,
      CONFIRMED: 0,
      SHIPPED: 0,
    });
  });
});

describe("resolveInitialTab (admin deep link)", () => {
  it("accepts exact status tabs", async () => {
    const { resolveInitialTab } = await import(
      "@/app/_components/admin-orders-filter"
    );
    expect(resolveInitialTab("UNPAID")).toBe("UNPAID");
    expect(resolveInitialTab("COMPLETED")).toBe("COMPLETED");
  });

  it("falls back to ALL for garbage, empty, or missing values", async () => {
    const { resolveInitialTab } = await import(
      "@/app/_components/admin-orders-filter"
    );
    expect(resolveInitialTab("DROP TABLE")).toBe("ALL");
    expect(resolveInitialTab("")).toBe("ALL");
    expect(resolveInitialTab(undefined)).toBe("ALL");
  });
});
