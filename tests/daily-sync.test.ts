import { describe, expect, it } from "vitest";

import {
  mapInternalStatus,
  planSync,
  readSalesOrderState,
  type LocalOrderSnapshot,
  type SoVerdict,
} from "@/server/daily-sync";

/**
 * Fixtures are copied from live Jubelio responses (read-only probe
 * 2026-10-29), not from the docs. The PRD's sync section asserted the sync would
 * read a `status` label like `"Shipped"` — no such field exists: list rows
 * carry `internal_status` / `channel_status` / `wms_status`, and the by-id
 * header is where the shipping detail lives. The old mapping therefore never
 * matched anything and the cron reported `synced: 0` every night.
 *
 *   SO 209     internal=SHIPPED   channel=delivered  wms=SHIPPED   tn=001818714258 shipper="SiCepat HALU"
 *   SO 85      internal=COMPLETED channel=remitted   wms=COMPLETED tn=001830032579 shipper="SiCepat REG"
 *   SO 86      internal=CANCELED  channel=refunded   wms=CANCELED  is_canceled=true
 *   SO 192297  internal=PAID      channel=Paid       wms=PAID      tn="" shipper=""
 */
const SHIPPED_SO = {
  items: [],
  salesorder_id: 209,
  salesorder_no: "BL-223404464451",
  internal_status: "SHIPPED",
  channel_status: "delivered",
  wms_status: "SHIPPED",
  is_canceled: null,
  tracking_number: "001818714258",
  shipper: "SiCepat HALU",
  tn_created_date: "2022-12-06T03:22:15.634Z",
  completed_date: null,
  is_shipped: null,
  marked_as_complete: null,
};

const COMPLETED_SO = {
  items: [],
  salesorder_id: 85,
  internal_status: "COMPLETED",
  channel_status: "remitted",
  wms_status: "COMPLETED",
  tracking_number: "001830032579",
  shipper: "SiCepat REG",
};

const PAID_SO = {
  items: [],
  salesorder_id: 192297,
  salesorder_no: "SO-000192297",
  internal_status: "PAID",
  channel_status: "Paid",
  wms_status: "PAID",
  tracking_number: "",
  shipper: "",
};

const CANCELED_SO = {
  items: [],
  salesorder_id: 86,
  internal_status: "CANCELED",
  channel_status: "refunded",
  wms_status: "CANCELED",
  is_canceled: true,
  tracking_number: null,
  shipper: "Grab Same Day",
};

describe("mapInternalStatus", () => {
  it("maps the internal_status values Jubelio actually emits", () => {
    expect(mapInternalStatus("PAID")).toBe("CONFIRMED");
    // SHIPPED is skipped, not deleted (spec §4.7): the customer needs one
    // post-payment state, so a shipped SO states the strongest thing we still
    // mean — it is confirmed and paid. The resi itself carries the shipping.
    expect(mapInternalStatus("SHIPPED")).toBe("CONFIRMED");
    expect(mapInternalStatus("COMPLETED")).toBe("COMPLETED");
  });

  it("is case/space tolerant", () => {
    expect(mapInternalStatus(" shipped ")).toBe("CONFIRMED");
  });

  it("returns null for states the local enum cannot express", () => {
    // PENDING/PROCESSING mean "not paid yet" upstream, so neither may move a
    // row; anything unrecognised leaves the order alone rather than guessing.
    expect(mapInternalStatus("PENDING")).toBeNull();
    expect(mapInternalStatus("PROCESSING")).toBeNull();
    expect(mapInternalStatus("UNKNOWN")).toBeNull();
    expect(mapInternalStatus("")).toBeNull();
  });

  it("maps upstream CANCELED onto the local CANCEL member", () => {
    // Mapped, not nulled — but `planSync` turns it into a cancel PATCH rather
    // than a ladder write, so the quota release and the history row still come
    // from `cancelOrder` and never from a bare status update.
    expect(mapInternalStatus("CANCELED")).toBe("CANCEL");
    expect(mapInternalStatus("canceled")).toBe("CANCEL");
  });

  it("does not read the channel vocabulary as an internal status", () => {
    // `delivered` / `remitted` / `Ready to Ship` are channel_status labels.
    expect(mapInternalStatus("delivered")).toBeNull();
    expect(mapInternalStatus("remitted")).toBeNull();
    expect(mapInternalStatus("Ready to Ship")).toBeNull();
  });
});

