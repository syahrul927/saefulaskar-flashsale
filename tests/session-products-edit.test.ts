import { describe, expect, it } from "vitest";

import {
  canEditProducts,
  quotaUpdateDecision,
  reAddDecision,
} from "@/server/session-products-edit";

// Pure edit-window rules for session products (spec §5.9 relaxation, Rulings
// 1 + 2). These are the testable seams the product API routes call — the route
// wiring itself is verified here + the gate, per repo precedent
// (`session-rules.test.ts`, `session-products-post.test.ts`).

/** A minimal stand-in for an existing `session_product` row. */
const EXISTING_ROW = { id: "row-1", itemId: 42, hidden: true };

describe("canEditProducts", () => {
  it("keeps SCHEDULED sessions editable", () => {
    expect(canEditProducts("SCHEDULED")).toBe(true);
  });

  it("unlocks product edits while the session is ACTIVE", () => {
    expect(canEditProducts("ACTIVE")).toBe(true);
  });

  it("unlocks product edits while the session is PAUSED", () => {
    expect(canEditProducts("PAUSED")).toBe(true);
  });

  it("freezes product edits once the session ENDED", () => {
    expect(canEditProducts("ENDED")).toBe(false);
  });

  it("freezes product edits for an unknown status", () => {
    expect(canEditProducts("DRAFT")).toBe(false);
    expect(canEditProducts("")).toBe(false);
    expect(canEditProducts("ended")).toBe(false);
  });
});

describe("reAddDecision", () => {
  it("only un-hides an existing row re-added during an ACTIVE session", () => {
    // Ruling 1: today's upsert resets flashPrice/minOrder/category and
    // re-derives quota — that reset must NOT run on a live session's row.
    expect(reAddDecision("ACTIVE", EXISTING_ROW)).toBe("unhide_only");
  });

  it("only un-hides an existing row re-added during a PAUSED session", () => {
    expect(reAddDecision("PAUSED", EXISTING_ROW)).toBe("unhide_only");
  });

  it("keeps today's reset semantics for an existing row in SCHEDULED", () => {
    expect(reAddDecision("SCHEDULED", EXISTING_ROW)).toBe("upsert");
  });

  it("inserts a brand-new row during an ACTIVE session", () => {
    expect(reAddDecision("ACTIVE", undefined)).toBe("insert");
  });

  it("inserts a brand-new row during a SCHEDULED session", () => {
    expect(reAddDecision("SCHEDULED", undefined)).toBe("insert");
  });
});

describe("quotaUpdateDecision", () => {
  it("rejects a quota below `claimed` and names `claimed` as the floor", () => {
    expect(
      quotaUpdateDecision({ claimed: 5, requestedQuota: 4, liveStock: 50 }),
    ).toEqual({ ok: false, floor: 5 });
  });

  it("rejects a quota of 0 when units are already sold", () => {
    expect(
      quotaUpdateDecision({ claimed: 3, requestedQuota: 0, liveStock: 0 }),
    ).toEqual({ ok: false, floor: 3 });
  });

  it("accepts a quota exactly equal to `claimed`", () => {
    expect(
      quotaUpdateDecision({ claimed: 5, requestedQuota: 5, liveStock: 9 }),
    ).toEqual({ ok: true, jubelioStock: 9, warnUnknownStock: false });
  });

  it("checks the floor before the stock branch (miss never masks a reject)", () => {
    expect(
      quotaUpdateDecision({
        claimed: 7,
        requestedQuota: 1,
        liveStock: undefined,
      }),
    ).toEqual({ ok: false, floor: 7 });
  });

  it("refreshes the stock snapshot from a live number", () => {
    // Ruling 2: checkout validates against `session_products.jubelio_stock`,
    // so a quota change also refreshes the snapshot to the live value.
    expect(
      quotaUpdateDecision({ claimed: 2, requestedQuota: 10, liveStock: 12 }),
    ).toEqual({ ok: true, jubelioStock: 12, warnUnknownStock: false });
  });

  it("treats a live stock of 0 as a real number, not unknown", () => {
    expect(
      quotaUpdateDecision({ claimed: 0, requestedQuota: 4, liveStock: 0 }),
    ).toEqual({ ok: true, jubelioStock: 0, warnUnknownStock: false });
  });

  it("warns and keeps the snapshot when the stock map misses (null)", () => {
    // `null` = "don't overwrite the snapshot"; unknown ≠ zero (Ruling 2).
    expect(
      quotaUpdateDecision({ claimed: 0, requestedQuota: 8, liveStock: null }),
    ).toEqual({ ok: true, jubelioStock: null, warnUnknownStock: true });
  });

  it("warns and keeps the snapshot when the stock map misses (undefined)", () => {
    // The route passes `undefined` when v2 fails outright or the item is
    // absent from the map.
    expect(
      quotaUpdateDecision({
        claimed: 1,
        requestedQuota: 6,
        liveStock: undefined,
      }),
    ).toEqual({ ok: true, jubelioStock: null, warnUnknownStock: true });
  });

  it("raises quota above a lower live stock without blocking", () => {
    // The admin may deliberately over-allocate against a stale ERP number;
    // the snapshot still follows the live value, and checkout stays the gate.
    expect(
      quotaUpdateDecision({ claimed: 0, requestedQuota: 20, liveStock: 3 }),
    ).toEqual({ ok: true, jubelioStock: 3, warnUnknownStock: false });
  });
});
