import { beforeEach, describe, expect, it, vi } from "vitest";

import { JubelioError } from "@/lib/jubelio";

// Route collaborators are seams. `@/lib/jubelio` and `@/server/jubelio-catalog`
// stay partially real (importOriginal spread, the `jubelio-products-route.test.ts`
// idiom) so `isJubelioAuthError`/`JubelioError` identity matches the route's
// `instanceof` checks while `getStockMap` — the v2 source this Task switches
// POST onto — is the mockable boundary. `@/server/db` is a thenable-builder
// mock (`session-query.test.ts` shape): selects hand back the per-table
// fixtures, inserts echo their values back through `.returning()` and are
// recorded so the tests can pin which rows actually persisted (`inserted`),
// while `update` records its patch the same way (`updated`) — Task 4's
// `"unhide_only"` branch writes through `db.update`, so the mock follows.
vi.mock("@/server/better-auth/server", () => ({ getSession: vi.fn() }));
vi.mock("@/server/jubelio-catalog", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getStockMap: vi.fn() };
});
vi.mock("@/lib/jubelio", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createJubelioClient: vi.fn(() => ({})) };
});

const state = vi.hoisted(() => ({
  sessionRows: [] as { id: string; status: string }[],
  // Loose on purpose: POST's existing-row select reads four columns, but the
  // list GET's row select gets WHOLE rows (`hidden` included), so the fixtures
  // are shaped per-test, not per-column-list.
  existingRows: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  // The `"unhide_only"` branch (Task 4) writes through `db.update`, so the
  // builder mock records those patches the same way it records inserts.
  updated: [] as Record<string, unknown>[],
  echoSeq: 0,
  insertFails: false,
}));

vi.mock("@/server/db", async () => {
  const { flashSessions, sessionProducts } = await import(
    "@/server/db/schema"
  );
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            Promise.resolve(
              table === flashSessions
                ? state.sessionRows
                : table === sessionProducts
                  ? state.existingRows
                  : [],
            ),
        }),
      }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => ({
          onConflictDoUpdate: () => ({
            returning: () => {
              if (table === sessionProducts) state.inserted.push(v);
              // `insertFails` models a genuine db outage — the only thing the
              // POST's second `catch` can now be reached by.
              if (state.insertFails) {
                return Promise.reject(new Error("db connection lost"));
              }
              return Promise.resolve([
                { id: `p-${++state.echoSeq}`, ...v },
              ]);
            },
          }),
        }),
      }),
      // The `"unhide_only"` write (Task 4): `.set(patch).where(...).returning()`.
      // The builder mock cannot read the `where` clause, so it echoes every
      // fixture row back with the patch applied — accurate for these cases,
      // because each fixture row is one of the posted `itemId`s.
      update: (table: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({
            returning: () => {
              if (table === sessionProducts) state.updated.push(patch);
              if (state.insertFails) {
                return Promise.reject(new Error("db connection lost"));
              }
              return Promise.resolve(
                state.existingRows.map((row) => ({
                  id: `u-${++state.echoSeq}`,
                  ...row,
                  ...patch,
                })),
              );
            },
          }),
        }),
      }),
    },
  };
});

import { GET, POST } from "@/app/api/sessions/[id]/products/route";
import { getSession } from "@/server/better-auth/server";
import { getStockMap } from "@/server/jubelio-catalog";
import { resolveImportRow } from "@/server/jubelio-import";

