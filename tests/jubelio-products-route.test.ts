import { beforeEach, describe, expect, it, vi } from "vitest";

import { JubelioError, toPickerRows } from "@/lib/jubelio";

// The route's collaborators are seams: this file pins the ROUTE's error
// contract (spec constraint "route error propagation", review focus #1),
// while `@/lib/jubelio` stays real so `JubelioError` identity matches the
// route's `instanceof` checks.
vi.mock("@/server/better-auth/server", () => ({ getSession: vi.fn() }));
vi.mock("@/server/jubelio-catalog", () => ({ getCatalogRows: vi.fn() }));
vi.mock("@/lib/jubelio", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createJubelioClient: vi.fn(() => ({})) };
});

import { GET } from "@/app/api/jubelio/products/route";
import { getSession } from "@/server/better-auth/server";
import { getCatalogRows } from "@/server/jubelio-catalog";

/**
 * Masters item copied from the live probe 2026-10-26 (spec "Verified field
 * mapping"): `variants` is a JSON-ENCODED STRING whose entries carry
 * `item_id`/`item_code`; there is no top-level `item_id`/`sku_code`/`stock`.
 */
function mastersItem(
  overrides: Partial<{
    item_name: unknown;
    sell_price: unknown;
    variants: unknown;
  }> = {},
) {
  return {
    item_group_id: 1868,
    item_name: "Kuangyu Dream - SLA",
    sell_price: "3700000.0000",
    variants: JSON.stringify([
      { item_id: 2685, item_code: "[SLA]UA000044N", is_bundle: true, sell_price: 3700000 },
    ]),
    ...overrides,
  };
}

describe("toPickerRows", () => {
  it("maps the {data:[…]} envelope through variants[0] to picker rows", () => {
    expect(toPickerRows({ data: [mastersItem()] })).toEqual([
      {
        itemId: 2685,
        skuCode: "[SLA]UA000044N",
        itemGroupName: "Kuangyu Dream - SLA",
        price: 3700000,
        minOrder: 1,
        stock: null,
        image: null,
      },
    ]);
  });

  it("tolerates a bare array payload (no envelope)", () => {
    expect(toPickerRows([mastersItem()])).toHaveLength(1);
  });

  it("coerces the string sell_price to a number, falling back to the variant price", () => {
    const noTopPrice = mastersItem({ sell_price: undefined });
    expect(toPickerRows({ data: [noTopPrice] })[0]?.price).toBe(3700000);
    const junkPrice = mastersItem({ sell_price: "abc" });
    expect(toPickerRows({ data: [junkPrice] })[0]?.price).toBe(3700000);
  });

  it("accepts variants already parsed to an array", () => {
    const item = mastersItem({
      variants: [{ item_id: 7, item_code: "X-7", sell_price: 1000 }],
    });
    expect(toPickerRows({ data: [item] })[0]).toMatchObject({
      itemId: 7,
      skuCode: "X-7",
    });
  });

  it("yields the fallback row for empty, absent or garbage variants — never throws", () => {
    const fallback = {
      itemId: 0,
      skuCode: "",
      itemGroupName: "Kuangyu Dream - SLA",
      price: 3700000,
      minOrder: 1,
      stock: null,
      image: null,
    };
    expect(toPickerRows({ data: [mastersItem({ variants: "[]" })] })[0]).toEqual(
      fallback,
    );
    expect(toPickerRows({ data: [mastersItem({ variants: undefined })] })[0]).toEqual(
      fallback,
    );
    expect(toPickerRows({ data: [mastersItem({ variants: "{not json" })] })[0]).toEqual(
      fallback,
    );
  });

  it("keeps minOrder at 1 (masters carries no min) and stock null for every row", () => {
    const rows = toPickerRows({ data: [mastersItem(), mastersItem()] });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.minOrder).toBe(1);
      expect(row.stock).toBeNull();
    }
  });

  it("emits one row per variant for multi-variant items (final review I-4)", () => {
    // Live probe 2026-10-26: 328 of 573 masters items carry >1 variant
    // (1752 SKUs total). variants[0]-only mapping hid two thirds of the
    // catalog; each variant has its own item_id/item_code/item_name/price.
    const item = mastersItem({
      variants: JSON.stringify([
        {
          item_id: 11,
          item_code: "VAR-RED",
          item_name: "Kuangyu Dream - Red",
          sell_price: 3700000,
        },
        {
          item_id: 12,
          item_code: "VAR-BLU",
          item_name: "Kuangyu Dream - Blue",
          sell_price: 3900000,
        },
      ]),
    });
    const rows = toPickerRows({ data: [item] });
    expect(rows.map((r) => r.itemId)).toEqual([11, 12]);
    expect(rows.map((r) => r.skuCode)).toEqual(["VAR-RED", "VAR-BLU"]);
    expect(rows.map((r) => r.itemGroupName)).toEqual([
      "Kuangyu Dream - Red",
      "Kuangyu Dream - Blue",
    ]);
    // Per-variant price wins: one item-level default must not flatten
    // different SKU prices into one number.
    expect(rows.map((r) => r.price)).toEqual([3700000, 3900000]);
  });

  it("falls back to the item name and item price when a variant omits them", () => {
    const item = mastersItem({
      variants: JSON.stringify([{ item_id: 21, item_code: "V-21" }]),
    });
    const row = toPickerRows({ data: [item] })[0];
    expect(row?.itemGroupName).toBe("Kuangyu Dream - SLA");
    expect(row?.price).toBe(3700000);
  });

  it("returns [] for null, junk envelope, or non-array data", () => {
    expect(toPickerRows(null)).toEqual([]);
    expect(toPickerRows({})).toEqual([]);
    expect(toPickerRows({ data: "nope" })).toEqual([]);
  });
});

describe("GET /api/jubelio/products (route error contract)", () => {
  const owner = { user: { role: "OWNER", token: "tok" } };

  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    vi.mocked(getCatalogRows).mockReset();
  });

  it("401 Unauthorized without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("403 for a non-OWNER role", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { role: "STAFF", token: "tok" },
    } as never);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("200 with the cached catalog rows", async () => {
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getCatalogRows).mockResolvedValue([{ itemId: 1 }] as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ itemId: 1 }]);
  });

  it("401 SESSION_EXPIRED on an expired token (the client's sign-out contract)", async () => {
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getCatalogRows).mockRejectedValue(
      new JubelioError(401, "OLD_TOKEN", "unauthorized"),
    );
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "SESSION_EXPIRED" });
  });

  it("forwards the real upstream status and message — no blanket 502", async () => {
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getCatalogRows).mockRejectedValue(
      new JubelioError(400, "BAD_QUERY", "param not allowed"),
    );
    const res = await GET();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "param not allowed" });
  });

  it("502 with friendly copy for an unexpected error, never a crash", async () => {
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getCatalogRows).mockRejectedValue(new Error("socket hangup"));
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Gagal memuat produk, coba lagi",
    });
  });
});
