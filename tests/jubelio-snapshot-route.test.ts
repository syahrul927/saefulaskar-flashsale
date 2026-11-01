import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; role: string } },
  inserts: [] as Record<string, unknown>[],
  previous: null as null | { raw: unknown; capturedAt: Date },
  fetch: null as null | (() => Promise<unknown>),
  fetchError: null as null | Error,
  fetchedIds: [] as number[],
}));

vi.mock("@/server/better-auth/server", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/server/jubelio-token", () => ({
  withSystemClient: vi.fn(async (fn: (c: { getSalesOrder: (id: number) => Promise<unknown> }) => Promise<unknown>) =>
    fn({
      getSalesOrder: async (id: number) => {
        if (state.fetchError) throw state.fetchError;
        state.fetchedIds.push(id);
        return state.fetch ? await state.fetch() : {};
      },
    }),
  ),
}));

vi.mock("@/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => (state.previous ? [state.previous] : []),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          state.inserts.push(value);
          return [{ id: "snap-1", ...value }];
        },
      }),
    }),
  },
}));

// `@/lib/jubelio` is NOT mocked: the route branches on `JubelioError instanceof`,
// and a stand-in class would send every real upstream failure down the generic
// 502 path instead of surfacing Jubelio's own message.
import { JubelioError } from "@/lib/jubelio";
import { POST } from "@/app/api/admin/jubelio/snapshot/route";

// Live-shaped reads (probe 2026-10-29 vocabulary). PAID before the faktur,
// COMPLETED + `channel_status: "remitted"` + an invoice number after it.
const BEFORE = {
  items: [{ item_id: 2895, qty_in_base: 20 }],
  salesorder_id: 192297,
  salesorder_no: "SO-000192297",
  internal_status: "PAID",
  channel_status: "Paid",
  wms_status: "PAID",
  tracking_number: "",
  shipper: "",
  updated_at: "2026-10-29T04:00:00.000Z",
};

const AFTER = {
  ...BEFORE,
  internal_status: "COMPLETED",
  channel_status: "remitted",
  wms_status: "COMPLETED",
  invoice_id: 44120,
  invoice_no: "FV-00044120",
  updated_at: "2026-10-31T02:15:00.000Z",
};

function post(body: unknown) {
  return POST(
    new Request("http://test/api/admin/jubelio/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.session = { user: { id: "owner-1", email: "owner@test.com", role: "OWNER" } };
  state.inserts = [];
  state.previous = null;
  state.fetch = async () => AFTER;
  state.fetchError = null;
  state.fetchedIds = [];
});

describe("POST /api/admin/jubelio/snapshot", () => {
  it("401s without a session and 403s for a non-owner", async () => {
    state.session = null;
    expect((await post({ salesorderId: 192297 })).status).toBe(401);
    state.session = { user: { id: "c-1", email: "c@test.com", role: "CUSTOMER" } };
    expect((await post({ salesorderId: 192297 })).status).toBe(403);
    expect(state.inserts).toHaveLength(0);
  });

  it("400s on a body without a usable SO id", async () => {
    expect((await post({ salesorderId: 0 })).status).toBe(400);
    expect((await post({ salesorderId: "abc" })).status).toBe(400);
    expect((await post(null)).status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });

  it("fetches by id, stores the raw read and the extracted status triple", async () => {
    const res = await post({ salesorderId: 192297, label: " setelah faktur " });
    expect(res.status).toBe(200);
    expect(state.fetchedIds).toEqual([192297]);
    const value = state.inserts[0];
    expect(value?.raw).toEqual(AFTER);
    expect(value?.internalStatus).toBe("COMPLETED");
    expect(value?.channelStatus).toBe("remitted");
    expect(value?.wmsStatus).toBe("COMPLETED");
    expect(value?.invoiceNo).toBe("FV-00044120");
    // The label is the operator's own marker for which side of the faktur a
    // capture is on — trimmed, not padded.
    expect(value?.label).toBe("setelah faktur");
    expect(value?.capturedBy).toBe("owner@test.com");
  });

  it("reports no diff on the first read of an SO, and says so", async () => {
    const body = await (await post({ salesorderId: 192297 })).json();
    expect(body.diff).toEqual([]);
    expect(body.previousCapturedAt).toBeNull();
  });

  it("diffs against the previous read — this is the faktur question, answered", async () => {
    state.previous = { raw: BEFORE, capturedAt: new Date("2026-10-29T04:00:00.000Z") };
    const body = await (await post({ salesorderId: 192297 })).json();
    const byKey = Object.fromEntries(body.diff.map((d: { key: string }) => [d.key, d]));
    expect(Object.keys(byKey).sort()).toEqual([
      "channel_status",
      "internal_status",
      "invoice_id",
      "invoice_no",
      "updated_at",
      "wms_status",
    ]);
    expect(byKey.internal_status.kind).toBe("changed");
    expect(byKey.invoice_no.kind).toBe("added");
    expect(body.previousCapturedAt).toBe("2026-10-29T04:00:00.000Z");
  });

  it("502s and stores nothing when Jubelio refuses", async () => {
    state.fetchError = new JubelioError(404, "not-found", "Sales order tidak ditemukan");
    const res = await post({ salesorderId: 999 });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Sales order tidak ditemukan");
    expect(state.inserts).toHaveLength(0);
  });

  it("502s on an unexpected upstream failure too", async () => {
    state.fetchError = new Error("socket hang up");
    expect((await post({ salesorderId: 999 })).status).toBe(502);
    expect(state.inserts).toHaveLength(0);
  });
});