describe("resolveImportRow", () => {
  it("v2 number → stock + floored quota + thumbnail URL", () => {
    expect(
      resolveImportRow(
        { available: 5000, image: "https://cdn/1.jpg" },
        undefined,
      ),
    ).toEqual({
      jubelioStock: 5000,
      sessionQuota: 20,
      imageUrl: "https://cdn/1.jpg",
    });
  });
  it("negative available → raw negative stock, quota floors at 0", () => {
    expect(resolveImportRow({ available: -14, image: null }, undefined)).toEqual(
      { jubelioStock: -14, sessionQuota: 0, imageUrl: null },
    );
  });
  it("Review Focus 2 — no number, existing row keeps ALL previous values (stock, quota, image)", () => {
    expect(
      resolveImportRow(undefined, {
        jubelioStock: 37,
        sessionQuota: 5,
        imageUrl: "https://cdn/old.jpg",
      }),
    ).toEqual({
      jubelioStock: 37,
      sessionQuota: 5,
      imageUrl: "https://cdn/old.jpg",
    });
  });
  it("entry with no thumbnail, existing row keeps the stored photo — missing ≠ empty", () => {
    expect(
      resolveImportRow(
        { available: 40, image: null },
        { jubelioStock: 1, sessionQuota: 1, imageUrl: "https://cdn/old.jpg" },
      ),
    ).toEqual({
      jubelioStock: 40,
      sessionQuota: 20,
      imageUrl: "https://cdn/old.jpg",
    });
  });
  it("entry with a thumbnail refreshes the stored photo", () => {
    expect(
      resolveImportRow(
        { available: 40, image: "https://cdn/new.jpg" },
        { jubelioStock: 1, sessionQuota: 1, imageUrl: "https://cdn/old.jpg" },
      ),
    ).toEqual({
      jubelioStock: 40,
      sessionQuota: 20,
      imageUrl: "https://cdn/new.jpg",
    });
  });
  it("no number, no existing → null (skip, partner ruling)", () => {
    expect(resolveImportRow(undefined, undefined)).toBeNull();
  });
});

const owner = { user: { role: "OWNER", token: "tok" } };
const params = { params: Promise.resolve({ id: "s-1" }) };

function postRequest(items: unknown[]) {
  return new Request("http://localhost/api/sessions/s-1/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(items),
  });
}

const item = (itemId: number) => ({
  itemId,
  skuCode: `SKU-${itemId}`,
  itemGroupName: `Group ${itemId}`,
  originalPrice: 100000,
});

