import { describe, expect, it } from "vitest";

import {
  mapInternalStatus,
  planSync,
  readSalesOrderState,
  type LocalOrderSnapshot,
  type SalesOrderState,
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
    // PENDING/PROCESSING mean "not paid yet" upstream; CANCELED has no local
    // enum member, so both leave the order alone rather than inventing one.
    expect(mapInternalStatus("PENDING")).toBeNull();
    expect(mapInternalStatus("PROCESSING")).toBeNull();
    expect(mapInternalStatus("CANCELED")).toBeNull();
    expect(mapInternalStatus("UNKNOWN")).toBeNull();
    expect(mapInternalStatus("")).toBeNull();
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
  const states = new Map<number, SalesOrderState>([
    [209, { internalStatus: "SHIPPED", trackingNumber: "001818714258", shipper: "SiCepat HALU" }],
    [85, { internalStatus: "COMPLETED", trackingNumber: "001830032579", shipper: "SiCepat REG" }],
    [192297, { internalStatus: "PAID", trackingNumber: null, shipper: null }],
    [86, { internalStatus: "CANCELED", trackingNumber: null, shipper: "Grab Same Day" }],
  ]);

  const local = (...rows: LocalOrderSnapshot[]) => planSync(rows, states);

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
        for (const patch of planSync([{ id: "a", jubelioSoId: soId, status }], states)) {
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

  it("never regresses: a PAID or CANCELED SO cannot pull SHIPPED back", () => {
    expect(local({ id: "a", jubelioSoId: 192297, status: "SHIPPED" })).toEqual([]);
    expect(local({ id: "a", jubelioSoId: 86, status: "CONFIRMED" })).toEqual([]);
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
