// The only place that writes `CANCEL` (spec §4.3, §4.5). Two doors, one
// transaction: the admin cancel route (Task 9, `source: "admin"`) and the
// order-status sync (Task 10, `source: "sync"`, on a definitive Jubelio 404)
// both call `cancelOrder`, so the flip, the quota release and the audit row
// either all happen or none do — and the rules below are enforced once instead
// of being re-invented per caller.

import { and, eq, notInArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "./db/schema";
import { orderItems, orders, sessionProducts } from "./db/schema";
import { type OrderStatus, END_STATUSES, isEndState } from "./order-status";
import { recordStatusChange } from "./status-history";

/** Who cancelled — mirrors `STATUS_HISTORY_SOURCES` minus `checkout`. */
export type CancelSource = "admin" | "sync";

/** One session product and the units its cancel gives back to it. */
export type QuotaReleaseLine = { sessionProductId: string; qty: number };

/**
 * Sum the order's lines per session product, dropping lines that would release
 * nothing. The summing is the point: an order can carry two lines for the same
 * product, and `cancelOrder` emits one UPDATE per line of THIS plan — so
 * "quota released exactly once per product" is a property of the plan, not of
 * the loop that walks it. Zero/negative lines are dropped: a zero one would
 * cost a no-op UPDATE, and a negative one would make the release SQL ADD to
 * `claimed` (subtracting a minus) while shrinking the figure the dialog
 * reports.
 */
export function planQuotaRelease(
  items: readonly { sessionProductId: string; qty: number }[],
): QuotaReleaseLine[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    const prev = totals.get(item.sessionProductId) ?? 0;
    totals.set(item.sessionProductId, prev + item.qty);
  }
  const lines: QuotaReleaseLine[] = [];
  for (const [sessionProductId, qty] of totals) {
    if (qty > 0) lines.push({ sessionProductId, qty });
  }
  return lines;
}

/**
 * The note that lands in `order_status_history`: the cause (if any) and the
 * quota fact, joined by an em dash. Spelled here and nowhere else, because
 * both doors produce it — the admin passes no cause, the sync passes
 * "SO #192626 dihapus di Jubelio" — and a customer reading the dialog must see
 * the same sentence either way. A cause with nothing to release still returns
 * the cause: the reason is the evidence, the quota line is the consequence.
 */
export function composeCancelNote(
  cause: string | null,
  releasedUnits: number,
): string | null {
  const facts: string[] = [];
  if (cause) facts.push(cause);
  if (releasedUnits > 0)
    facts.push(`${releasedUnits} unit kembali ke kuota sesi`);
  return facts.length > 0 ? facts.join(" — ") : null;
}

export type CancelOrderInput = {
  orderId: string;
  source: CancelSource;
  actorUserId?: string | null;
  note?: string | null; // human-readable cause, e.g. "SO #192626 dihapus di Jubelio"
};

export type CancelOrderResult =
  | { cancelled: true; fromStatus: OrderStatus; releasedUnits: number }
  | { cancelled: false; reason: "not-found" | "already-ended" };

/**
 * One DB surface, same shape as `nextBookingId`'s (`src/server/booking-id.ts`):
 * a real `db` and a route handler's transaction both satisfy it, and Task 5
 * proved a `tx` flows into `recordStatusChange` without a cast.
 */
export type CancelDb = Pick<PostgresJsDatabase<typeof schema>, "transaction">;

export async function cancelOrder(
  db: CancelDb,
  input: CancelOrderInput,
): Promise<CancelOrderResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      // Lock-stable, per the final review's third write site: the guarded
      // UPDATE below still decides the OUTCOME (cancel wins either way, quota
      // releases exactly once), but without the lock an interleaved admin
      // confirm leaves this read stale, and the history row would record
      // `UNPAID → CANCEL` when the true predecessor was CONFIRMED. "Was a
      // refund owed" is exactly the fact the ledger exists to preserve
      // (spec §4.5; PRD §4.7). Same primitive as the sync pre-read and the
      // confirm route.
      .for("update");
    if (!order) return { cancelled: false, reason: "not-found" } as const;
    // Cheap early-out; the guarded UPDATE below is the real race guard.
    if (isEndState(order.status)) {
      return { cancelled: false, reason: "already-ended" } as const;
    }

    const items = await tx
      .select({
        sessionProductId: orderItems.sessionProductId,
        qty: orderItems.qty,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, input.orderId));
    const lines = planQuotaRelease(items);
    const releasedUnits = lines.reduce((sum, l) => sum + l.qty, 0);

    // Exactly one caller can flip this row: two overlapping cancels both read
    // UNPAID above, only one finds a row that is still not in an end state.
    // Do not rely on the button's isLoading for this (spec §4.3).
    const flipped = await tx
      .update(orders)
      .set({ status: "CANCEL" })
      .where(
        and(
          eq(orders.id, input.orderId),
          notInArray(orders.status, [...END_STATUSES]),
        ),
      )
      .returning({ id: orders.id });
    if (flipped.length !== 1) {
      return { cancelled: false, reason: "already-ended" } as const;
    }

    // GREATEST clamps at 0: a legacy line can exceed the quota an admin has
    // since truncated, and a negative `claimed` silently breaks the storefront
    // cap (src/server/checkout.ts:121). Deliberately unconditional on session
    // status — checkout's first gate is `sessionStatus !== "ACTIVE"`, so a
    // release into an ENDED session is inert, not a reopening (spec §4.3).
    for (const line of lines) {
      await tx
        .update(sessionProducts)
        .set({
          claimed: sql`GREATEST(${sessionProducts.claimed} - ${line.qty}, 0)`,
        })
        .where(eq(sessionProducts.id, line.sessionProductId));
    }

    // jubelio_so_id, tracking_number and shipper are untouched on purpose:
    // "SO #192626, deleted upstream" is the evidence the dialog shows.
    await recordStatusChange(tx, {
      orderId: input.orderId,
      fromStatus: order.status,
      toStatus: "CANCEL",
      source: input.source,
      actorUserId: input.actorUserId ?? null,
      note: composeCancelNote(input.note ?? null, releasedUnits),
    });

    return {
      cancelled: true,
      fromStatus: order.status,
      releasedUnits,
    } as const;
  });
}
