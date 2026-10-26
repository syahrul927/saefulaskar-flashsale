import { beforeEach, describe, expect, it, vi } from "vitest";

import { JubelioError } from "@/lib/jubelio";

// Route collaborators are seams. `@/lib/jubelio` and `@/server/jubelio-catalog`
// stay partially real (importOriginal spread, the `jubelio-products-route.test.ts`
// idiom) so `isJubelioAuthError`/`JubelioError` identity matches the route's
// `instanceof` checks while `getStockMap` — the v2 source this Task switches
// POST onto — is the mockable boundary. `@/server/db` is a thenable-builder
// mock (`session-query.test.ts` shape): selects hand back the per-table
// fixtures, inserts echo their values back through `.returning()` and are
// recorded so the tests can pin which rows actually persisted.
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
  existingRows: [] as {
    itemId: number;
    jubelioStock: number;
    sessionQuota: number;
  }[],
  inserted: [] as Record<string, unknown>[],
  echoSeq: 0,
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
              return Promise.resolve([
                { id: `p-${++state.echoSeq}`, ...v },
              ]);
            },
          }),
        }),
      }),
    },
  };
});

import { POST } from "@/app/api/sessions/[id]/products/route";
import { getSession } from "@/server/better-auth/server";
import { getStockMap } from "@/server/jubelio-catalog";
import { resolveImportRow } from "@/server/jubelio-import";

describe("resolveImportRow", () => {
  it("v2 number → stock + floored quota", () => {
    expect(resolveImportRow({ available: 5000, image: null }, undefined)).toEqual(
      { jubelioStock: 5000, sessionQuota: 20 },
    );
  });
  it("negative available → raw negative stock, quota floors at 0", () => {
    expect(resolveImportRow({ available: -14, image: null }, undefined)).toEqual(
      { jubelioStock: -14, sessionQuota: 0 },
    );
  });
  it("Review Focus 2 — no number, existing row keeps BOTH previous stock and quota", () => {
    expect(resolveImportRow(undefined, { jubelioStock: 37, sessionQuota: 5 })).toEqual(
      { jubelioStock: 37, sessionQuota: 5 },
    );
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
    state.echoSeq = 0;
    vi.mocked(getSession).mockReset();
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getStockMap).mockReset();
    vi.mocked(getStockMap).mockResolvedValue(new Map());
  });

  it("happy path: every numbered row inserts, quota floors at 20, skipped is []", async () => {
    vi.mocked(getStockMap).mockResolvedValue(
      new Map([
        [1, { available: 5000, image: null }],
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

  it("no-number row that already exists keeps previous stock and quota (update path, missing ≠ empty)", async () => {
    vi.mocked(getStockMap).mockResolvedValue(new Map());
    state.existingRows = [{ itemId: 2, jubelioStock: 37, sessionQuota: 5 }];
    const res = await POST(postRequest([item(2)]), params);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.skipped).toEqual([]);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      itemId: 2,
      jubelioStock: 37,
      sessionQuota: 5,
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
});