describe("readSalesOrderState", () => {
  it("reads the by-id header: status + tracking + shipper", () => {
    expect(readSalesOrderState(SHIPPED_SO)).toEqual({
      internalStatus: "SHIPPED",
      trackingNumber: "001818714258",
      shipper: "SiCepat HALU",
    });
  });

  it("normalises empty-string tracking to null", () => {
    // Our freshly created SO ships `""` for both — an empty resi is no resi.
    expect(readSalesOrderState(PAID_SO)).toEqual({
      internalStatus: "PAID",
      trackingNumber: null,
      shipper: null,
    });
  });

  it("reads a CANCELED header, shipper and all", () => {
    // The shipper surviving the parse is what makes "a cancel patch carries no
    // resi" worth asserting separately: the data is right there in the body, so
    // dropping it is a choice `planSync` makes, not something the read hides.
    expect(readSalesOrderState(CANCELED_SO)).toEqual({
      internalStatus: "CANCELED",
      trackingNumber: null,
      shipper: "Grab Same Day",
    });
  });

  it("unwraps a `{ data: … }` envelope", () => {
    expect(readSalesOrderState({ data: COMPLETED_SO })?.internalStatus).toBe(
      "COMPLETED",
    );
  });

  it("returns null without a usable internal_status", () => {
    expect(readSalesOrderState({ salesorder_id: 1 })).toBeNull();
    expect(readSalesOrderState(null)).toBeNull();
    expect(readSalesOrderState([])).toBeNull();
    expect(readSalesOrderState("nope")).toBeNull();
  });
});

