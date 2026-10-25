import { env } from "@/env";

/**
 * Jubelio core-api client.
 *
 * The client is **token-injected** (`createJubelioClient(token)`); there is no
 * static API token. Token sources depend on the caller:
 *   - Admin routes (Jubelio login) use the signed-in admin's `user.token`.
 *   - No-user callers (cron, customer contact creation) log in with the
 *     "system" account (`JUBELIO_SYSTEM_EMAIL`/`JUBELIO_SYSTEM_PASSWORD`) via
 *     `src/server/jubelio-token.ts`.
 *
 * A 401 (`JubelioError.status === 401`) means the token expired:
 *   - For an admin caller, the route surfaces `SESSION_EXPIRED` and the app
 *     signs the admin out (their Jubelio session ended).
 *   - For a system caller, `withSystemClient` re-logs-in and retries once.
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

/** True when a Jubelio call failed because the token is expired/invalid. */
export function isJubelioAuthError(e: unknown): boolean {
  return e instanceof JubelioError && e.status === 401;
}

type Json = Record<string, unknown>;

async function request(
  token: string,
  path: string,
  options: { method: "GET" | "POST"; body?: Json },
): Promise<unknown> {
  const url = `${env.JUBELIO_BASE_URL}${path}`;
  const res = await fetch(url, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

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

/** Reshaped master row consumed by the picker modal (`SearchResult`). */
export type PickerRow = {
  itemId: number;
  skuCode: string;
  itemGroupName: string;
  price: number;
  minOrder: number;
  /** Real-time stock — the Jubelio master API may omit it → `null`. */
  stock: number | null;
};

type RawMaster = {
  item_id?: unknown;
  sku_code?: unknown;
  item_group_name?: unknown;
  price?: unknown;
  min?: unknown;
  stock?: unknown;
};

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Pure reshaper used by `GET /api/jubelio/products`: raw master items →
 * camelCase picker rows. Non-array input yields `[]`; a missing or
 * non-numeric `stock` stays `null` so the UI shows an em dash, never a
 * fake `0`. Exported for unit tests.
 */
export function toPickerRows(rows: unknown): PickerRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => {
    const p = (item ?? {}) as RawMaster;
    return {
      itemId: num(p.item_id) ?? 0,
      skuCode: str(p.sku_code) ?? "",
      itemGroupName: str(p.item_group_name) ?? "",
      price: num(p.price) ?? 0,
      minOrder: num(p.min) ?? 1,
      stock: num(p.stock) ?? null,
    };
  });
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

export type JubelioClient = ReturnType<typeof createJubelioClient>;

export function createJubelioClient(token: string) {
  return {
    /** GET /inventory/items/masters — browse/search the product catalog. */
    async listProducts(search?: string): Promise<unknown> {
      const q =
        search === undefined ? "" : `?search=${encodeURIComponent(search)}`;
      return request(token, `/inventory/items/masters${q}`, { method: "GET" });
    },

    /** POST /inventory/items/all-stocks/ — all products + stock for this location. */
    async listStock(): Promise<unknown> {
      return request(token, "/inventory/items/all-stocks/", {
        method: "POST",
        body: { location_id: env.JUBELIO_LOCATION_ID },
      });
    },

    /** GET /inventory/items/by-sku/{sku} — stock for one SKU (admin picker). */
    async getStockBySku(sku: string): Promise<unknown> {
      return request(token, `/inventory/items/by-sku/${encodeURIComponent(sku)}`, {
        method: "GET",
      });
    },

    /** POST /contacts/ — register a customer contact (spec §4.1). */
    async createContact(payload: ContactPayload): Promise<unknown> {
      return request(token, "/contacts/", {
        method: "POST",
        body: { ...payload },
      });
    },

    /** POST /sales/orders/ — create a sales order (spec §4.5, is_paid: true). */
    async createSalesOrder(payload: SalesOrderPayload): Promise<unknown> {
      return request(token, "/sales/orders/", {
        method: "POST",
        body: { ...payload },
      });
    },

    /** GET /sales/orders/ — daily sync poll (spec §4.6). */
    async listSalesOrders(): Promise<unknown> {
      return request(token, "/sales/orders/", { method: "GET" });
    },

    /** GET /sales/invoices/ — daily sync poll (spec §4.6). */
    async listInvoices(): Promise<unknown> {
      return request(token, "/sales/invoices/", { method: "GET" });
    },
  };
}