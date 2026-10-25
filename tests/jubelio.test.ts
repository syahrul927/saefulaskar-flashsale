import { afterEach, describe, expect, it, vi } from "vitest";

import { JubelioError, jubelioClient } from "@/lib/jubelio";
import { env } from "@/env";

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("jubelioClient", () => {
  it("sends Authorization Bearer + JSON headers on listProducts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ item_id: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    await jubelioClient.listProducts("baju");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${env.JUBELIO_BASE_URL}/inventory/items/masters?search=baju`);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${env.JUBELIO_ACCESS_TOKEN}`,
      ...JSON_HEADERS,
    });
  });

  it("retries once on 401 after env token swap", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse([{ item_id: 2 }]));
    vi.stubGlobal("fetch", fetchMock);

    const res = await jubelioClient.listProducts();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second call still reads env.JUBELIO_ACCESS_TOKEN (the swapped value).
    const authHeaders = fetchMock.mock.calls.map(
      (c) => (c[1] as RequestInit).headers,
    );
    expect(authHeaders[0]).toEqual({
      Authorization: `Bearer ${env.JUBELIO_ACCESS_TOKEN}`,
      ...JSON_HEADERS,
    });
    expect(authHeaders[1]).toEqual(authHeaders[0]);
    expect(res).toEqual([{ item_id: 2 }]);
  });

  it("throws JubelioError with status + code on non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: "E", message: "boom" }, 500)),
    );
    await expect(jubelioClient.listProducts()).rejects.toMatchObject({
      name: "JubelioError",
      status: 500,
      code: "E",
      message: "boom",
    });
  });

  it("sends location_id body on listStock", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ item_id: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    await jubelioClient.listStock();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${env.JUBELIO_BASE_URL}/inventory/items/all-stocks/`);
    expect(init.method).toBe("POST");
    expect((init.body as string)).toBe(JSON.stringify({ location_id: env.JUBELIO_LOCATION_ID }));
  });

  it("escapes sku in getStockBySku path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ item_id: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await jubelioClient.getStockBySku("AB/1");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${env.JUBELIO_BASE_URL}/inventory/items/by-sku/AB%2F1`);
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

    await jubelioClient.createContact(payload);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${env.JUBELIO_BASE_URL}/contacts/`);
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

    await jubelioClient.createSalesOrder(payload);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${env.JUBELIO_BASE_URL}/sales/orders/`);
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it("maps listSalesOrders/listInvoices to GET endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const orders = await jubelioClient.listSalesOrders();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${env.JUBELIO_BASE_URL}/sales/orders/`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(orders).toEqual([]);

    const invoices = await jubelioClient.listInvoices();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${env.JUBELIO_BASE_URL}/sales/invoices/`,
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
