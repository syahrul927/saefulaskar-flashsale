import type { orderStatus } from "./db/schema";

/**
 * The order-status vocabulary — one source of truth for every status-keyed
 * surface (admin tabs, customer pills, badge tones, stepper labels).
 *
 * `OrderStatus` is DERIVED from the `pgEnum` instead of being written out by
 * hand: the duplicate union that lived in `status-badge.tsx` is what let
 * `SHIPPED` and the customer label map drift away from the DB list without
 * any gate noticing. Deriving makes the enum the only place a status is
 * spelled, and turns a gap in a `Record<OrderStatus, …>` into a compile
 * error rather than a silently missing key.
 *
 * This module has NO runtime imports — only `import type`, which is erased
 * before the bundle is built. Client islands (`orders-list.tsx`, the
 * storefront orders page, `status-badge.tsx`) import these types, and a
 * runtime import of `schema.ts` would pull drizzle into the browser bundle.
 * The one runtime read of `orderStatus.enumValues` lives in
 * `tests/order-status.test.ts`, which may import the schema directly — that
 * is where the drift assertion belongs.
 */

/** Every status the `order_status` enum can hold. */
export type OrderStatus = (typeof orderStatus.enumValues)[number];

/**
 * States an order cannot leave. `SHIPPED` is deliberately absent: it is legacy
 * — nothing writes it any more (spec §4.7) — but a row parked on it can still
 * advance, so it is not an end state.
 */
const END_STATUSES: readonly OrderStatus[] = ["COMPLETED", "CANCEL"];

/** CANCEL is an end state too, hence this can't be a plain `!==` chain. */
function isEndState(status: string): boolean {
  return (END_STATUSES as readonly string[]).includes(status);
}

/**
 * States a cancel is legal from (spec §3.3): money we may not have taken yet.
 * Once the sales order exists and shipping has begun the cancel belongs to
 * Jubelio, not to us — hence `SHIPPED`/`COMPLETED`/`CANCEL` are all excluded.
 */
const CANCELLABLE_STATUSES: readonly OrderStatus[] = ["UNPAID", "CONFIRMED"];

/** Guards a cancel patch; the string parameter keeps callers off the enum type. */
function isCancellable(status: string): boolean {
  return (CANCELLABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Bahasa labels for customer surfaces — the copy the old local `STATUS_LABEL`
 * in `(storefront)/orders/page.tsx` carried, moved here so it is one map and
 * typed against the enum, so a new status must be labelled to compile. The
 * customer badge shows these uppercased (final review I-1: the pill above says
 * "BELUM BAYAR", so the card badge can't shout the raw enum beside it).
 *
 * COMPLETED reads "Diproses", not "Selesai", because it now covers both
 * processed-and-shipped (spec §4.7): nothing writes SHIPPED any more, so the
 * last state an order reaches must not claim only one of those two things. The
 * card spells it out under the pill; this label is the short form. `SHIPPED`
 * stays so legacy rows still get a word instead of the raw enum.
 *
 * Admin surfaces keep raw-enum labels — the documented admin precedent.
 */
const CUSTOMER_STATUS_LABEL: Record<OrderStatus, string> = {
  UNPAID: "Belum Bayar",
  CONFIRMED: "Dikonfirmasi",
  SHIPPED: "Dikirim",
  COMPLETED: "Diproses",
  CANCEL: "Dibatalkan",
};

/**
 * One step of the customer-facing status ladder, named by what happened rather
 * than by the raw enum: `from === null` is the row's creation, and a transition
 * into CANCEL reads the same whatever it came from. Feeds the stepper dialog
 * (Task 8) and the history rows written to `order_status_history`.
 */
function stepLabel(from: OrderStatus | null, to: OrderStatus): string {
  if (to === "CANCEL") return CUSTOMER_STATUS_LABEL.CANCEL;
  if (from === null) return "Pesanan dibuat";
  if (from === "UNPAID" && to === "CONFIRMED") {
    return "Dibayar — sales order dibuat";
  }
  if (to === "SHIPPED") return "Dikirim";
  if (to === "COMPLETED") return "Selesai";
  return CUSTOMER_STATUS_LABEL[to];
}

export {
  CANCELLABLE_STATUSES,
  CUSTOMER_STATUS_LABEL,
  END_STATUSES,
  isCancellable,
  isEndState,
  stepLabel,
};
export type { StatusHistorySource } from "./db/schema";
