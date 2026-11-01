import type { OrderStatus } from "./status-badge";

/**
 * Admin orders tab vocabulary, split out of `admin-orders-filter.tsx`.
 *
 * The filter island is a `"use client"` module, and the orders page (a
 * server component) reads `?status=` and calls `resolveInitialTab` during
 * server render — invoking an export of a client module from the server
 * throws Next's "Attempted to call … from the server but … is on the
 * client" runtime error. Pure shared logic like this must live in a
 * server-safe module that both sides import (same convention the customer
 * lists use with `order-filters.ts`).
 */

/**
 * Raw-enum uppercase chips — the admin label precedent (Tasks 6/9), widened
 * to the full status enum so no admin row can become unreachable.
 */
const TABS: readonly ("ALL" | OrderStatus)[] = [
  "ALL",
  "UNPAID",
  "CONFIRMED",
  "SHIPPED",
  "COMPLETED",
  "CANCEL",
];

type AdminTab = (typeof TABS)[number];

/**
 * Deep-link contract (spec decision 4): the console's "Perlu Konfirmasi" KPI
 * tile links to `/admin/orders?status=UNPAID`, so the page reads `?status=`
 * and hands the value here. Anything outside the tab set — garbage, array,
 * empty — falls back to "ALL" instead of a dead tab. Exported for unit tests.
 */
function resolveInitialTab(raw: string | undefined): AdminTab {
  return raw && (TABS as readonly string[]).includes(raw)
    ? (raw as AdminTab)
    : "ALL";
}

export { TABS, resolveInitialTab };
export type { AdminTab };
