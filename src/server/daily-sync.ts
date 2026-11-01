/**
 * Order-status sync (spec §4.6). Pure core so the status mapping and the update
 * plan are unit-testable without HTTP or the DB; the caller (`runOrderSync` in
 * `src/server/order-sync.ts`) fetches each linked SO by id and applies the
 * returned patches.
 *
 * Rewritten 2026-10-30 against live responses (read-only probe 2026-10-29).
 * The previous version read a `status` label off the sales-order LIST and
 * matched `"Ready to Ship"` / `"Shipped"` / `"Completed"`. Neither half was
 * true: list rows carry no `status` key at all (0 of 200 probed), the real
 * field is `internal_status` with an UPPERCASE vocabulary, and the list cannot
 * contain our orders anyway (184 072 rows, 200/page, page 1 is 2022
 * marketplace traffic, no usable sort/filter). The cron therefore reported
 * `synced: 0` every night since it was written.
 */

/**
 * What the sync may write. `SHIPPED` is deliberately absent: the customer needs
 * one post-payment state, not two (spec §4.7). The value still exists in the
 * `order_status` enum and in old rows — this says nothing can WRITE it, not that
 * it never happened.
 */
export type SyncStatus = "CONFIRMED" | "COMPLETED";

/** A local order narrowed to the fields the sync needs. */
export type LocalOrderSnapshot = {
  id: string;
  jubelioSoId: number | null;
  status: string;
  trackingNumber?: string | null;
  shipper?: string | null;
};

/** What one Jubelio SO header tells us, normalised. */
export type SalesOrderState = {
  internalStatus: string;
  trackingNumber: string | null;
  shipper: string | null;
};

/** Empty unless something actually changed — the caller skips it otherwise. */
export type SyncPatch = {
  orderId: string;
  status?: SyncStatus;
  trackingNumber?: string;
  shipper?: string;
};

/**
 * Local order-status rank. The sync only ever moves FORWARD along it: a stale
 * or partially-filled SO (Jubelio answers `PAID` for an order we already
 * shipped) must not drag a customer's order backwards.
 */
const STATUS_RANK: Record<string, number> = {
  UNPAID: 0,
  CONFIRMED: 1,
  // Nothing writes SHIPPED any more, but rows that already carry it must not be
  // pulled back to CONFIRMED by a shipped SO — rank it where history put it.
  SHIPPED: 2,
  COMPLETED: 3,
};

function rank(status: string): number {
  // Unknown local value ranks below everything, so an unexpected status can
  // only be corrected forward, never sideways.
  return STATUS_RANK[status] ?? -1;
}

/**
 * Map a Jubelio `internal_status` onto the local order enum.
 *
 * Observed values (probe 2026-10-29): `PENDING, PAID, PROCESSING, SHIPPED,
 * COMPLETED, CANCELED`. Everything else returns `null` and leaves the order
 * alone — notably `CANCELED`, which has no local member, and
 * `PENDING`/`PROCESSING`, which mean "not paid upstream yet". `channel_status`
 * labels (`delivered`, `remitted`, `Ready to Ship`) are a DIFFERENT vocabulary
 * and must not be fed in here.
 *
 * `SHIPPED` collapses to CONFIRMED rather than being dropped (spec §4.7): it is
 * proof the order is paid and moving, so it must still lift an UNPAID row whose
 * confirm link was late — but it is not a state we show the customer. The
 * `tracking_number` the same response carries is what says "shipped", in the resi
 * strip, and `planSync` copies it whether or not the status moves.
 */
export function mapInternalStatus(raw: string): SyncStatus | null {
  switch (raw.trim().toUpperCase()) {
    case "PAID":
    case "SHIPPED":
      return "CONFIRMED";
    case "COMPLETED":
      return "COMPLETED";
    default:
      return null;
  }
}

function nonEmpty(value: unknown): string | null {
  // A freshly created SO answers `tracking_number: ""` and `shipper: ""` —
  // an empty resi is no resi, so it normalises to null.
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Read the status + shipping detail out of a `GET /sales/orders/{id}` body.
 * The by-id response puts the header fields at the TOP level next to `items`
 * (the list/search endpoints wrap rows in `{ data: [...] }` instead), so both
 * are accepted. Returns `null` when there is no `internal_status` — the caller
 * then leaves the order untouched rather than guessing.
 */
export function readSalesOrderState(raw: unknown): SalesOrderState | null {
  let header: unknown = raw;
  if (header && typeof header === "object" && !Array.isArray(header)) {
    const obj = header as Record<string, unknown>;
    if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
      header = obj.data;
    }
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) return null;
  const row = header as Record<string, unknown>;
  if (typeof row.internal_status !== "string") return null;
  return {
    internalStatus: row.internal_status,
    trackingNumber: nonEmpty(row.tracking_number),
    shipper: nonEmpty(row.shipper),
  };
}

/**
 * Compute the patches to apply for one sync pass.
 *
 * Rules, each one pinned by a test:
 * - an SO we have no state for (fetch failed, SO absent) leaves the order alone;
 * - an SO whose `internal_status` we cannot express leaves the order alone —
 *   including `CANCELED`, so shipping detail is never backfilled onto it;
 * - status only moves forward along `STATUS_RANK`;
 * - `tracking_number` / `shipper` are backfilled when they differ from what we
 *   already stored, which is how a resi reaches the customer after the fact;
 * - an order with nothing to change produces no patch at all.
 */
export function planSync(
  localOrders: LocalOrderSnapshot[],
  statesBySoId: Map<number, SalesOrderState>,
): SyncPatch[] {
  const patches: SyncPatch[] = [];

  for (const order of localOrders) {
    if (order.jubelioSoId == null) continue;
    const state = statesBySoId.get(order.jubelioSoId);
    if (!state) continue;

    const next = mapInternalStatus(state.internalStatus);
    if (!next) continue;

    const patch: SyncPatch = { orderId: order.id };
    if (rank(next) > rank(order.status)) patch.status = next;
    if (
      state.trackingNumber !== null &&
      state.trackingNumber !== (order.trackingNumber ?? null)
    ) {
      patch.trackingNumber = state.trackingNumber;
    }
    if (state.shipper !== null && state.shipper !== (order.shipper ?? null)) {
      patch.shipper = state.shipper;
    }
    if (Object.keys(patch).length > 1) patches.push(patch);
  }

  return patches;
}
