import { describe, expect, it } from "vitest";

import {
  findOrderProof,
  reduceMissStreak,
  sameProofPhase,
  seedInitialProof,
  type OrderProofRow,
} from "@/app/_components/payment-panel";

describe("findOrderProof", () => {
  const rows: OrderProofRow[] = [
    { id: "order-1", bookingId: "FS-2026-10-26-001", hasProof: true },
    { id: "order-2", bookingId: "FS-2026-10-26-002", hasProof: false },
    { id: "order-3", bookingId: "FS-2026-10-26-003" },
  ];

  it("matches the booking row and flags hasProof === true as uploaded", () => {
    expect(findOrderProof(rows, "FS-2026-10-26-001")).toEqual({
      orderId: "order-1",
      uploaded: true,
    });
  });

  it("treats a false or missing hasProof as not uploaded", () => {
    expect(findOrderProof(rows, "FS-2026-10-26-002")).toEqual({
      orderId: "order-2",
      uploaded: false,
    });
    expect(findOrderProof(rows, "FS-2026-10-26-003")).toEqual({
      orderId: "order-3",
      uploaded: false,
    });
  });

  it("never counts a truthy non-boolean hasProof as uploaded", () => {
    expect(
      findOrderProof(
        [{ id: "order-4", bookingId: "B", hasProof: "yes" }],
        "B",
      ),
    ).toEqual({ orderId: "order-4", uploaded: false });
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

describe("seedInitialProof", () => {
  it("seeds a ready phase from the initial props so the list poll never starts", () => {
    expect(seedInitialProof("order-9", true)).toEqual({
      phase: "ready",
      orderId: "order-9",
      uploaded: true,
    });
  });

  it("treats a missing initialUploaded as not uploaded", () => {
    expect(seedInitialProof("order-9", undefined)).toEqual({
      phase: "ready",
      orderId: "order-9",
      uploaded: false,
    });
  });

  it("returns null without a usable initialOrderId — the bounded poll stays the fallback", () => {
    expect(seedInitialProof(undefined, undefined)).toBeNull();
    expect(seedInitialProof("", true)).toBeNull();
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
