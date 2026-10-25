import { describe, expect, it } from "vitest";

import {
  findOrderProof,
  type OrderProofRow,
} from "@/app/_components/payment-panel";

describe("findOrderProof", () => {
  const rows: OrderProofRow[] = [
    { id: "order-1", bookingId: "FS-2026-10-26-001", transferProofUrl: "/uploads/a.jpg" },
    { id: "order-2", bookingId: "FS-2026-10-26-002", transferProofUrl: null },
    { id: "order-3", bookingId: "FS-2026-10-26-003", transferProofUrl: "" },
  ];

  it("matches the booking row and flags a non-empty proof url", () => {
    expect(findOrderProof(rows, "FS-2026-10-26-001")).toEqual({
      orderId: "order-1",
      uploaded: true,
    });
  });

  it("treats null and empty-string proof urls as not uploaded", () => {
    expect(findOrderProof(rows, "FS-2026-10-26-002")).toEqual({
      orderId: "order-2",
      uploaded: false,
    });
    expect(findOrderProof(rows, "FS-2026-10-26-003")).toEqual({
      orderId: "order-3",
      uploaded: false,
    });
  });

  it("returns null for unknown booking ids and malformed rows", () => {
    expect(findOrderProof(rows, "FS-9999-0000-0000")).toBeNull();
    expect(findOrderProof([{ bookingId: "B", id: 42 }], "B")).toBeNull();
  });
});
