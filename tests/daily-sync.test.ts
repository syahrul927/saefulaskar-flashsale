import { describe, expect, it } from "vitest";

import { mapJubelioStatus, planSync } from "@/server/daily-sync";

describe("mapJubelioStatus", () => {
  it("maps Jubelio status labels to local order states (spec §4.6)", () => {
    expect(mapJubelioStatus("Ready to Ship")).toBe("CONFIRMED");
    expect(mapJubelioStatus("Shipped")).toBe("SHIPPED");
    expect(mapJubelioStatus("Completed")).toBe("COMPLETED");
  });

  it("returns null for unknown status labels", () => {
    expect(mapJubelioStatus("On Hold")).toBeNull();
    expect(mapJubelioStatus("Cancelled")).toBeNull();
  });
});

describe("planSync", () => {
  it("updates orders whose SO status advanced and skips unlisted ids", () => {
    const patches = planSync(
      [
        { id: "a", jubelioSoId: 101, status: "UNPAID" },
        { id: "b", jubelioSoId: 102, status: "CONFIRMED" },
        { id: "c", jubelioSoId: 103, status: "CONFIRMED" },
      ],
      [
        { salesorder_id: 101, status: "Shipped" },
        { salesorder_id: 102, status: "Completed" },
      ],
    );

    expect(patches).toEqual([
      { orderId: "a", status: "SHIPPED" },
      { orderId: "b", status: "COMPLETED" },
    ]);
    // order "c" has an SO id not present in the list → untouched.
  });

  it("skips orders already at the mapped status", () => {
    const patches = planSync(
      [{ id: "a", jubelioSoId: 101, status: "SHIPPED" }],
      [{ salesorder_id: 101, status: "Shipped" }],
    );
    expect(patches).toEqual([]);
  });

  it("ignores orders with no jubelioSoId", () => {
    const patches = planSync(
      [{ id: "a", jubelioSoId: null, status: "UNPAID" }],
      [{ salesorder_id: 101, status: "Shipped" }],
    );
    expect(patches).toEqual([]);
  });

  it("tolerates a wrapped Jubelio payload shape", () => {
    const patches = planSync(
      [{ id: "a", jubelioSoId: 101, status: "CONFIRMED" }],
      // Some Jubelio deployments nest the rows under `data`.
      { data: [{ salesorder_id: 101, status: "Shipped" }] },
    );
    expect(patches).toEqual([{ orderId: "a", status: "SHIPPED" }]);
  });
});