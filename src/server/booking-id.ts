import { and, count, gte, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "./db/schema";

/**
 * Generate a per-day booking ID `FS-{YYYYMMDD}-{SEQ4}` (e.g. `FS-20261025-0001`).
 *
 * `seq = count of orders created this UTC day + 1`. Counts rows in `orders`
 * where `created_at >= startOfDay AND created_at < startOfDay+24h`, inside a
 * transaction so concurrent checkouts don't collide on the same sequence.
 */
export function dayRange(date: Date): {
  start: Date;
  end: Date;
} {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function nextBookingId(
  db: Pick<PostgresJsDatabase<typeof schema>, "transaction">,
  date: Date,
): Promise<{ bookingId: string; seq: number }> {
  return db.transaction(async (tx) => {
    const { start, end } = dayRange(date);
    const rows = await tx
      .select({ value: count() })
      .from(schema.orders)
      .where(and(gte(schema.orders.createdAt, start), lt(schema.orders.createdAt, end)));
    const seq = Number(rows[0]?.value ?? 0) + 1;
    const yyyy = start.getUTCFullYear();
    const mm = String(start.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(start.getUTCDate()).padStart(2, "0");
    return { bookingId: `FS-${yyyy}${mm}${dd}-${String(seq).padStart(4, "0")}`, seq };
  });
}
