import { beforeEach, describe, expect, it, vi } from "vitest";

import { JubelioError } from "@/lib/jubelio";

/**
 * Task 4's PUT: the live-session edit window plus the quota floor and the
 * `jubelio_stock` refresh. The decisions themselves are pure and covered in
 * `session-products-edit.test.ts`; what is covered HERE is that the route ASKS
 * them in the right place — the floor rejects before anything is written, a
 * v2 miss keeps the stored snapshot instead of zeroing it, an expired token
 * still 401s a quota write, and a hide/show write never waits on the ERP at
 * all. That last one is the point of the feature: a live session must stay
 * operable while Jubelio is down.
 *
 * The plan's ruling said route wiring would ride on the pure tests + gate, so
 * this file is an addition, not a requirement — kept because this repo already
 * tests route handlers directly (`cancel-route`, `confirm-route`,
 * `jubelio-products-route`, …) and because the sibling POST wiring tests caught
 * a real flatten bug on the first run. Collaborators are seams in the same
 * idiom: `@/server/db` is a thenable-builder mock that records the patch
 * `db.update().set(...)` was given, so the assertions pin exactly the columns
 * the route decided to write.
 */
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
  productRows: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
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
                  ? state.productRows
                  : [],
            ),
        }),
      }),
      // The builder mock cannot read the `where` clause, so it echoes the patch
      // back as the updated row — `.returning()` in real drizzle gives the whole
      // stored row, which only matters here for `product.id`.
      update: (table: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({
            returning: () => {
              if (table === sessionProducts) state.updated.push(patch);
              return Promise.resolve([
                { id: `p-${++state.echoSeq}`, ...patch },
              ]);
            },
          }),
        }),
      }),
    },
  };
});

import { PUT } from "@/app/api/sessions/[id]/products/[itemId]/route";
import { getSession } from "@/server/better-auth/server";
import { getStockMap } from "@/server/jubelio-catalog";

const owner = { user: { role: "OWNER", token: "tok" } };
const params = { params: Promise.resolve({ id: "s-1", itemId: "7" }) };

