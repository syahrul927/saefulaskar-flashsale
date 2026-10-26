import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JubelioError,
  type JubelioClient,
  type PickerRow,
  type StockEntry,
} from "@/lib/jubelio";
import {
  __resetCatalogCache,
  getCatalogRows,
  getStockMap,
  mergeStockIntoRows,
  type StockMap,
} from "@/server/jubelio-catalog";

/** One live-shaped masters item; mapper output length is what we assert. */
const MASTERS_OK = {
  data: [
    {
      item_group_id: 1,
      item_name: "Kuangyu Dream - SLA",
      sell_price: "3700000.0000",
      variants: JSON.stringify([{ item_id: 2685, item_code: "SKU-1" }]),
    },
  ],
};

/**
 * One live-shaped v2 inventory envelope: 2685 carries `available` + a CDN
 * `thumbnail`; 999 is the `0`-stock / no-thumbnail case that must stay `0`.
 */
const STOCK_V2_OK = {
  data: [
    {
      item_id: 2685,
      thumbnail: "https://cdn.example.com/2685.jpg",
      total_stocks: { on_hand: 12, available: 12 },
    },
    { item_id: 999, total_stocks: { on_hand: 0, available: 0 } },
  ],
};

function stubClient(
  listProducts = vi.fn().mockResolvedValue(MASTERS_OK),
  listStockV2 = vi.fn().mockResolvedValue(STOCK_V2_OK),
) {
  return { listProducts, listStockV2 } as unknown as JubelioClient;
}

/** A masters-shaped row (stock/image always `null` before the v2 merge). */
function pickerRow(itemId: number): PickerRow {
  return {
    itemId,
    skuCode: `SKU-${itemId}`,
    itemGroupName: "Kuangyu Dream - SLA",
    price: 3700000,
    minOrder: 1,
    stock: null,
    image: null,
  };
}