describe("planSync", () => {
  /** The `state` verdict, spelled out once — the SO ids are the live probe's. */
  const soState = (
    internalStatus: string,
    trackingNumber: string | null,
    shipper: string | null,
  ): SoVerdict => ({
    kind: "state",
    state: { internalStatus, trackingNumber, shipper },
  });

  const verdicts = new Map<number, SoVerdict>([
    [209, soState("SHIPPED", "001818714258", "SiCepat HALU")],
    [85, soState("COMPLETED", "001830032579", "SiCepat REG")],
    [192297, soState("PAID", null, null)],
    [86, soState("CANCELED", null, "Grab Same Day")],
  ]);

  const local = (...rows: LocalOrderSnapshot[]) => planSync(rows, verdicts);

  /** An ad-hoc map for the cases that are about the VERDICT, not the SO body. */
  const verdictMap = (entries: [number, SoVerdict][]) =>
    new Map<number, SoVerdict>(entries);

  it("keeps a shipped SO at CONFIRMED but still delivers the resi", () => {
    // The whole point of skipping SHIPPED (spec §4.7): the status ladder stays
    // two steps, while the tracking number and courier reach the customer as
    // soon as the SO ships.
    expect(local({ id: "a", jubelioSoId: 209, status: "CONFIRMED" })).toEqual([
      { orderId: "a", trackingNumber: "001818714258", shipper: "SiCepat HALU" },
    ]);
  });

  it("never writes SHIPPED, from any upstream status", () => {
    for (const status of ["UNPAID", "CONFIRMED"] as const) {
      for (const soId of [209, 85, 192297, 86]) {
        for (const patch of planSync(
          [{ id: "a", jubelioSoId: soId, status }],
          verdicts,
        )) {
          // Widened on purpose: `SyncStatus` no longer admits "SHIPPED", so the
          // assertion is about the runtime value, not the type.
          expect(patch.status as string | undefined).not.toBe("SHIPPED");
        }
      }
    }
  });

  it("advances SHIPPED → COMPLETED", () => {
    expect(
      local({
        id: "a",
        jubelioSoId: 85,
        status: "SHIPPED",
        trackingNumber: "001830032579",
        shipper: "SiCepat REG",
      }),
    ).toEqual([{ orderId: "a", status: "COMPLETED" }]);
  });

  it("never regresses: a PAID SO cannot pull SHIPPED back", () => {
    expect(
      local({ id: "a", jubelioSoId: 192297, status: "SHIPPED" }),
    ).toEqual([]);
    // The CANCELED half of this test moved: soId 86 no longer leaves a
    // CONFIRMED row alone, it cancels it (asserted below), because an SO that
    // upstream marked cancelled is a cancellation we must not sit on.
  });

  it("cancels on a definitive 404 and nothing else", () => {
    const row = { id: "a", jubelioSoId: 86, status: "CONFIRMED" };
    expect(planSync([row], verdictMap([[86, { kind: "missing" }]]))).toEqual([
      {
        orderId: "a",
        status: "CANCEL",
        cause: "SO #86 dihapus di Jubelio",
      },
    ]);
    // Review Focus 1: an unreachable upstream is not a deleted order. A 403 is
    // the live one — the sync reads with the system token while the SO was made
    // with an admin's, so a scope change surfaces exactly like a missing SO
    // would if this line were `catch → cancel`.
    expect(
      planSync([row], verdictMap([[86, { kind: "unknown", detail: "403 Forbidden" }]])),
    ).toEqual([]);
  });

  it("emits a cancel patch for an upstream CANCELED SO, with a cause and no resi", () => {
    // soId 86's fixture carries `shipper: "Grab Same Day"` — a cancel must not
    // deliver shipping detail onto the order it is cancelling (spec §4.3), so
    // `toEqual` on exactly three keys is the assertion that pins it.
    expect(local({ id: "a", jubelioSoId: 86, status: "CONFIRMED" })).toEqual([
      {
        orderId: "a",
        status: "CANCEL",
        cause: "Jubelio menandai SO #86 dibatalkan",
      },
    ]);
  });

  it("cancels a legacy SHIPPED row on a 404, where the admin door would refuse it", () => {
    // Deliberate asymmetry, pinned here because nothing else would: `SHIPPED` is
    // not an end state (`END_STATUSES` is COMPLETED + CANCEL) and is not
    // cancellable by hand either (`isCancellable` is UNPAID + CONFIRMED, so
    // Task 9's route answers 409 for this row). The sync is the only door that
    // cleans legacy rows up, and it must not stop at CONFIRMED.
    expect(planSync([{ id: "a", jubelioSoId: 86, status: "SHIPPED" }], verdictMap([[86, { kind: "missing" }]]))).toEqual([
      {
        orderId: "a",
        status: "CANCEL",
        cause: "SO #86 dihapus di Jubelio",
      },
    ]);
  });

  it("never pulls an end-state row forward, whatever the SO says", () => {
    // soId 192297's fixture is `internalStatus: "PAID"` → CONFIRMED locally,
    // i.e. forward from CANCEL on the ladder, and `rank("CANCEL")` is -1. Review
    // Focus 2: without `isEndState` short-circuiting first, a stale PAID read
    // would resurrect a cancelled order and leave its quota unreturned.
    expect(local({ id: "a", jubelioSoId: 192297, status: "CANCEL" })).toEqual([]);
    expect(
      local({ id: "a", jubelioSoId: 192297, status: "COMPLETED" }),
    ).toEqual([]);
  });

  it("never cancels a COMPLETED row on a 404", () => {
    // The money is in and the order is done; a deleted SO upstream is now just
    // bookkeeping, not a reason to release quota the customer already used.
    expect(
      planSync(
        [{ id: "a", jubelioSoId: 86, status: "COMPLETED" }],
        verdictMap([[86, { kind: "missing" }]]),
      ),
    ).toEqual([]);
  });

  it("emits no patch when nothing changed", () => {
    expect(local({ id: "a", jubelioSoId: 192297, status: "CONFIRMED" })).toEqual([]);
    expect(
      local({
        id: "a",
        jubelioSoId: 209,
        status: "SHIPPED",
        trackingNumber: "001818714258",
        shipper: "SiCepat HALU",
      }),
    ).toEqual([]);
  });

  it("backfills the resi alone when the status already matches", () => {
    expect(
      local({ id: "a", jubelioSoId: 209, status: "SHIPPED", trackingNumber: null }),
    ).toEqual([
      { orderId: "a", trackingNumber: "001818714258", shipper: "SiCepat HALU" },
    ]);
  });

  it("skips orders with no SO id and SO ids it has no state for", () => {
    expect(local({ id: "a", jubelioSoId: null, status: "UNPAID" })).toEqual([]);
    // Fetch failed / SO absent upstream → leave the row untouched.
    expect(local({ id: "a", jubelioSoId: 999999, status: "CONFIRMED" })).toEqual([]);
  });

  it("allows a forward jump (UNPAID → CONFIRMED) when the confirm link was late", () => {
    expect(local({ id: "a", jubelioSoId: 209, status: "UNPAID" })).toEqual([
      {
        orderId: "a",
        status: "CONFIRMED",
        trackingNumber: "001818714258",
        shipper: "SiCepat HALU",
      },
    ]);
  });

  it("plans several orders in one pass, in input order", () => {
    expect(
      local(
        { id: "a", jubelioSoId: 209, status: "CONFIRMED" },
        { id: "b", jubelioSoId: 192297, status: "CONFIRMED" },
        { id: "c", jubelioSoId: 85, status: "CONFIRMED" },
      ),
    ).toEqual([
      {
        orderId: "a",
        trackingNumber: "001818714258",
        shipper: "SiCepat HALU",
      },
      { orderId: "c", status: "COMPLETED", trackingNumber: "001830032579", shipper: "SiCepat REG" },
    ]);
  });
});