describe("POST /api/sessions/[id]/products", () => {
  beforeEach(() => {
    state.sessionRows = [{ id: "s-1", status: "SCHEDULED" }];
    state.existingRows = [];
    state.inserted = [];
    state.updated = [];
    state.echoSeq = 0;
    state.insertFails = false;
    vi.mocked(getSession).mockReset();
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getStockMap).mockReset();
    vi.mocked(getStockMap).mockResolvedValue(new Map());
  });

  it("happy path: every numbered row inserts, quota floors at 20, skipped is []", async () => {
    vi.mocked(getStockMap).mockResolvedValue(
      new Map([
        [1, { available: 5000, image: "https://cdn/1.jpg" }],
        [2, { available: 8, image: null }],
      ]),
    );
    const res = await POST(postRequest([item(1), item(2)]), params);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    // ADDITIVE contract: { ok, products } stays, `skipped: []` on the happy path.
    expect(body.ok).toBe(true);
    expect(body.skipped).toEqual([]);
    expect(state.inserted).toHaveLength(2);
    expect(
      state.inserted.map((v) => [v.itemId, v.jubelioStock, v.sessionQuota]),
    ).toEqual([
      [1, 5000, 20],
      [2, 8, 8],
    ]);
    // The v2 thumbnail persists right beside the stock number — same map,
    // one truth per pipeline, no extra fetch.
    expect(state.inserted.map((v) => [v.itemId, v.imageUrl])).toEqual([
      [1, "https://cdn/1.jpg"],
      [2, null],
    ]);
    // The unchanged default fields ride along with every row.
    expect(state.inserted[0]).toMatchObject({
      sessionId: "s-1",
      flashPrice: 100000,
      minOrder: 1,
      claimed: 0,
      category: "",
    });
  });

  it("Review Focus 3 — v2 down: 201, ok:true, products empty, every new item skipped, zero inserts", async () => {
    // The degradation stays silent-free: an admin whose import "succeeded with
    // 0 products" must be diagnosable from the server log (repo convention
    // `console.error("<context>: <what failed>", e)`).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getStockMap).mockRejectedValue(
      new JubelioError(500, "UPSTREAM", "inventory v2 down"),
    );
    const res = await POST(postRequest([item(1), item(2)]), params);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      ok: true,
      products: [],
      skipped: [
        { itemId: 1, skuCode: "SKU-1", itemGroupName: "Group 1" },
        { itemId: 2, skuCode: "SKU-2", itemGroupName: "Group 2" },
      ],
    });
    // Skipped rows NEVER persist — no insert reached drizzle at all.
    expect(state.inserted).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "session-products: getStockMap failed, skipping rows without a number",
      expect.any(JubelioError),
    );
    errorSpy.mockRestore();
  });

  it("db failure: 502 unchanged and the dropped error is logged", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getStockMap).mockResolvedValue(
      new Map([[1, { available: 5000, image: null }]]),
    );
    state.insertFails = true;
    const res = await POST(postRequest([item(1)]), params);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Gagal memuat stok, coba lagi",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "session-products: db write failed",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it("skips ONLY the no-number rows; numbered rows insert (negatives stored raw, quota floors at 0)", async () => {
    vi.mocked(getStockMap).mockResolvedValue(
      new Map([
        [1, { available: 5000, image: null }],
        [3, { available: -14, image: null }],
      ]),
    );
    const res = await POST(postRequest([item(1), item(2), item(3)]), params);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.skipped).toEqual([
      { itemId: 2, skuCode: "SKU-2", itemGroupName: "Group 2" },
    ]);
    expect((body.products as unknown[]).length).toBe(2);
    expect(
      state.inserted.map((v) => [v.itemId, v.jubelioStock, v.sessionQuota]),
    ).toEqual([
      [1, 5000, 20],
      [3, -14, 0],
    ]);
  });

  it("no-number row that already exists keeps previous stock, quota and photo (update path, missing ≠ empty)", async () => {
    vi.mocked(getStockMap).mockResolvedValue(new Map());
    state.existingRows = [
      {
        itemId: 2,
        jubelioStock: 37,
        sessionQuota: 5,
        imageUrl: "https://cdn/old.jpg",
      },
    ];
    const res = await POST(postRequest([item(2)]), params);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.skipped).toEqual([]);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      itemId: 2,
      jubelioStock: 37,
      sessionQuota: 5,
      imageUrl: "https://cdn/old.jpg",
    });
  });

  it("401 SESSION_EXPIRED when getStockMap rejects with an auth error", async () => {
    vi.mocked(getStockMap).mockRejectedValue(
      new JubelioError(401, "OLD_TOKEN", "unauthorized"),
    );
    const res = await POST(postRequest([item(1)]), params);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "SESSION_EXPIRED" });
    expect(state.inserted).toEqual([]);
  });

  // Task 4's edit window. The decisions themselves are `session-products-edit`
  // territory (pure, fully covered there); these cases pin only that the route
  // ASKS them in the right order — because the order is the safety property:
  // `canEditProducts` first (an ENDED session falls through `reAddDecision` to
  // "upsert"), then the per-item split that keeps a live session's config
  // unwritten.
  describe("edit window (spec §5.9 relaxed)", () => {
    const existing = {
      itemId: 1,
      jubelioStock: 37,
      sessionQuota: 5,
      imageUrl: "https://cdn/old.jpg",
    };

    it("ENDED: Bahasa 409, no v2 fetch, no write of any kind", async () => {
      state.sessionRows = [{ id: "s-1", status: "ENDED" }];
      state.existingRows = [existing];
      const res = await POST(postRequest([item(1), item(2)]), params);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: "Sesi yang sudah berakhir tidak bisa diubah.",
      });
      expect(getStockMap).not.toHaveBeenCalled();
      expect(state.inserted).toEqual([]);
      expect(state.updated).toEqual([]);
    });

    it("ACTIVE re-add of an existing row: flag write only, row still reported", async () => {
      state.sessionRows = [{ id: "s-1", status: "ACTIVE" }];
      state.existingRows = [existing];
      // A number IS available for this item — and must still be ignored: the
      // upsert it would feed resets price/minOrder/category and re-derives the
      // quota, i.e. rewrites the running sale (design Ruling 1).
      vi.mocked(getStockMap).mockResolvedValue(
        new Map([[1, { available: 5000, image: "https://cdn/new.jpg" }]]),
      );
      const res = await POST(postRequest([item(1)]), params);
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      // Not skipped (nothing blocked it) and present in `products` (`hidden`
      // cleared) so the picker can merge the row back in.
      expect(body.skipped).toEqual([]);
      expect(body.products).toEqual([
        {
          id: "u-1",
          ...existing,
          hidden: false,
        },
      ]);
      expect(state.inserted).toEqual([]);
      expect(state.updated).toEqual([{ hidden: false }]);
      expect(getStockMap).not.toHaveBeenCalled();
    });

    it("PAUSED batch: new item imports normally, rostered item just unhides", async () => {
      state.sessionRows = [{ id: "s-1", status: "PAUSED" }];
      state.existingRows = [existing];
      vi.mocked(getStockMap).mockResolvedValue(
        new Map([[2, { available: 40, image: "https://cdn/2.jpg" }]]),
      );
      const res = await POST(postRequest([item(1), item(2)]), params);
      expect(res.status).toBe(201);
      // The batch now has an importable row, so the cached v2 fetch runs.
      expect(getStockMap).toHaveBeenCalled();
      expect(state.inserted).toEqual([
        expect.objectContaining({
          itemId: 2,
          jubelioStock: 40,
          sessionQuota: 20,
          imageUrl: "https://cdn/2.jpg",
        }),
      ]);
      expect(state.updated).toEqual([{ hidden: false }]);
      const body = (await res.json()) as { products: { itemId: number }[] };
      expect(body.products.map((p) => p.itemId)).toEqual([2, 1]);
    });

    it("v2 down in a live session: the unhide still lands, nothing skipped", async () => {
      state.sessionRows = [{ id: "s-1", status: "ACTIVE" }];
      state.existingRows = [existing];
      vi.mocked(getStockMap).mockRejectedValue(
        new JubelioError(500, "UPSTREAM", "inventory v2 down"),
      );
      const res = await POST(postRequest([item(1)]), params);
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ ok: true, skipped: [] });
      expect(state.updated).toEqual([{ hidden: false }]);
    });
  });
});