function putRequest(body: unknown) {
  return new Request("http://localhost/api/sessions/s-1/products/7", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function jsonOf(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("PUT /api/sessions/[id]/products/[itemId]", () => {
  beforeEach(() => {
    state.sessionRows = [{ id: "s-1", status: "ACTIVE" }];
    // 3 units already sold: the quota floor for every case below.
    state.productRows = [
      { id: "sp-1", itemId: 7, claimed: 3, sessionQuota: 5, jubelioStock: 9 },
    ];
    state.updated = [];
    state.echoSeq = 0;
    vi.mocked(getSession).mockReset();
    vi.mocked(getSession).mockResolvedValue(owner as never);
    vi.mocked(getStockMap).mockReset();
    vi.mocked(getStockMap).mockResolvedValue(
      new Map([[7, { available: 40, image: null }]]),
    );
  });

  it("ENDED → Bahasa 409, no stock read, no write", async () => {
    state.sessionRows = [{ id: "s-1", status: "ENDED" }];
    const res = await PUT(putRequest({ sessionQuota: 10 }), params);
    expect(res.status).toBe(409);
    expect(await jsonOf(res)).toEqual({
      error: "Sesi yang sudah berakhir tidak bisa diubah.",
    });
    expect(getStockMap).not.toHaveBeenCalled();
    expect(state.updated).toEqual([]);
  });

  it("SCHEDULED still edits (the window widened, it did not narrow)", async () => {
    state.sessionRows = [{ id: "s-1", status: "SCHEDULED" }];
    const res = await PUT(putRequest({ minOrder: 2 }), params);
    expect(res.status).toBe(200);
    expect(state.updated).toEqual([{ minOrder: 2 }]);
  });

  it("quota below what already sold → Bahasa 400 naming the floor, nothing written", async () => {
    const res = await PUT(putRequest({ sessionQuota: 2 }), params);
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({
      error: "Kuota minimal 3 (sudah terjual 3).",
    });
    expect(state.updated).toEqual([]);
  });

  it("quota ok + live stock → quota and snapshot written together, no warning", async () => {
    const res = await PUT(putRequest({ sessionQuota: 10 }), params);
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({
      ok: true,
      product: expect.objectContaining({
        sessionQuota: 10,
        jubelioStock: 40,
      }),
    });
    // Ruling 2 in one assertion: checkout validates the stored snapshot, so a
    // raised quota never leaves it behind at 9.
    expect(state.updated).toEqual([{ sessionQuota: 10, jubelioStock: 40 }]);
  });

  it("quota ok but the map misses → snapshot kept (missing ≠ empty) + UNKNOWN_STOCK", async () => {
    vi.mocked(getStockMap).mockResolvedValue(new Map());
    const res = await PUT(putRequest({ sessionQuota: 10 }), params);
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toMatchObject({
      ok: true,
      warning: "UNKNOWN_STOCK",
    });
    // `jubelioStock` absent from the patch = the stored 9 survives.
    expect(state.updated).toEqual([{ sessionQuota: 10 }]);
  });

  it("quota ok but v2 is down → same degrade, and the reason reaches the log", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.mocked(getStockMap).mockRejectedValue(
      new JubelioError(500, "UPSTREAM", "inventory v2 down"),
    );
    const res = await PUT(putRequest({ sessionQuota: 10 }), params);
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toMatchObject({ warning: "UNKNOWN_STOCK" });
    expect(state.updated).toEqual([{ sessionQuota: 10 }]);
    expect(errorSpy).toHaveBeenCalledWith(
      "session-product: getStockMap failed, quota saved with unknown stock",
      expect.any(JubelioError),
    );
    errorSpy.mockRestore();
  });

  it("expired token on a quota write → 401 SESSION_EXPIRED, quota NOT saved", async () => {
    vi.mocked(getStockMap).mockRejectedValue(
      new JubelioError(401, "OLD_TOKEN", "unauthorized"),
    );
    const res = await PUT(putRequest({ sessionQuota: 10 }), params);
    expect(res.status).toBe(401);
    expect(await jsonOf(res)).toEqual({ error: "SESSION_EXPIRED" });
    expect(state.updated).toEqual([]);
  });

  it("hide/show writes the flag alone and never touches the ERP", async () => {
    for (const hidden of [true, false]) {
      state.updated = [];
      const res = await PUT(putRequest({ hidden }), params);
      expect(res.status).toBe(200);
      expect(state.updated).toEqual([{ hidden }]);
      expect(await jsonOf(res)).not.toHaveProperty("warning");
    }
    expect(getStockMap).not.toHaveBeenCalled();
  });

  it("a quota write alongside other fields still refreshes the snapshot", async () => {
    const res = await PUT(
      putRequest({ sessionQuota: 10, flashPrice: 5000, category: null }),
      params,
    );
    expect(res.status).toBe(200);
    expect(state.updated).toEqual([
      { sessionQuota: 10, jubelioStock: 40, flashPrice: 5000, category: null },
    ]);
  });

  it("empty body → Bahasa 400 from the refine", async () => {
    const res = await PUT(putRequest({}), params);
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({
      error: "Body tidak valid: minimal satu field harus diisi.",
    });
  });

  it("missing session and missing product answer in Bahasa", async () => {
    state.sessionRows = [];
    const missingSession = await PUT(putRequest({ minOrder: 2 }), params);
    expect(missingSession.status).toBe(404);
    expect(await jsonOf(missingSession)).toEqual({
      error: "Sesi tidak ditemukan",
    });

    state.sessionRows = [{ id: "s-1", status: "ACTIVE" }];
    state.productRows = [];
    const missingProduct = await PUT(putRequest({ minOrder: 2 }), params);
    expect(missingProduct.status).toBe(404);
    expect(await jsonOf(missingProduct)).toEqual({
      error: "Produk tidak ditemukan di sesi ini",
    });
  });

  it("bad itemId → Bahasa 400", async () => {
    const res = await PUT(putRequest({ minOrder: 2 }), {
      params: Promise.resolve({ id: "s-1", itemId: "abc" }),
    });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "itemId tidak valid" });
  });

  it("non-OWNER is refused before any db read", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { role: "STAFF", token: "tok" },
    } as never);
    const res = await PUT(putRequest({ minOrder: 2 }), params);
    expect(res.status).toBe(403);
    expect(state.updated).toEqual([]);
  });
});
