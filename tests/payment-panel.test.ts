import { describe, expect, it } from "vitest";

import {
  findOrderProof,
  reduceMissStreak,
  sameProofPhase,
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

describe("reduceMissStreak", () => {
  it("extends the streak only on permanent misses, capped at maxMisses", () => {
    expect(reduceMissStreak(0, "miss")).toEqual({ misses: 1, giveUp: false });
    expect(reduceMissStreak(1, "miss")).toEqual({ misses: 2, giveUp: false });
    expect(reduceMissStreak(2, "miss")).toEqual({ misses: 3, giveUp: true });
  });

  it("resets on a found row and stays neutral on transient failures", () => {
    expect(reduceMissStreak(2, "found")).toEqual({ misses: 0, giveUp: false });
    expect(reduceMissStreak(2, "transient")).toEqual({
      misses: 2,
      giveUp: false,
    });
  });

  it("a transient blip between permanent misses does not hand the cap back", () => {
    let { misses } = reduceMissStreak(0, "miss");
    ({ misses } = reduceMissStreak(misses, "transient"));
    const final = reduceMissStreak(misses, "miss");
    expect(final).toEqual({ misses: 2, giveUp: false });
  });
});

describe("sameProofPhase", () => {
  it("treats identical ready states as equal and any delta as changed", () => {
    const ready = { phase: "ready", orderId: "o-1", uploaded: false } as const;
    expect(sameProofPhase(ready, { ...ready })).toBe(true);
    expect(sameProofPhase(ready, { ...ready, uploaded: true })).toBe(false);
    expect(sameProofPhase(ready, { ...ready, orderId: "o-2" })).toBe(false);
    expect(sameProofPhase(ready, { phase: "unavailable" })).toBe(false);
  });

  it("equality for the two payload-free phases", () => {
    expect(sameProofPhase({ phase: "checking" }, { phase: "checking" })).toBe(
      true,
    );
    expect(
      sameProofPhase({ phase: "checking" }, { phase: "unavailable" }),
    ).toBe(false);
  });
});
