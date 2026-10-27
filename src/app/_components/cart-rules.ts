/**
 * Pure cart-cap rules — the client-side mirror of the server checkout guard
 * (`src/server/checkout.ts` `evaluateCheckout`: `availableStock >= qty` AND
 * `claimed + qty <= sessionQuota`, spec §4.4). Without these, the cart would
 * let a shopper stack 50 of a 3-left product and only hear "STOCK_INSUFFICIENT"
 * at checkout. The cart enforces the ceiling at add/increment time using the
 * page-load snapshot of the product; the server re-check remains the
 * authority, so a stale cap can only ever be too generous, never a false
 * block. Server-safe module (no React, no DOM) — same convention as
 * `admin-order-tabs.ts`.
 */

/** Fields from `StorefrontProduct` the cap needs. */
export type CapInput = {
  sessionQuota: number;
  claimed: number;
  /** ERP snapshot; `null` = unknown → quota remaining alone. */
  availableStock: number | null;
};

/**
 * Highest quantity a customer may hold for one product right now:
 * `min(quota − claimed, stock)`, floored at 0 (negative ERP snapshots exist;
 * a ceiling can never be negative).
 */
export function capForProduct(p: CapInput): number {
  const remaining = p.sessionQuota - p.claimed;
  const cap = p.availableStock === null ? remaining : Math.min(remaining, p.availableStock);
  return Math.max(0, cap);
}

type AddInput = {
  /** Qty already in the cart for this product. */
  currentQty: number;
  /** Qty the shopper is asking to add (quick-add = minOrder). */
  addQty: number;
  minOrder: number;
  cap: number;
};

export type AddDecision =
  | { kind: "ok"; qty: number; clamped: boolean }
  | { kind: "at-max"; qty: number }
  | { kind: "unbuyable" };

/**
 * New cart qty after an add. `unbuyable` when no legal order fits the cap
 * (cap below minOrder — the server would reject any allowed quantity);
 * `at-max` when the cart already sits at/over the cap (change nothing);
 * otherwise the sum clamped to the cap, `clamped` flagged so the UI can say
 * "dibatasi sisa stok".
 */
export function nextQtyAfterAdd(input: AddInput): AddDecision {
  if (input.cap < input.minOrder) return { kind: "unbuyable" };
  if (input.currentQty >= input.cap) {
    return { kind: "at-max", qty: input.currentQty };
  }
  const wanted = input.currentQty + input.addQty;
  return {
    kind: "ok",
    qty: Math.min(wanted, input.cap),
    clamped: wanted > input.cap,
  };
}

export type IncrementDecision =
  | { kind: "ok"; qty: number }
  | { kind: "at-max"; qty: number };

/** Drawer `+`: one more, but never above the cap. */
export function nextQtyAfterIncrement(input: {
  currentQty: number;
  cap: number;
}): IncrementDecision {
  if (input.currentQty >= input.cap) {
    return { kind: "at-max", qty: input.currentQty };
  }
  return { kind: "ok", qty: input.currentQty + 1 };
}
