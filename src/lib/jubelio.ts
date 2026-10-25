import { env } from "@/env";

/**
 * Jubelio core-api client.
 *
 * Base URL defaults to `https://open.jubelio.com/core-api/` (env.JUBELIO_BASE_URL).
 * The access token is read from env at call time: if a request 401s, the token
 * may have been refreshed externally (env swap, spec §5.7), so the client
 * re-reads it and retries exactly once.
 *
 * Endpoints return the raw Jubelio response — callers pick fields (per spec:
 * docs unreliable, test per endpoint).
 */

export class JubelioError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "JubelioError";
  }
}

type Json = Record<string, unknown>;

async function request(
  path: string,
  options: { method: "GET" | "POST"; body?: Json },
): Promise<unknown> {
  const url = `${env.JUBELIO_BASE_URL}${path}`;
  const send = (token: string) =>
    fetch(url, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

  let res = await send(env.JUBELIO_ACCESS_TOKEN);
  if (res.status === 401) {
    // Token may have been swapped in env externally — retry once with the new value.
    // TODO (Task 10): 401 retry is a no-op with @t3-oss/env-nextjs — the proxy
    // snapshot at import returns the same stale token. Fix: use a mutable token
    // store (module-level `let currentToken`) updated by the refresh routine, and
    // have the retry re-fetch a fresh env token then retry. This is the Jubelio
    // token refresh pattern per spec §5.7.
    res = await send(env.JUBELIO_ACCESS_TOKEN);
  }
  if (!res.ok) {
    let code: string | undefined;
    let message = `Jubelio request failed: ${res.status}`;
    try {
      const data = (await res.json()) as {
        code?: string;
        message?: string;
        error?: string;
      };
      code = data.code;
      message = data.message ?? data.error ?? message;
    } catch {
      // Non-JSON error body — keep the fallback message.
    }
    throw new JubelioError(res.status, code, message);
  }
  return res.json();
}

/* ---------------------------------- shapes --------------------------------- */

/**
 * Extract `stock`/`available_stock` from a raw getStockBySku response.
 * Returns the first numeric value found among the known field names,
 * or `undefined` if none is present. `undefined` lets callers distinguish
 * "no stock field in the payload" from a real `0` stock.
 */
export function toAvailableStock(raw: unknown): number | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  for (const key of ["available_stock", "stock", "availableStock"]) {
    const v = r[key];
    if (typeof v === "number") return v;
  }
  return undefined;
}

/** `saveContactRequest` — spec §4.1 (customer onboarding). */
export type ContactPayload = {
  contact_id: 0;
  contact_name: string;
  contact_type: 0;
  phone: string;
  primary_contact?: string;
  contact_position?: "pemilik" | "procurement";
  s_address?: string;
  is_reseller?: boolean;
};

export type SalesOrderItem = {
  item_id: number;
  item_name: string;
  sku: string;
  qty: number;
  price: number;
  discount?: number;
  tax?: number;
  uom_id?: number;
  warehouse_id?: number;
};

/** `saveSalesOrderRequest` — spec §4.5 (confirm payment → paid SO). */
export type SalesOrderPayload = {
  salesorder_id: 0;
  salesorder_no: "[auto]";
  contact_id: number;
  customer_name: string;
  transaction_date: string;
  location_id: number;
  source: 1;
  is_paid: boolean;
  payment_method?: string;
  items: SalesOrderItem[];
  sub_total: number;
  total_disc: number;
  total_tax: number;
  grand_total: number;
  add_disc?: number;
  add_fee?: number;
  service_fee?: number;
};

/* ---------------------------------- client --------------------------------- */

export const jubelioClient = {
  /** GET /inventory/items/masters — browse/search the product catalog. */
  async listProducts(search?: string): Promise<unknown> {
    const q = search === undefined ? "" : `?search=${encodeURIComponent(search)}`;
    return request(`/inventory/items/masters${q}`, { method: "GET" });
  },

  /** POST /inventory/items/all-stocks/ — all products + stock for this location. */
  async listStock(): Promise<unknown> {
    return request("/inventory/items/all-stocks/", {
      method: "POST",
      body: { location_id: env.JUBELIO_LOCATION_ID },
    });
  },

  /** GET /inventory/items/by-sku/{sku} — live stock re-check at checkout (spec §4.4). */
  async getStockBySku(sku: string): Promise<unknown> {
    // TODO: location_id for getStockBySku — GET body unreliable; confirm with
    // Jubelio whether location should be a query param ?location_id= or if the
    // endpoint returns per-location stock natively. Currently returns all-location
    // aggregate, which may overstate available stock at checkout.
    return request(`/inventory/items/by-sku/${encodeURIComponent(sku)}`, {
      method: "GET",
    });
  },

  /** POST /contacts/ — register a customer contact (spec §4.1). */
  async createContact(payload: ContactPayload): Promise<unknown> {
    return request("/contacts/", { method: "POST", body: { ...payload } });
  },

  /** POST /sales/orders/ — create a sales order (spec §4.5, is_paid: true). */
  async createSalesOrder(payload: SalesOrderPayload): Promise<unknown> {
    return request("/sales/orders/", { method: "POST", body: { ...payload } });
  },

  /** GET /sales/orders/ — daily sync poll (spec §4.6). */
  async listSalesOrders(): Promise<unknown> {
    return request("/sales/orders/", { method: "GET" });
  },

  /** GET /sales/invoices/ — daily sync poll (spec §4.6). */
  async listInvoices(): Promise<unknown> {
    return request("/sales/invoices/", { method: "GET" });
  },
};
