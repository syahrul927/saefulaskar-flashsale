/**
 * Pure filter core for the transactions lists (Task 15). The data is already
 * loaded server-side by the page — pills switch visibility over these rows
 * instantly, so there is no refetch path here at all.
 */

/** Pinned customer tab set (plan contract). */
type OrderFilterTab = "all" | "UNPAID" | "CONFIRMED" | "SHIPPED";

/** The only field the filters read — any order row shape satisfies it. */
type StatusFilterable = { status: string };

/** Pinned counts shape for the pill chips. */
type OrderStatusCounts = {
  all: number;
  UNPAID: number;
  CONFIRMED: number;
  SHIPPED: number;
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
 * Pill counts. `all` is the full list (COMPLETED orders included — they exist
 * in the enum but have no customer pill per the pinned tab set), the status
 * keys count their own status only.
 */
function statusCounts(
  orders: readonly StatusFilterable[],
): OrderStatusCounts {
  return {
    all: orders.length,
    UNPAID: orders.filter((order) => order.status === "UNPAID").length,
    CONFIRMED: orders.filter((order) => order.status === "CONFIRMED").length,
    SHIPPED: orders.filter((order) => order.status === "SHIPPED").length,
  };
}

export { filterOrders, statusCounts };
export type { OrderFilterTab, OrderStatusCounts, StatusFilterable };
