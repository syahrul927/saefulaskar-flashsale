/**
 * Pure filter core for the transactions lists (Task 15). The data is already
 * loaded server-side by the page — pills switch visibility over these rows
 * instantly, so there is no refetch path here at all.
 */

/**
 * Pinned customer tab set (plan contract), re-pinned 2026-10-31: SHIPPED left it
 * and COMPLETED took its place (spec §4.7). A customer's ladder is three steps —
 * not paid, paid, out of our hands — and legacy rows still sitting on SHIPPED
 * stay reachable under `"all"`.
 */
type OrderFilterTab = "all" | "UNPAID" | "CONFIRMED" | "COMPLETED";

/** The only field the filters read — any order row shape satisfies it. */
type StatusFilterable = { status: string };

/** Pinned counts shape for the pill chips. */
type OrderStatusCounts = {
  all: number;
  UNPAID: number;
  CONFIRMED: number;
  COMPLETED: number;
};

/** Rows for one tab, original order preserved; `"all"` keeps everything. */
function filterOrders<T extends StatusFilterable>(
  orders: readonly T[],
  tab: OrderFilterTab,
): T[] {
  if (tab === "all") return [...orders];
  return orders.filter((order) => order.status === tab);
}

/**
 * Pill counts. `all` is the full list — every status, including a legacy SHIPPED
 * row that no longer has a pill of its own — and the three status keys count
 * their own status only.
 */
function statusCounts(
  orders: readonly StatusFilterable[],
): OrderStatusCounts {
  return {
    all: orders.length,
    UNPAID: orders.filter((order) => order.status === "UNPAID").length,
    CONFIRMED: orders.filter((order) => order.status === "CONFIRMED").length,
    COMPLETED: orders.filter((order) => order.status === "COMPLETED").length,
  };
}

export { filterOrders, statusCounts };
export type { OrderFilterTab, OrderStatusCounts, StatusFilterable };
