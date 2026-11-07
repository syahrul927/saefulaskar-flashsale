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
 * marketplace traffic, no usable sort/filter). It therefore reported
 * `synced: 0` on every run since it was written — and every run back then was a
 * nightly cron. There is no cron now (spec §4.7): one throttled pass, started
 * when an admin opens `/admin/orders`, is the only thing that moves a status.
 */

/**
 * What the sync may write. `SHIPPED` is deliberately absent: the customer needs
 * one post-payment state, not two (spec §4.7). The value still exists in the
 * `order_status` enum and in old rows — this says nothing can WRITE it, not that
 * it never happened.
 *
 * `CANCEL` is the newest member and the only one that never travels the ladder:
 * `planSync` turns a definitive 404 or an upstream `CANCELED` into a cancel
 * patch and returns before ranking anything, and the caller routes that patch to
 * `cancelOrder` — the one door that releases the session quota and writes the
 * history row with the status.
 */
export type SyncStatus = "CONFIRMED" | "COMPLETED" | "CANCEL";

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

/**
 * What one SO fetch PROVED. Three answers, and collapsing any two of them is
 * the bug this type exists to prevent:
 *
 * - `state` — we read the SO and parsed its header.
 * - `missing` — Jubelio answered a DEFINITIVE 404 for an id we hold. Our own
 *   checkout created that SO, so it is gone upstream: somebody deleted it, and
 *   the customer's units are still reserved against a session that will never
 *   pay. This is the only verdict that cancels (spec §4.3).
 * - `unknown` — everything else that can go wrong: timeout, 401/403 from a token
 *   that lost scope, a 5xx, a 2xx we could not parse. All of these leave the
 *   order exactly as it was, because an unreachable upstream must never look
 *   like a deleted order (Review Focus 1).
 *
 * `detail` is for the server log, not for the admin — the sync is not surfaced
 * anywhere (spec §4.4).
 */
export type SoVerdict =
  | { kind: "state"; state: SalesOrderState }
  | { kind: "missing" }
  | { kind: "unknown"; detail: string };

/**
 * Empty unless something actually changed — the caller skips it otherwise.
 *
 * `cause` rides along on a cancel patch only: the human-readable reason that
 * becomes the note in `order_status_history`, composed here because only the
 * pure core knows both the SO id and which verdict fired.
 */
export type SyncPatch = {
  orderId: string;
  status?: SyncStatus;
  trackingNumber?: string;
  shipper?: string;
  cause?: string;
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

// No `CANCEL` rung, deliberately. `rank()` returns -1 for it, which is harmless
// because `planSync` skips a `CANCEL` row outright before ranking anything —
// and putting a cancel on the ladder would make a side exit look like a rung an
// `UNPAID` row could "advance" to on a stale read.

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
 * alone — notably `PENDING`/`PROCESSING`, which mean "not paid upstream yet".
 * `channel_status`
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
    // Maps onto the local member, but the LADDER never writes it: `planSync`
    // turns `CANCEL` into a cancel patch with a cause and returns before
    // ranking or backfilling, so the transition still goes through
    // `cancelOrder` — quota release and history row included.
    case "CANCELED":
      return "CANCEL";
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
 * - a `CANCEL` row gets nothing, whatever the SO says — nothing upstream
 *   un-cancels it, and `rank("CANCEL")` is -1 besides (Review Focus 2);
 * - a `COMPLETED` row gets the resi/shipper backfill only, when they differ —
 *   never a status write, never a cancel, not even on a 404 verdict or an
 *   upstream `CANCELED` (spec §4.4: the invoice webhook can complete a row
 *   before its resi arrives, and polling must still reach it);
 * - no verdict, or an `unknown` one, leaves the order alone (Review Focus 1);
 * - a `missing` verdict cancels it, and so does an upstream `CANCELED`;
 * - a cancel patch carries a `cause` and no resi — shipping detail is never
 *   backfilled onto an order we are cancelling (spec §4.3);
 * - otherwise status only moves forward along `STATUS_RANK`;
 * - `tracking_number` / `shipper` are backfilled when they differ from what we
 *   already stored, which is how a resi reaches the customer after the fact;
 * - an order with nothing to change produces no patch at all.
 */
export function planSync(
  localOrders: LocalOrderSnapshot[],
  verdictsBySoId: ReadonlyMap<number, SoVerdict>,
): SyncPatch[] {
  const patches: SyncPatch[] = [];

  for (const order of localOrders) {
    if (order.jubelioSoId == null) continue;
    // Second half of Review Focus 2: `rank()` returns -1 for `CANCEL`, so
    // without short-circuiting a cancelled row first, a stale `PAID` read would
    // rewrite it to CONFIRMED and hand back nothing to nobody. Nothing above
    // it on the ladder can ever apply, so a `CANCEL` row is skipped wholesale.
    if (order.status === "CANCEL") continue;
    // `COMPLETED` is no longer a blanket skip: the invoice webhook can park a
    // row here before its resi arrives, so the backfill below must still run —
    // but no status write may ever follow, and no cancel either, which is what
    // the `completed` flag gates further down.
    const completed = order.status === "COMPLETED";

    const verdict = verdictsBySoId.get(order.jubelioSoId);
    if (!verdict || verdict.kind === "unknown") continue;

    // The two cancel paths are one patch shape: a definitive 404 and an
    // upstream `CANCELED` differ only in their cause, and both are exempt from
    // the ladder (spec §4.4 — the ladder exists to stop regressions *along* it,
    // and a cancel is not a rung). A `COMPLETED` row is exempt the other way:
    // the order is done, so neither cancel path may touch it.
    if (verdict.kind === "missing") {
      if (completed) continue;
      patches.push({
        orderId: order.id,
        status: "CANCEL",
        cause: `SO #${order.jubelioSoId} dihapus di Jubelio`,
      });
      continue;
    }

    const next = mapInternalStatus(verdict.state.internalStatus);
    if (!next) continue;
    if (next === "CANCEL") {
      if (completed) continue;
      patches.push({
        orderId: order.id,
        status: "CANCEL",
        cause: `Jubelio menandai SO #${order.jubelioSoId} dibatalkan`,
      });
      continue;
    }

    const patch: SyncPatch = { orderId: order.id };
    // The ladder is forward-only, and a `COMPLETED` row takes no status write
    // at all: the webhook already finished it, and a `PAID`/`SHIPPED` read
    // ranks below it besides.
    if (!completed && rank(next) > rank(order.status)) patch.status = next;
    const state = verdict.state;
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