// Task 4 Step 4 (review Minor-3): the list GET is the payload Task 7's roster
// consumes and `hidden` is the exact field it reads — until now nothing even
// imported this handler. One `toEqual` on the mapped rows pins the whole shape.
describe("GET /api/sessions/[id]/products", () => {
  // The list GET selects WHOLE rows (unlike POST's four-column re-add read),
  // so these fixtures are whole rows too; only the two `hidden` states and
  // the map hit/miss vary.
  const rosterRow = (itemId: number, hidden: boolean) => ({
    id: 100 + itemId,
    sessionId: "s-1",
    itemId,
    skuCode: `SKU-${itemId}`,
    itemGroupName: `Group ${itemId}`,
    originalPrice: 100000,
    sessionQuota: 10,
    jubelioStock: 40,
    imageUrl: null,
    claimed: 2,
    minOrder: 1,
    flashPrice: 90000,
    category: "",
    hidden,
  });

  beforeEach(() => {
    state.sessionRows = [{ id: "s-1", status: "ACTIVE" }];
    state.existingRows = [rosterRow(1, false), rosterRow(2, true)];
    state.inserted = [];
    state.updated = [];
    state.echoSeq = 0;
    state.insertFails = false;
    vi.mocked(getSession).mockReset();
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getStockMap).mockReset();
    vi.mocked(getStockMap).mockResolvedValue(
      new Map([[1, { available: 40, image: null }]]),
    );
  });

  it("maps every row with `hidden` intact and `availableStock` from the map (miss → null)", async () => {
    const res = await GET(
      new Request("http://localhost/api/sessions/s-1/products"),
      params,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // `hidden` present for BOTH states — this is the ADMIN list, it must see
    // what the storefront no longer does. `jubelioStock`/`imageUrl` are
    // deliberately NOT part of the mapped row; the v2 join gives item 1 its
    // live number and item 2 `null` (unknown is never shown as `0`).
    expect(body).toEqual({
      ok: true,
      products: [
        {
          id: 101,
          itemId: 1,
          skuCode: "SKU-1",
          itemGroupName: "Group 1",
          originalPrice: 100000,
          sessionQuota: 10,
          claimed: 2,
          minOrder: 1,
          flashPrice: 90000,
          category: "",
          hidden: false,
          availableStock: 40,
        },
        {
          id: 102,
          itemId: 2,
          skuCode: "SKU-2",
          itemGroupName: "Group 2",
          originalPrice: 100000,
          sessionQuota: 10,
          claimed: 2,
          minOrder: 1,
          flashPrice: 90000,
          category: "",
          hidden: true,
          availableStock: null,
        },
      ],
    });
  });
});
