import { describe, expect, it } from "vitest";

import {
  capForProduct,
  nextQtyAfterAdd,
  nextQtyAfterIncrement,
} from "@/app/_components/cart-rules";

// Pure cart caps mirroring the server checkout guard (src/server/checkout.ts
// `evaluateCheckout`): availableStock >= qty AND claimed + qty <= sessionQuota.
// The cart enforces the same ceiling AT ADD TIME so a shopper can't stack 50
// of a 3-left product and only learn at checkout. The server re-check stays
// the authority — these caps use the page-load snapshot of `claimed`.

describe("capForProduct", () => {
  it("quota remaining is the cap when ERP stock is unknown or generous", () => {
    expect(capForProduct({ sessionQuota: 20, claimed: 7, availableStock: null })).toBe(13);
    expect(capForProduct({ sessionQuota: 20, claimed: 7, availableStock: 5000 })).toBe(13);
  });

  it("ERP stock lowers the cap below the quota remaining", () => {
    expect(capForProduct({ sessionQuota: 20, claimed: 0, availableStock: 4 })).toBe(4);
  });

  it("negative stock floors the cap at 0 (never a negative ceiling)", () => {
    expect(capForProduct({ sessionQuota: 20, claimed: 0, availableStock: -14 })).toBe(0);
  });
});

describe("nextQtyAfterAdd", () => {
  it("fits under the cap → exact sum, not clamped", () => {
    expect(nextQtyAfterAdd({ currentQty: 0, addQty: 3, minOrder: 1, cap: 10 })).toEqual({
      kind: "ok",
      qty: 3,
      clamped: false,
    });
    expect(nextQtyAfterAdd({ currentQty: 3, addQty: 3, minOrder: 1, cap: 10 })).toEqual({
      kind: "ok",
      qty: 6,
      clamped: false,
    });
  });

  it("crosses the cap → clamp to the cap, flagged", () => {
    expect(nextQtyAfterAdd({ currentQty: 9, addQty: 3, minOrder: 1, cap: 10 })).toEqual({
      kind: "ok",
      qty: 10,
      clamped: true,
    });
  });

  it("cart already at/over the cap → at-max, no change (stale snapshot may sit over)", () => {
    expect(nextQtyAfterAdd({ currentQty: 10, addQty: 2, minOrder: 1, cap: 10 })).toEqual({
      kind: "at-max",
      qty: 10,
    });
  });

  it("cap below minOrder → unbuyable (the server would reject any legal qty)", () => {
    expect(nextQtyAfterAdd({ currentQty: 0, addQty: 5, minOrder: 5, cap: 2 })).toEqual({
      kind: "unbuyable",
    });
  });

  it("empty cart with cap 0 → unbuyable", () => {
    expect(nextQtyAfterAdd({ currentQty: 0, addQty: 1, minOrder: 1, cap: 0 })).toEqual({
      kind: "unbuyable",
    });
  });
});

describe("nextQtyAfterIncrement", () => {
  it("under the cap → +1", () => {
    expect(nextQtyAfterIncrement({ currentQty: 4, cap: 10 })).toEqual({
      kind: "ok",
      qty: 5,
    });
  });

  it("at the cap → blocked at-max, quantity unchanged", () => {
    expect(nextQtyAfterIncrement({ currentQty: 10, cap: 10 })).toEqual({
      kind: "at-max",
      qty: 10,
    });
  });

  it("over the cap (stale snapshot) → never +1", () => {
    expect(nextQtyAfterIncrement({ currentQty: 12, cap: 10 })).toEqual({
      kind: "at-max",
      qty: 12,
    });
  });
});
