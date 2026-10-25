/**
 * Daily order-status sync (spec §4.6). Pure core so the status mapping and the
 * update plan are unit-testable without HTTP or the DB; the route handler (in
 * `src/app/api/cron/daily-sync/route.ts`) fetches the raw SO list and applies
 * the returned patches.
 */

export type SyncStatus = "CONFIRMED" | "SHIPPED" | "COMPLETED";

/** A local order narrowed to the fields the sync needs. */
export type LocalOrderSnapshot = {
  id: string;
  jubelioSoId: number | null;
  status: string;
};

export type SyncPatch = {
  orderId: string;
  status: SyncStatus;
};

/**
 * Map a Jubelio sales-order status label onto the local order enum. Unknown or
 * indeterminate labels map to `null` (leave the order alone).
 */
export function mapJubelioStatus(raw: string): SyncStatus | null {
  switch (raw.trim()) {
    case "Ready to Ship":
      return "CONFIRMED";
    case "Shipped":
      return "SHIPPED";
    case "Completed":
      return "COMPLETED";
    default:
      return null;
  }
}

type RawSalesOrder = { salesorder_id: number; status: string };

/**
 * Extract `{ salesorder_id, status }` rows from a raw `listSalesOrders`
 * response. Tolerates both a bare array and the common wrapped shapes
 * (`data`, `salesorders`, etc.); non-matching rows are dropped.
 */
function extractSalesOrders(raw: unknown): RawSalesOrder[] {
  let rows: unknown[] = [];
  if (Array.isArray(raw)) {
    rows = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidates = [obj.data, obj.salesorders, obj.sales_orders, obj.items, obj.result];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        rows = candidate;
        break;
      }
    }
    if (rows.length === 0 && typeof obj.status === "string") rows = [raw];
  }

  const out: RawSalesOrder[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = o.salesorder_id ?? o.salesorderId ?? o.id;
    const status = o.status ?? o.order_status ?? o.status_name;
    if (typeof id !== "number" || typeof status !== "string") continue;
    out.push({ salesorder_id: id, status });
  }
  return out;
}

/**
 * Compute the list of status patches to apply. Only orders with a matching SO
 * id AND an explicit, *changed* mapped status are included — unlisted SO ids and
 * unknown labels leave the order untouched.
 */
export function planSync(
  localOrders: LocalOrderSnapshot[],
  salesOrders: unknown,
): SyncPatch[] {
  const statuses = new Map<number, string>();
  for (const so of extractSalesOrders(salesOrders)) {
    statuses.set(so.salesorder_id, so.status);
  }

  const patches: SyncPatch[] = [];
  for (const order of localOrders) {
    if (order.jubelioSoId == null) continue;
    const rawStatus = statuses.get(order.jubelioSoId);
    if (rawStatus === undefined) continue;
    const next = mapJubelioStatus(rawStatus);
    if (!next || next === order.status) continue;
    patches.push({ orderId: order.id, status: next });
  }
  return patches;
}