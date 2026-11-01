import { describe, expect, it } from "vitest";

import {
  filterOrders,
  statusCounts,
  type OrderFilterTab,
} from "@/app/_components/order-filters";

/** Minimal structural fixture — `filterOrders` may only read `status`.
 *  Row 4 is a legacy SHIPPED: the value still exists in the enum and in old
 *  rows, it is just no longer written and has no customer pill (spec §4.7).
 *  Row 6 is the new CANCEL, which does get a pill of its own (spec §3.1). */
const rows = [
  { id: "1", status: "UNPAID" },
  { id: "2", status: "CONFIRMED" },
  { id: "3", status: "UNPAID" },
  { id: "4", status: "SHIPPED" },
  { id: "5", status: "COMPLETED" },
  { id: "6", status: "CANCEL" },
];

describe("filterOrders", () => {
  it('"all" keeps every order (including a legacy SHIPPED) in original order', () => {
    expect(filterOrders(rows, "all")).toEqual(rows);
  });

  it("UNPAID returns only unpaid rows", () => {
    expect(filterOrders(rows, "UNPAID")).toEqual([rows[0], rows[2]]);
  });

  it("CONFIRMED returns only confirmed rows", () => {
    expect(filterOrders(rows, "CONFIRMED")).toEqual([rows[1]]);
  });

  it("COMPLETED returns only completed rows", () => {
    expect(filterOrders(rows, "COMPLETED")).toEqual([rows[4]]);
  });

  it("CANCEL returns only cancelled rows", () => {
    expect(filterOrders(rows, "CANCEL")).toEqual([rows[5]]);
  });

  it("yields an empty list when no order matches the tab", () => {
    expect(filterOrders([{ id: "x", status: "COMPLETED" }], "UNPAID")).toEqual(
      [],
    );
  });

  it("handles an empty input for every tab without throwing", () => {
    const tabs: OrderFilterTab[] = [
      "all",
      "UNPAID",
      "CONFIRMED",
      "COMPLETED",
      "CANCEL",
    ];
    for (const tab of tabs) {
      expect(filterOrders([], tab)).toEqual([]);
    }
  });
});

describe("statusCounts", () => {
  it("returns exactly the pinned shape { all, one key per pill }", () => {
    const counts = statusCounts(rows);
    expect(Object.keys(counts).sort()).toEqual([
      "CANCEL",
      "COMPLETED",
      "CONFIRMED",
      "UNPAID",
      "all",
    ]);
    // `all` counts every row — a legacy SHIPPED included — while the four
    // status keys stay true to their own status only.
    expect(counts).toEqual({
      all: 6,
      UNPAID: 2,
      CONFIRMED: 1,
      COMPLETED: 1,
      CANCEL: 1,
    });
  });

  it("zeroes out for an empty list", () => {
    expect(statusCounts([])).toEqual({
      all: 0,
      UNPAID: 0,
      CONFIRMED: 0,
      COMPLETED: 0,
      CANCEL: 0,
    });
  });
});

describe("resolveInitialTab (admin deep link)", () => {
  // Pinned from the SERVER-SAFE module, not the client island: the orders
  // page (a server component) calls this directly, so it must live where a
  // server can import it. Importing it from the "use client" file would
  // reproduce the runtime crash this fix removes.
  it("accepts exact status tabs", async () => {
    const { resolveInitialTab } = await import(
      "@/app/_components/admin-order-tabs"
    );
    expect(resolveInitialTab("UNPAID")).toBe("UNPAID");
    expect(resolveInitialTab("COMPLETED")).toBe("COMPLETED");
    expect(resolveInitialTab("CANCEL")).toBe("CANCEL");
  });

  it("falls back to ALL for garbage, empty, or missing values", async () => {
    const { resolveInitialTab } = await import(
      "@/app/_components/admin-order-tabs"
    );
    expect(resolveInitialTab("DROP TABLE")).toBe("ALL");
    expect(resolveInitialTab("")).toBe("ALL");
    expect(resolveInitialTab(undefined)).toBe("ALL");
  });
});
