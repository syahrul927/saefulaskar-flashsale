import { env } from "@/env";

/**
 * Jubelio core-api client.
 *
 * The client is **token-injected** (`createJubelioClient(token)`); there is no
 * static API token. Token sources depend on the caller:
 *   - Admin routes (Jubelio login) use the signed-in admin's `user.token`.
 *   - No-user callers (the order-status sync, customer contact creation) log
 *     in with the "system" account (`JUBELIO_SYSTEM_EMAIL`/
 *     `JUBELIO_SYSTEM_PASSWORD`) via `src/server/jubelio-token.ts`.
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

/**
 * Hard ceiling on every upstream call, applied in `request()` so no endpoint
 * can be left unbounded. Without a signal, a stalled read — half-open TCP or
 * a slow gateway on the ~2.3 MB `/inventory/v2/` page — never REJECTED, and
 * the three surfaces that await this client (picker products route
 * `await mapPromise`, roster SSR `getStockMap`, import POST) sat forever
 * instead of degrading. The rejection side of that contract is already pinned
 * (`toStockMap`/`mergeStockIntoRows` → "—"/letter tiles); 15 s is what makes
 * it reachable. Chosen as headroom, not a slow-path compromise: the v2
 * cold read measures ≈1.7 s live (probe 2026-10-26). One constant, no
 * per-call override plumbing.
 */
const REQUEST_TIMEOUT_MS = 15_000;