/** Literal map for the pure-merge cases (`Map` generics need the hint). */
function stockMap(entries: Array<[number, StockEntry]>): StockMap {
  return new Map(entries);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T04:00:00Z"));
  __resetCatalogCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCatalogRows", () => {
  it("fetches once and serves cache hits within the 60s TTL", async () => {
    const client = stubClient();
    const first = await getCatalogRows(client);
    vi.setSystemTime(new Date("2026-10-26T04:00:59Z"));
    const second = await getCatalogRows(client);

    expect(client.listProducts).toHaveBeenCalledTimes(1);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("refetches after the TTL expires", async () => {
    const client = stubClient();
    await getCatalogRows(client);
    vi.setSystemTime(new Date("2026-10-26T04:01:01Z"));
    await getCatalogRows(client);

    expect(client.listProducts).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent calls into one upstream fetch", async () => {
    const client = stubClient();
    const [a, b] = await Promise.all([
      getCatalogRows(client),
      getCatalogRows(client),
    ]);

    expect(client.listProducts).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("keeps the upstream JubelioError when the fetch fails (status 400)", async () => {
    const client = stubClient(
      vi
        .fn()
        .mockRejectedValue(new JubelioError(400, undefined, '"search" is not allowed')),
    );
    await expect(getCatalogRows(client)).rejects.toMatchObject({
      name: "JubelioError",
      status: 400,
      message: '"search" is not allowed',
    });
  });

  it("does not poison the cache on failure — next caller retries and succeeds", async () => {
    const failing = vi
      .fn()
      .mockRejectedValue(
        // Non-JSON upstream body path: request() fell back to this message.
        new JubelioError(500, undefined, "Jubelio request failed: 500"),
      );
    await expect(getCatalogRows(stubClient(failing))).rejects.toMatchObject({
      status: 500,
      message: "Jubelio request failed: 500",
    });

    const ok = stubClient();
    const rows = await getCatalogRows(ok);
    expect(rows).toHaveLength(1);
  });
});

describe("getStockMap", () => {
  it("dedupes within the TTL: two calls, one listStockV2 fetch", async () => {
    const listStockV2 = vi.fn().mockResolvedValue(STOCK_V2_OK);
    const client = stubClient(undefined, listStockV2);
    const first = await getStockMap(client);
    vi.setSystemTime(new Date("2026-10-26T04:00:59Z"));
    const second = await getStockMap(client);

    expect(listStockV2).toHaveBeenCalledTimes(1);
    expect(first.get(2685)).toEqual({
      available: 12,
      image: "https://cdn.example.com/2685.jpg",
    });
    expect(second).toBe(first); // same Map instance, not a re-mapped copy
  });

  it("refetches after the TTL expires", async () => {
    const listStockV2 = vi.fn().mockResolvedValue(STOCK_V2_OK);
    const client = stubClient(undefined, listStockV2);
    await getStockMap(client);
    vi.setSystemTime(new Date("2026-10-26T04:01:01Z"));
    await getStockMap(client);

    expect(listStockV2).toHaveBeenCalledTimes(2);
  });

  it("unpoisons on failure: rejected fetch is not replayed for the TTL", async () => {
    const listStockV2 = vi
      .fn()
      .mockRejectedValueOnce(
        // 5xx with a non-JSON body: exactly what `request()` falls back to.
        new JubelioError(500, undefined, "Jubelio request failed: 500"),
      )
      .mockResolvedValueOnce(STOCK_V2_OK);
    const client = stubClient(undefined, listStockV2);

    await expect(getStockMap(client)).rejects.toMatchObject({
      status: 500,
      message: "Jubelio request failed: 500",
    });

    // One second later — deep inside the original TTL — the same caller must
    // be handed a real retry, not the cached rejection.
    vi.setSystemTime(new Date("2026-10-26T04:00:01Z"));
    const map = await getStockMap(client);
    expect(listStockV2).toHaveBeenCalledTimes(2);
    expect(map.get(999)).toEqual({ available: 0, image: null });
  });

  it("unpoison is identity-guarded: a late failure keeps the newer entry", async () => {
    let rejectFirst!: (error: unknown) => void;
    const hanging = vi
      .fn()
      .mockReturnValue(
        new Promise<unknown>((_, reject) => {
          rejectFirst = reject;
        }),
      );
    const first = getStockMap(stubClient(undefined, hanging));

    // The hung fetch outlives its TTL; a newer successful one takes the slot.
    vi.setSystemTime(new Date("2026-10-26T04:01:01Z"));
    const listStockV2 = vi.fn().mockResolvedValue(STOCK_V2_OK);
    const fresh = await getStockMap(stubClient(undefined, listStockV2));

    rejectFirst(new JubelioError(500, undefined, "Jubelio request failed: 500"));
    await expect(first).rejects.toMatchObject({ status: 500 });

    // The stale failure must not clear the healthy entry it no longer owns.
    vi.setSystemTime(new Date("2026-10-26T04:01:30Z"));
    expect(await getStockMap(stubClient())).toBe(fresh);
    expect(listStockV2).toHaveBeenCalledTimes(1);
  });

  it("caches independently of the masters entry (masters hit still serves fresh v2 map)", async () => {
    const listProducts = vi.fn().mockResolvedValue(MASTERS_OK);
    const listStockV2 = vi.fn().mockResolvedValue(STOCK_V2_OK);
    const client = stubClient(listProducts, listStockV2);
    await getStockMap(client); // v2 primed at 04:00:00
    vi.setSystemTime(new Date("2026-10-26T04:00:40Z"));
    await getCatalogRows(client); // masters primed at 04:00:40

    // 04:01:10: the v2 TTL has lapsed, the masters TTL has not.
    vi.setSystemTime(new Date("2026-10-26T04:01:10Z"));
    const rows = await getCatalogRows(client);
    const map = await getStockMap(client);

    expect(listProducts).toHaveBeenCalledTimes(1); // masters: cache hit
    expect(listStockV2).toHaveBeenCalledTimes(2); // v2: refetched on its own clock
    expect(rows).toHaveLength(1);
    expect(map.size).toBe(2);
  });

  it("a v2 failure leaves the masters cache intact", async () => {
    const listProducts = vi.fn().mockResolvedValue(MASTERS_OK);
    const client = stubClient(
      listProducts,
      vi
        .fn()
        .mockRejectedValue(new JubelioError(502, undefined, "bad gateway")),
    );
    const rows = await getCatalogRows(client);
    await expect(getStockMap(client)).rejects.toMatchObject({ status: 502 });

    expect(rows).toHaveLength(1);
    expect(await getCatalogRows(client)).toBe(rows); // masters entry still cached
    expect(listProducts).toHaveBeenCalledTimes(1);
  });

  it("__resetCatalogCache clears both entries", async () => {
    const listProducts = vi.fn().mockResolvedValue(MASTERS_OK);
    const listStockV2 = vi.fn().mockResolvedValue(STOCK_V2_OK);
    const client = stubClient(listProducts, listStockV2);
    await getCatalogRows(client);
    await getStockMap(client);

    __resetCatalogCache();

    await getCatalogRows(client);
    await getStockMap(client);
    expect(listProducts).toHaveBeenCalledTimes(2);
    expect(listStockV2).toHaveBeenCalledTimes(2);
  });
});

describe("mergeStockIntoRows", () => {
  it("joins stock + image by item_id", () => {
    const merged = mergeStockIntoRows(
      [pickerRow(2685), pickerRow(999)],
      stockMap([
        [2685, { available: 12, image: "https://cdn.example.com/2685.jpg" }],
        [999, { available: 0, image: null }],
      ]),
    );

    expect(merged[0]).toMatchObject({
      stock: 12,
      image: "https://cdn.example.com/2685.jpg",
    });
    // `0` is a real ERP number, not a missing one — `??` must keep it.
    expect(merged[1]).toMatchObject({ stock: 0, image: null });
  });

  it("Review Focus 5 — absent SKU keeps the row with null stock/image", () => {
    const rows = [pickerRow(2685), pickerRow(999)];
    const merged = mergeStockIntoRows(
      rows,
      stockMap([[999, { available: 5, image: "u" }]]),
    );

    expect(merged).toHaveLength(2); // no row dropped by a partial v2 payload
    // Full row identity intact both ways — only stock/image are rewritten.
    expect(merged[0]).toEqual({ ...pickerRow(2685), stock: null, image: null });
    expect(merged[1]).toEqual({ ...pickerRow(999), stock: 5, image: "u" });
  });

  it("null map → every row null/null, rows survive", () => {
    const rows = [pickerRow(2685), pickerRow(999)];
    const merged = mergeStockIntoRows(rows, null);

    expect(merged).toHaveLength(2);
    expect(merged.map((r) => [r.stock, r.image])).toEqual([
      [null, null],
      [null, null],
    ]);
    // Every other field survives untouched, in order.
    expect(merged.map((r) => r.skuCode)).toEqual(["SKU-2685", "SKU-999"]);
  });

  it("is pure: new array, input rows never mutated", () => {
    const stale = { ...pickerRow(2685), stock: 7, image: "old.jpg" };
    const rows = [stale];
    const merged = mergeStockIntoRows(
      rows,
      stockMap([[2685, { available: 12, image: "new.jpg" }]]),
    );

    expect(merged).not.toBe(rows);
    expect(merged[0]).not.toBe(stale);
    expect(stale).toEqual({ ...pickerRow(2685), stock: 7, image: "old.jpg" });
  });

  it("empty rows → empty array, even with a populated map", () => {
    expect(
      mergeStockIntoRows([], stockMap([[1, { available: 1, image: null }]])),
    ).toEqual([]);
  });
});
