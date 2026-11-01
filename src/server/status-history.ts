import { asc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "./db/schema";
import { orderStatusHistory, user } from "./db/schema";
import type { OrderStatus, StatusHistorySource } from "./order-status";

/**
 * Server-only write/read seams for `order_status_history` (spec §4.5). Every
 * producer and consumer of history goes through these two functions, so the
 * shape of a row is decided exactly once. Never imported for runtime values
 * by a client island — Task 6/12 read entries here and hand the client
 * already-formatted strings, never a `Date`.
 */

/**
 * A `tx` inside `db.transaction(...)` satisfies both aliases: drizzle types
 * it as `PgTransaction<...>` extending `PgDatabase<...>` with the same
 * schema generics, so `insert`/`select` are the identical members — the
 * structural-widening fallback in the plan was not needed (verified by
 * typecheck, not just by reading the class).
 */
export type StatusWriter = Pick<PostgresJsDatabase<typeof schema>, "insert">;
export type StatusReader = Pick<PostgresJsDatabase<typeof schema>, "select">;

/** One transition the caller has already decided happened. */
export type StatusChangeEntry = {
  orderId: string;
  /** `null` only on the creation row — there is no status before UNPAID. */
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  source: StatusHistorySource;
  actorUserId?: string | null;
  note?: string | null;
};

/**
 * Append one history row. Deliberately has NO status logic, guard, or
 * default transition: the caller decided this transition happened (spec
 * §8.10 — no invented rows), and re-checking legality here would let two
 * places own the transition rules. `createdAt`/`id` come from the column
 * defaults; `orders.updated_at` is rewritten by `$onUpdate` and must never
 * be read as "when this status began" — this table is the only record.
 */
export async function recordStatusChange(
  db: StatusWriter,
  entry: StatusChangeEntry,
): Promise<void> {
  await db.insert(orderStatusHistory).values({
    orderId: entry.orderId,
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    source: entry.source,
    // Null (not undefined) so a checkout row claims no person and a row
    // without a note stores SQL NULL, matching the columns' nullable shape.
    actorUserId: entry.actorUserId ?? null,
    note: entry.note ?? null,
  });
}

/** One history row as the display layer needs it — raw values, nothing pre-formatted. */
export type StatusHistoryEntry = {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  source: StatusHistorySource;
  /**
   * `user.full_name` via left join. `null` means the actor is GONE: the
   * `set null` FK zeroed `actorUserId` when the admin was deleted, so the
   * row must still surface (spec §4.5). `""` means the user exists but has
   * an empty name — `full_name` is `notNull().default("")` — so the two
   * cases are distinct here and the "deleted admin" label is a display
   * decision (Task 6/12), not this seam's.
   */
  actorName: string | null;
  note: string | null;
  createdAt: Date;
};

/**
 * History for `orderIds` in ONE query, grouped per order, ascending by
 * `created_at`. Flat-and-ordered in SQL, bucketed in memory: `Map` keeps
 * insertion order, so each group inherits the row order the driver
 * returned and the `orderBy(asc(createdAt))` is what orders it — no
 * re-sorting here. An empty `orderIds` returns an empty `Map` without
 * touching the database, because `inArray(col, [])` would still be a query.
 */
export async function listStatusHistory(
  db: StatusReader,
  orderIds: readonly string[],
): Promise<Map<string, StatusHistoryEntry[]>> {
  const grouped = new Map<string, StatusHistoryEntry[]>();
  if (orderIds.length === 0) return grouped;

  const rows = await db
    .select({
      id: orderStatusHistory.id,
      orderId: orderStatusHistory.orderId,
      fromStatus: orderStatusHistory.fromStatus,
      toStatus: orderStatusHistory.toStatus,
      source: orderStatusHistory.source,
      note: orderStatusHistory.note,
      createdAt: orderStatusHistory.createdAt,
      actorName: user.fullName,
    })
    .from(orderStatusHistory)
    // LEFT join, not inner: `actor_user_id` goes null when an admin is
    // deleted (`onDelete: "set null"`), and the history row must survive
    // losing its actor — an inner join would silently drop audit rows.
    .leftJoin(user, eq(orderStatusHistory.actorUserId, user.id))
    .where(inArray(orderStatusHistory.orderId, [...orderIds]))
    .orderBy(asc(orderStatusHistory.createdAt));

  for (const row of rows) {
    const { orderId, ...entry } = row;
    const list = grouped.get(orderId) ?? [];
    list.push(entry);
    grouped.set(orderId, list);
  }
  return grouped;
}
