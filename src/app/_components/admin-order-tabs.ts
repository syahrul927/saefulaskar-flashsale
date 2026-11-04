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
 * Chips over the full status enum so no admin row can become unreachable —
 * the VALUES stay raw (they are the `?status=` deep-link contract and the
 * filter key); only the LABELS are Bahasa (final review I-1, "Admin prints
 * the raw enum" precedent retired — Goal 6 allows no raw enum anywhere in
 * user-visible copy).
 */
const TABS: readonly ("ALL" | OrderStatus)[] = [
  "ALL",
  "UNPAID",
  "CONFIRMED",
  "SHIPPED",
  "COMPLETED",
  "CANCEL",
];

/**
 * The admin's Bahasa words for the order statuses — words the app already
 * used, none invented: "Belum Bayar"/"Dibatalkan" are `CUSTOMER_STATUS_LABEL`
 * and "Dikonfirmasi"/"Diproses"/"Dikirim" are the customer pill set's own
 * words (`orders-list.tsx` TABS). The admin keeps per-status words because it
 * must tell apart the three states the customer map lumps into "Selesai".
 * Server-safe file, so the page (dialog `statusLabel`), the chips and the row
 * badges all read from this one map.
 */
const ADMIN_STATUS_LABEL: Record<OrderStatus, string> = {
  UNPAID: "Belum Bayar",
  CONFIRMED: "Dikonfirmasi",
  SHIPPED: "Dikirim",
  COMPLETED: "Diproses",
  CANCEL: "Dibatalkan",
};

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

export { ADMIN_STATUS_LABEL, TABS, resolveInitialTab };
export type { AdminTab };
