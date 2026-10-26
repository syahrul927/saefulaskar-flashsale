import { beforeEach, describe, expect, it, vi } from "vitest";

import { JubelioError, toPickerRows } from "@/lib/jubelio";

// The route's collaborators are seams: this file pins the ROUTE's error
// contract (spec constraint "route error propagation", review focus #1),
// while `@/lib/jubelio` stays real so `JubelioError` identity matches the
// route's `instanceof` checks. `mergeStockIntoRows` also stays real — the
// v2-join assertions below pin the route's COMPOSITION (fetch, settle,
// merge), which a mocked merge could not show.
vi.mock("@/server/better-auth/server", () => ({ getSession: vi.fn() }));
vi.mock("@/server/jubelio-catalog", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getCatalogRows: vi.fn(),
    getStockMap: vi.fn(),
  };
});
vi.mock("@/lib/jubelio", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createJubelioClient: vi.fn(() => ({})) };
});

import { GET } from "@/app/api/jubelio/products/route";
import { getSession } from "@/server/better-auth/server";
import { getCatalogRows, getStockMap } from "@/server/jubelio-catalog";

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

  /** A masters row as `getCatalogRows` returns it: stock/image start null. */
  const mastersRow = (overrides: Record<string, unknown> = {}) => ({
    itemId: 1,
    skuCode: "SKU-1",
    itemGroupName: "Kuangyu Dream - SLA",
    price: 3700000,
    minOrder: 1,
    stock: null,
    image: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    vi.mocked(getCatalogRows).mockReset();
    vi.mocked(getStockMap).mockReset();
    // Default: v2 is healthy but has nothing to join — tests that care
    // about joined values override this.
    vi.mocked(getStockMap).mockResolvedValue(new Map());
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
    vi.mocked(getCatalogRows).mockResolvedValue([mastersRow()] as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([mastersRow()]);
  });

  it("200 with v2-joined stock + image on every row", async () => {
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getCatalogRows).mockResolvedValue([
      mastersRow(),
      mastersRow({ itemId: 2, skuCode: "SKU-2" }),
    ] as never);
    vi.mocked(getStockMap).mockResolvedValue(
      new Map([[1, { available: 12, image: "u" }]]),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body[0]).toMatchObject({ stock: 12, image: "u" });
    // A SKU absent from the v2 payload keeps the null pair — never 0.
    expect(body[1]).toMatchObject({ stock: null, image: null });
    // One client instance feeds both catalog reads (shared fetcher budget).
    expect(vi.mocked(getStockMap).mock.calls[0]?.[0]).toBe(
      vi.mocked(getCatalogRows).mock.calls[0]?.[0],
    );
  });

  it("v2-only failure still 200: rows keep null stock/image (plate honesty)", async () => {
    // The swallow is intentional, but it must not be silent — a null plate is
    // indistinguishable from "the catalog genuinely has no stock" unless the
    // cause is logged (repo convention, cf. `contacts: … failed`, e`).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getCatalogRows).mockResolvedValue([mastersRow()] as never);
    vi.mocked(getStockMap).mockRejectedValue(
      new JubelioError(500, "UPSTREAM", "inventory v2 down"),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body[0]).toMatchObject({ stock: null, image: null });
    expect(errorSpy).toHaveBeenCalledWith(
      "jubelio-products: getStockMap failed, serving null stock/image",
      expect.any(JubelioError),
    );
    errorSpy.mockRestore();
  });

  it("masters failure keeps the error contract (401 SESSION_EXPIRED pin still authoritative)", async () => {
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getStockMap).mockResolvedValue(
      new Map([[1, { available: 12, image: "u" }]]),
    );
    vi.mocked(getCatalogRows).mockRejectedValue(
      new JubelioError(401, "OLD_TOKEN", "unauthorized"),
    );
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "SESSION_EXPIRED" });
  });

  it("masters failure surfaces without waiting on the v2 read (no shared settle barrier)", async () => {
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getCatalogRows).mockRejectedValue(
      new JubelioError(401, "OLD_TOKEN", "unauthorized"),
    );
    // A stalled/hanging /inventory/v2/ must not delay the 401: a
    // Promise.allSettled barrier would sit here until the slow feed settles.
    let stockSettled = false;
    vi.mocked(getStockMap).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            stockSettled = true;
            resolve(new Map());
          }, 20);
        }),
    );
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "SESSION_EXPIRED" });
    expect(stockSettled).toBe(false);
  });

  it("v2 rejecting with an AUTH-shaped 401 still serves 200 null plate — masters owns the auth contract", async () => {
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getCatalogRows).mockResolvedValue([mastersRow()] as never);
    // The one input class where refactoring back to a Promise.all that
    // rethrows any rejection would silently turn a healthy catalog into 401.
    vi.mocked(getStockMap).mockRejectedValue(
      new JubelioError(401, "OLD_TOKEN", "unauthorized"),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body[0]).toMatchObject({ stock: null, image: null });
  });

  it("both feeds reject: the masters contract still wins and the v2 rejection stays handled", async () => {
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getCatalogRows).mockRejectedValue(new Error("socket hangup"));
    vi.mocked(getStockMap).mockRejectedValue(
      new JubelioError(500, "UPSTREAM", "inventory v2 down"),
    );
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Gagal memuat produk, coba lagi",
    });
    // (If the v2 rejection went unhandled, the vitest run itself would
    // flag an unhandledRejection for this file.)
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
