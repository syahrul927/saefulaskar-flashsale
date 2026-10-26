import { afterEach, describe, expect, it, vi } from "vitest";

import { createJubelioClient, JubelioError } from "@/lib/jubelio";
import { env } from "@/env";

// Canonical base URL after the join fix: base ends with "/", paths start with "/".
const API = "https://open.jubelio.com/core-api";

const TOKEN = "test-token";

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
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