async function request(
  token: string,
  path: string,
  options: { method: "GET" | "POST"; body?: Json },
): Promise<unknown> {
  // Join explicitly: the default `JUBELIO_BASE_URL` ends with `/` and every
  // path starts with `/`, and naive concatenation produced `core-api//…` →
  // 404 (spec: verified live 2026-10-26).
  const url = `${env.JUBELIO_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  const res = await fetch(url, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

/** Reshaped master row consumed by the picker modal (`SearchResult`). */
export type PickerRow = {
  itemId: number;
  skuCode: string;
  itemGroupName: string;
  price: number;
  minOrder: number;
  /**
   * ERP availability per SKU — v2 `total_stocks.available`, merged
   * server-side by `/api/jubelio/products` from `toStockMap` (masters
   * itself has no stock field). `null` when the SKU is absent from the v2
   * payload; `toPickerRows` alone always emits `null`.
   */
  stock: number | null;
  /** v2 `thumbnail` URL, merged server-side; `null` → letter tile. */
  image: string | null;
};

/** One entry of the masters item's `variants` JSON string. */
type RawVariant = {
  item_id?: unknown;
  item_code?: unknown;
  /** Per-SKU label; present on every live variant (probe 2026-10-26). */
  item_name?: unknown;
  sell_price?: unknown;
};

type RawMaster = {
  item_name?: unknown;
  /** Decimal string ("3700000.0000") in the live payload. */
  sell_price?: unknown;
  /** JSON-encoded string of `RawVariant[]` (may already be an array). */
  variants?: unknown;
};

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Numeric field tolerant of the decimal-string prices upstream sends. */
function numberValue(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Masters `variants` arrives as a JSON-encoded string; tolerate arrays too. */
function parseVariants(raw: unknown): RawVariant[] {
  if (Array.isArray(raw)) return raw as RawVariant[];
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as RawVariant[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Pure reshaper used by `GET /api/jubelio/products`: the live masters
 * response (`{ data: [...] }` envelope or bare array) → camelCase picker
 * rows, ONE ROW PER VARIANT. Identity (`item_id`, `item_code`) exists only
 * inside `variants[]`; a live probe (2026-10-26, final review I-4) showed
 * 328 of 573 items carry >1 variant — 1752 SKUs where a `variants[0]`
 * mapping would show 573 and make the rest unimportable. Per-variant
 * `item_name`/`sell_price` win over the item-level defaults (each SKU has
 * its own price); junk or absent `variants` yields the fallback row
 * (`itemId 0`, empty strings), never a throw; `minOrder` is constant `1`
 * (masters carries no `min`); `stock`/`image` emit `null` here — masters
 * has neither; the route merges them from the v2 payload (`toStockMap`).
 * Exported for unit tests.
 */
export function toPickerRows(raw: unknown): PickerRow[] {
  const items = Array.isArray(raw)
    ? raw
    : ((raw as { data?: unknown } | null)?.data ?? []);
  if (!Array.isArray(items)) return [];
  const rows: PickerRow[] = [];
  for (const item of items) {
    const p = (item ?? {}) as RawMaster;
    const variants = parseVariants(p.variants);
    if (variants.length === 0) {
      rows.push({
        itemId: 0,
        skuCode: "",
        itemGroupName: str(p.item_name) ?? "",
        price: numberValue(p.sell_price) ?? 0,
        minOrder: 1,
        stock: null,
        image: null,
      });
      continue;
    }
    for (const variant of variants) {
      rows.push({
        itemId: num(variant.item_id) ?? 0,
        skuCode: str(variant.item_code) ?? "",
        itemGroupName: str(variant.item_name) ?? str(p.item_name) ?? "",
        price:
          numberValue(variant.sell_price) ?? numberValue(p.sell_price) ?? 0,
        minOrder: 1,
        stock: null,
        image: null,
      });
    }
  }
  return rows;
}

/** One `/inventory/v2/` SKU row joined onto a `PickerRow` by `item_id`. */
export type StockEntry = {
  available: number;
  image: string | null;
};

/** One SKU-level entry of the v2 `/inventory/v2/` response. */
type RawStockRow = {
  item_id?: unknown;
  thumbnail?: unknown;
  total_stocks?: unknown;
};

/**
 * Pure reshaper for the v2 stock endpoint: the live `/inventory/v2/`
 * response (`{ data: [...] }` envelope or bare array, tolerated exactly
 * like `toPickerRows`) → `item_id → StockEntry`. Rows are SKU-level with
 * `total_stocks.{on_hand,on_order,reserved,available}` and a CDN
 * `thumbnail` (live probe 2026-10-26: 1775 rows in one `page_size=2000`
 * request). `available` accepts numbers and decimal strings via the same
 * `numberValue` coercion as prices, rejects `NaN`/non-finite, and passes
 * negatives through untouched (4 SKUs exist, min −14 — parity means the
 * raw ERP number). Absent or non-string `thumbnail` → `image: null`
 * (letter tile). Junk rows — non-numeric/missing `item_id`, absent
 * `total_stocks`, non-numeric `available`, non-object entries — are
 * skipped, never a throw. Duplicate `item_id`s: last write wins.
 * Exported for unit tests.
 */
export function toStockMap(raw: unknown): Map<number, StockEntry> {
  const items = Array.isArray(raw)
    ? raw
    : ((raw as { data?: unknown } | null)?.data ?? []);
  const map = new Map<number, StockEntry>();
  if (!Array.isArray(items)) return map;
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as RawStockRow;
    const itemId = num(r.item_id);
    if (itemId === undefined || !Number.isFinite(itemId)) continue;
    const stocks = r.total_stocks;
    if (typeof stocks !== "object" || stocks === null) continue;
    const available = numberValue(
      (stocks as { available?: unknown }).available,
    );
    if (available === undefined) continue;
    map.set(itemId, { available, image: str(r.thumbnail) ?? null });
  }
  return map;
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

/**
 * One `saveSalesOrderRequest.items[]` line — the STRICT upstream Joi schema
 * (OpenAPI `saveSalesOrderRequest.items[]`, live-verified 2026-10-27):
 * `item_name`/`sku`/`qty` are rejected ("not allowed"); quantity travels as
 * `qty_in_base` + `unit`, and `amount` (qty × price) must be precomputed.
 */
export type SalesOrderItem = {
  salesorder_detail_id: number;
  item_id: number;
  qty_in_base: number;
  unit: string;
  price: number;
  amount: number;
  disc: number;
  disc_amount: number;
  tax_amount: number;
  tax_id: number;
  location_id: number;
  /**
   * The four keys below are not business data for us — they are what the
   * dashboard's own create request sends on every line (captured live
   * 2026-10-28), and the rows we created without them came back with
   * `status: null` on the line. Emitted as constants.
   */
  description: string;
  channel_order_detail_id: null;
  shipper: string;
  tracking_no: string;
};

/**
 * `saveSalesOrderRequest` — spec §4.5 (confirm payment → paid SO).
 *
 * The field set is the dashboard's own create request, captured live
 * 2026-10-28, NOT the doc's required-field list. Reason: `is_paid: true` does
 * not make an order paid on its own. Jubelio inserts the header, then runs its
 * status machine in the same request — and with no `channel_status` handed to
 * it the row lands `internal_status: null` / `wms_status: "UNKNOWN"`, the
 * transition is rejected, and it answers 500 with
 * `Pesanan sudah dipakai di transaksi lain … Status Channel: <NULL>,
 *  Status Sekarang: UNKNOWN, Status Dituju: PAID`.
 * The row stays committed (no rollback), so every retry adds another orphan.
 * The dashboard's identical create came back `internal=PAID, channel=Paid,
 * wms=PAID` — which is what `channel_status`, `store_id` and
 * `is_tax_included` buy us.
 *
 * The optional-looking extras below are all present in that capture; they are
 * sent as constants because Joi validation runs before insert and an
 * unverified field set is what produced four dead SOs.
 */
export type SalesOrderPayload = {
  salesorder_id: 0;
  salesorder_no: "[auto]";
  contact_id: number;
  customer_name: string;
  transaction_date: string;
  location_id: number;
  source: 1;
  /** Target status — the field the paid transition actually reads. */
  channel_status: "paid";
  is_paid: boolean;
  /**
   * Empty string, as every healthy internal SO in this account has it. The
   * `"transfer"` we used to send is not a Jubelio payment method, and our dead
   * row was the only SO in the account carrying it.
   */
  payment_method: string;
  /** -100 = "Toko Default", the internal outlet; NULL store_id was another
   * difference between our dead row and every healthy one. */
  store_id: number;
  is_tax_included: boolean;
  /** Free-text note shown on the SO. The key-set diff against the dashboard
   * capture found this as the one header field we were not sending at all. */
  note: string;
  ref_no: string;
  is_canceled: boolean;
  cancel_reason: string;
  cancel_reason_detail: string;
  shipping_full_name: string;
  shipping_address: string;
  shipping_phone: string;
  shipping_country: string;
  shipping_subdistrict: string | null;
  shipping_area: string | null;
  shipping_city: string | null;
  shipping_province: string | null;
  shipping_post_code: string | null;
  shipping_province_id: string | null;
  shipping_city_id: string | null;
  shipping_district_id: string | null;
  shipping_subdistrict_id: string | null;
  shipping_coordinate: string | null;
  shipping_cost: number;
  shipping_cost_discount: number;
  cod_fee: number;
  cod_fee_discount: number;
  insurance_cost: number;
  service_fee: number;
  add_disc: number;
  add_fee: number;
  order_processing_fee: number;
  use_shipping_insurance: boolean;
  is_cod: boolean;
  is_jubelio_shipment: boolean;
  add_cost_detail: unknown[];
  extra_info: Record<string, unknown>;
  voucher_codes: string[];
  service_category_id: number | null;
  salesmen_id: number | null;
  items: SalesOrderItem[];
  sub_total: number;
  total_disc: number;
  total_tax: number;
  grand_total: number;
};

/* ---------------------------------- client --------------------------------- */

export type JubelioClient = ReturnType<typeof createJubelioClient>;

export function createJubelioClient(token: string) {
  return {
    /**
     * GET /inventory/items/masters — the FULL catalog, no query params.
     * Upstream rejects every param (search, pagination — spec probe
     * 2026-10-26), so filtering happens client-side on the mapped rows.
     */
    async listProducts(): Promise<unknown> {
      return request(token, "/inventory/items/masters", { method: "GET" });
    },

    /** POST /inventory/items/all-stocks/ — all products + stock for this location. */
    async listStock(): Promise<unknown> {
      return request(token, "/inventory/items/all-stocks/", {
        method: "POST",
        body: { location_id: env.JUBELIO_LOCATION_ID },
      });
    },

    /**
     * GET /inventory/v2/?page=1&page_size=2000 — the dashboard's own stock
     * endpoint: SKU-level `total_stocks` + `thumbnail` for the WHOLE catalog
     * in one request (live probe 2026-10-26: 1775 rows; unlike masters, v2
     * accepts query params). No pagination loop needed.
     */
    async listStockV2(): Promise<unknown> {
      return request(token, "/inventory/v2/?page=1&page_size=2000", {
        method: "GET",
      });
    },

    /**
     * GET /inventory/items/by-sku/{sku} — stock for one SKU. No app callers
     * remain (the picker and the roster read the cached v2 map instead); kept
     * per the spec's non-goal of trimming the client surface.
     */
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

    /**
     * GET /sales/orders/ — first page of the sales-order list (spec §4.6).
     * NOT usable for the status sync: 184 072 rows at 200/page, page 1 is 2022
     * marketplace orders, and `page_size`/`sort`/`order` are rejected by their
     * Joi schema (live probe 2026-10-29). Kept for diagnostics only.
     */
    async listSalesOrders(): Promise<unknown> {
      return request(token, "/sales/orders/", { method: "GET" });
    },

    /**
     * GET /sales/orders/{id} — one SO's full header + items. This is what the
     * status sync reads: the header carries `internal_status` (PAID → SHIPPED →
     * COMPLETED / CANCELED) plus `tracking_number` and `shipper` once shipped
     * (live probe 2026-10-29, SO 209/85/192297).
     */
    async getSalesOrder(salesorderId: number): Promise<unknown> {
      return request(token, `/sales/orders/${salesorderId}`, { method: "GET" });
    },

    /** GET /sales/invoices/ — daily sync poll (spec §4.6). */
    async listInvoices(): Promise<unknown> {
      return request(token, "/sales/invoices/", { method: "GET" });
    },
  };
}
