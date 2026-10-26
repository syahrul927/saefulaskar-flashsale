import { afterEach, describe, expect, it, vi } from "vitest";

import { createJubelioClient, JubelioError, toStockMap } from "@/lib/jubelio";
import { env } from "@/env";

// Canonical base URL after the join fix: base ends with "/", paths start with "/".
const API = "https://open.jubelio.com/core-api";

const TOKEN = "test-token";

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * SKU-level `/inventory/v2/` row copied from the live probe 2026-10-26
 * (spec "Verified live"): `total_stocks.{on_hand,on_order,reserved,
 * available}` + CDN `thumbnail`; no sell price (masters stays the price
 * source). Defaults match the 2685 / "[SLA]UA000044N" masters probe row.
 */
function v2Row(
  overrides: Partial<{
    item_id: unknown;
    item_code: unknown;
    item_name: unknown;
    is_bundle: unknown;
    thumbnail: unknown;
    total_stocks: unknown;
  }> = {},
) {
  return {
    item_id: 2685,
    item_code: "[SLA]UA000044N",
    item_name: "Kuangyu Dream - SLA",
    is_bundle: false,
    thumbnail: "https://cdn.example/thumb.jpg",
    total_stocks: { on_hand: 12, on_order: 0, reserved: 0, available: 12 },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createJubelioClient", () => {
  const client = createJubelioClient(TOKEN);

  it("sends Authorization Bearer + JSON headers on listProducts, no query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await client.listProducts();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://open.jubelio.com/core-api/inventory/items/masters",
    );
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      ...JSON_HEADERS,
    });
  });

  it("joins base + path with a single slash even though JUBELIO_BASE_URL ends with '/'", async () => {
    // env.JUBELIO_BASE_URL (vitest config) = "https://open.jubelio.com/core-api/"
    // — the join must not produce `core-api//inventory/…` (the live 404 bug).
    expect(env.JUBELIO_BASE_URL.endsWith("/")).toBe(true);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await client.listProducts();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).not.toContain("//inventory");
    expect(url.split("core-api")[1]).toBe("/inventory/items/masters");
  });

  it("throws JubelioError 401 when the token is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "unauthorized" }, 401)),
    );
    await expect(client.listProducts()).rejects.toMatchObject({
      name: "JubelioError",
      status: 401,
      message: "unauthorized",
    });
  });

  it("throws JubelioError with status + code on non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: "E", message: "boom" }, 500)),
    );
    await expect(client.listProducts()).rejects.toMatchObject({
      name: "JubelioError",
      status: 500,
      code: "E",
      message: "boom",
    });
  });

  it("sends location_id body on listStock", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ item_id: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    await client.listStock();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/inventory/items/all-stocks/`);
    expect(init.method).toBe("POST");
    expect((init.body as string)).toBe(JSON.stringify({ location_id: env.JUBELIO_LOCATION_ID }));
  });

  it("GETs /inventory/v2/ with pagination params and Bearer header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await client.listStockV2();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/inventory/v2/?page=1&page_size=2000`);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      ...JSON_HEADERS,
    });
  });

  it("stalls are bounded: every request carries a 15 s AbortSignal that turns a hung fetch into a rejection", async () => {
    // Final review I-1: `request()` passed no `signal`, so a half-open TCP or
    // a slow gateway on the 2.3 MB `/inventory/v2/` page never REJECTED — the
    // picker route's `await mapPromise`, the roster SSR and the import POST
    // just sat there. The plate-honesty degradation paths are already pinned
    // and fire on rejection; all a stall was missing was the rejection.
    const controller = new AbortController();
    const timeouts: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      return controller.signal;
    });
    // A stall modelled faithfully: the promise settles only when the signal
    // fires, exactly like undici's abort steps.
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => {
            // undici's timeout reason is a `TimeoutError` DOMException — an
            // Error subclass, hence this shape.
            const reason: Error = signal.reason as Error;
            reject(reason);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = client.listStockV2();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
    // One constant, applied to every call: 15 s (v2 cold read ≈ 1.7 s).
    expect(timeouts).toEqual([15_000]);

    controller.abort(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );
    await expect(pending).rejects.toBeInstanceOf(DOMException);
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("attaches an abort signal to every endpoint, GET and POST alike", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await client.listProducts();
    await client.listStock();
    await client.listStockV2();
    await client.getStockBySku("AB/1");
    await client.listSalesOrders();
    await client.listInvoices();

    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("escapes sku in getStockBySku path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ item_id: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await client.getStockBySku("AB/1");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${API}/inventory/items/by-sku/AB%2F1`);
  });

  it("posts ContactPayload to /contacts/", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ contact_id: 55 }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      contact_id: 0 as const,
      contact_name: "Toko Test",
      contact_type: 0 as const,
      phone: "0812",
      primary_contact: "Budi",
      contact_position: "pemilik" as const,
      s_address: "Jl. A",
      is_reseller: true,
    };

    await client.createContact(payload);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/contacts/`);
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it("posts SalesOrderPayload to /sales/orders/", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ salesorder_id: 9 }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      salesorder_id: 0 as const,
      salesorder_no: "[auto]" as const,
      contact_id: 55,
      customer_name: "Toko Test",
      transaction_date: "2026-10-25",
      location_id: env.JUBELIO_LOCATION_ID,
      source: 1 as const,
      is_paid: true,
      payment_method: "transfer",
      items: [{ item_id: 1, item_name: "Baju", sku: "AB/1", qty: 2, price: 50000, discount: 0, tax: 0 }],
      sub_total: 100000,
      total_disc: 0,
      total_tax: 0,
      grand_total: 100000,
    };

    await client.createSalesOrder(payload);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/sales/orders/`);
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it("maps listSalesOrders/listInvoices to GET endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const orders = await client.listSalesOrders();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${API}/sales/orders/`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(orders).toEqual([]);

    const invoices = await client.listInvoices();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${API}/sales/invoices/`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(invoices).toEqual([]);
  });
});

describe("toStockMap", () => {
  it("maps the {data:[…]} envelope keyed by item_id", () => {
    const map = toStockMap({
      data: [
        v2Row({
          item_id: 2685,
          total_stocks: { available: 12 },
          thumbnail: "https://cdn/thumb.jpg",
        }),
      ],
    });
    expect(map.get(2685)).toEqual({
      available: 12,
      image: "https://cdn/thumb.jpg",
    });
  });

  it("tolerates a bare array payload", () => {
    const map = toStockMap([v2Row({ item_id: 7 })]);
    expect(map.size).toBe(1);
    expect(map.get(7)).toEqual({
      available: 12,
      image: "https://cdn.example/thumb.jpg",
    });
  });

  it("passes negative available through raw", () => {
    // Live probe 2026-10-26: 4 of 1775 SKUs are negative (min −14) — the
    // ERP oversells; parity means showing the number untouched.
    const map = toStockMap({
      data: [v2Row({ item_id: 9, total_stocks: { available: -14 } })],
    });
    expect(map.get(9)?.available).toBe(-14);
  });

  it("keeps rows with absent/null/non-string thumbnail as image: null", () => {
    const map = toStockMap({
      data: [
        v2Row({ item_id: 1, thumbnail: undefined }),
        v2Row({ item_id: 2, thumbnail: null }),
        v2Row({ item_id: 3, thumbnail: 404 }), // non-string → null
        { item_id: 4, total_stocks: { available: 1 } }, // key absent entirely
      ],
    });
    expect(map.size).toBe(4);
    expect(map.get(1)?.image).toBeNull();
    expect(map.get(2)?.image).toBeNull();
    expect(map.get(3)?.image).toBeNull();
    expect(map.get(4)?.image).toBeNull();
  });

  it("skips junk rows: missing/non-numeric item_id, absent total_stocks, non-numeric available", () => {
    const map = toStockMap({
      data: [
        { item_id: "abc", total_stocks: { available: 5 } },
        { total_stocks: { available: 5 } },
        { item_id: 7 },
        { item_id: 8, total_stocks: { available: "lots" } },
        { item_id: 9, total_stocks: { available: "NaN" } },
        { item_id: 10, total_stocks: null },
        null,
        "string",
      ],
    });
    expect([...map.keys()]).toEqual([]);
    expect(toStockMap(null).size).toBe(0);
    expect(toStockMap({ data: "nope" }).size).toBe(0);
  });

  it("accepts a numeric-string available (decimal-string tolerance like prices)", () => {
    const map = toStockMap({
      data: [v2Row({ item_id: 5, total_stocks: { available: "14.0000" } })],
    });
    expect(map.get(5)).toEqual({
      available: 14,
      image: "https://cdn.example/thumb.jpg",
    });
  });
});

describe("request error bodies (Review Focus #1)", () => {
  const client = createJubelioClient(TOKEN);

  it("keeps the fallback message when upstream answers with a non-JSON body", async () => {
    // Gateway HTML on a 500 — `res.json()` throws inside the error branch;
    // request() must swallow it and still carry the real status.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    }));

    await expect(client.listProducts()).rejects.toMatchObject({
      name: "JubelioError",
      status: 500,
      message: "Jubelio request failed: 500",
    });
  });

  it("prefers the upstream JSON message on a structured error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: "BAD_QUERY", message: "param not allowed" }),
    }));

    await expect(client.listProducts()).rejects.toMatchObject({
      status: 400,
      code: "BAD_QUERY",
      message: "param not allowed",
    });
  });
});

describe("JubelioError", () => {
  it("keeps status/code and sets name", () => {
    const err = new JubelioError(401, "OLD_TOKEN", "unauthorized");
    expect(err.status).toBe(401);
    expect(err.code).toBe("OLD_TOKEN");
    expect(err.message).toBe("unauthorized");
    expect(err.name).toBe("JubelioError");
    expect(err).toBeInstanceOf(Error);
  });
});