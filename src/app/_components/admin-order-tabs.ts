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
  "COMPLETED",
  "CANCEL",
];

/**
 * The admin's Bahasa words for the order statuses. Under the 2026-11-08
 * lifecycle (spec 2026-11-08: UNPAID → CONFIRMED → COMPLETED-on-faktur)
 * COMPLETED is the order's finish from the admin's operational view — the
 * resi may arrive later but does not reopen the lifecycle — so it shares the
 * customer map's word "Selesai" instead of the old "Diproses" (which named
 * the pre-webhook meaning "being processed"). SHIPPED keeps "Dikirim" only
 * because the type requires every enum key: nothing writes it anymore, but
 * legacy rows under "Semua" must still get a real Bahasa badge, never a raw
 * enum token. SHIPPED has no tab — dead vocabulary in the filter bar would
 * render as a permanent zero-count pill.
 * Server-safe file, so the page (dialog `statusLabel`), the chips and the row
 * badges all read from this one map.
 */
const ADMIN_STATUS_LABEL: Record<OrderStatus, string> = {
  UNPAID: "Belum Bayar",
  CONFIRMED: "Dikonfirmasi",
  SHIPPED: "Dikirim",
  COMPLETED: "Selesai",
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
