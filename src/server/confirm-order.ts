import { env } from "@/env";
import type { SalesOrderItem, SalesOrderPayload } from "@/lib/jubelio";

/**
 * Payment-confirmation transition (spec §4.5 Phase 2 / §5.8).
 * Pure so it can be unit-tested without HTTP or the DB.
 */

export type MarkConfirmedInput = {
  status: string;
};

export type MarkConfirmedPatch = {
  status: "CONFIRMED";
  jubelioSoId: number;
};

/**
 * The local status patch after a successful Jubelio SO creation. On failure the
 * route never calls this — the order stays UNPAID and is retried (spec §5.8:
 * never silently revert to UNPAID once an SO exists; here the row simply keeps
 * its prior status because we only mark on success).
 */
export function markConfirmed(
  _order: MarkConfirmedInput,
  salesorderId: number,
): MarkConfirmedPatch {
  return { status: "CONFIRMED", jubelioSoId: salesorderId };
}

/**
 * Pull the created SO's id out of Jubelio's create response.
 *
 * `POST /sales/orders/` answers `{ id: <salesorder_id> }` (`docs/PRD.md` §3.3),
 * NOT `salesorder_id` — that key belongs to the LIST/detail rows, which is what
 * our code assumed. Live damage 2026-10-28: `SO-000192297` was created PAID
 * (`internal=PAID / channel=Paid / wms=PAID`) while the route, reading
 * `data.salesorder_id`, got `undefined`, answered 502 and left the local order
 * UNPAID with `jubelio_so_id NULL` next to a real paid order upstream.
 *
 * Tolerant on purpose: both key spellings, an optional `{ data: … }` envelope,
 * and a numeric string. `0` is rejected — it is the CREATE sentinel we send as
 * `salesorder_id`, never a real id, and storing it would fake a link.
 */
export function readSalesOrderId(data: unknown): number | null {
  const source =
    data && typeof data === "object" && "data" in data &&
    (data as { data: unknown }).data &&
    typeof (data as { data: unknown }).data === "object"
      ? (data as { data: Record<string, unknown> }).data
      : data;
  if (!source || typeof source !== "object") return null;
  const row = source as Record<string, unknown>;
  for (const key of ["id", "salesorder_id"] as const) {
    const value = row[key];
    const n =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : Number.NaN;
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

/** One persisted `order_items` row, narrowed to the fields the SO payload needs. */
export type ConfirmOrderItem = {
  itemId: number;
  sku: string;
  itemName: string;
  qty: number;
  price: number;
  subtotal: number;
  /** Jubelio unit-of-measure name (`uom_name`, probed live: "Buah"). */
  unit: string;
};

/** A `contacts` row narrowed to the Jubelio customer fields. */
export type ConfirmContact = {
  jubelioContactId: number | null;
  contactName: string | null;
};

/** Order-level recipient snapshot — the SO's `shipping_*` block. */
export type ConfirmShipping = {
  fullName: string;
  address: string;
  phone: string;
};

export type ConfirmOrderInput = {
  grandTotal: number;
  createdAt: Date;
  items: ConfirmOrderItem[];
  contact: ConfirmContact;
  shipping: ConfirmShipping;
};

/**
 * Choose the contact for the sales order: the order-linked row first (source of
 * truth at checkout time), else the customer's contact resolved by email —
 * legacy orders created before checkout linked `contact_id` still confirm
 * (root cause of the empty `customer_name` 400). An existing but incomplete
 * order-linked row wins over the fallback; the route surfaces a clear error
 * instead of silently charging a different Jubelio contact.
 */
export function pickConfirmContact<T extends ConfirmContact>(
  orderContact: T | null,
  emailContact: T | null,
): T | null {
  return orderContact ?? emailContact;
}

/**
 * Build the Jubelio `saveSalesOrderRequest` payload (spec §4.5, corrected
 * against the OpenAPI schema + live probe 2026-10-27, then against the
 * dashboard's own create request captured live 2026-10-28). `sub_total` and
 * `grand_total` are taken from the local order; discounts/taxes/fees default
 * to 0 (flash-sale prices already embed the discount).
 *
 * The 2026-10-28 capture is what settled the status problem: our payload
 * created the header and items, then Jubelio's own paid step failed against
 * the row it had just inserted (`Status Sekarang: UNKNOWN, Status Dituju:
 * PAID`) because nothing told it what status to move to — `is_paid` is not
 * that signal, `channel_status` is. Every extra header field below mirrors
 * that capture; do not trim them back without re-running it.
 *
 * Items follow the STRICT upstream Joi schema — `item_name`/`sku`/`qty` keys
 * are rejected with "not allowed" (that was the 400); each line carries
 * `qty_in_base` + `unit` + precomputed `amount` instead. `location_id: -1`
 * (Jubelio default warehouse) is the probed-valid value for both order and
 * item rows; the `JUBELIO_LOCATION_ID` value fails the `location_soheader` FK.
 *
 * Throws when the contact resolves to no customer name: Jubelio rejects an
 * empty `customer_name` with a bare 400, so failing fast here keeps the order
 * retryable and gives the admin a specific, actionable message.
 */
/** Internal outlet every healthy internal SO in this account carries. */
const JUBELIO_INTERNAL_STORE_ID = -100;

export function buildSalesOrderPayload(input: ConfirmOrderInput): SalesOrderPayload {
  const customerName = input.contact.contactName?.trim() ?? "";
  if (!customerName) {
    throw new Error(
      "customer_name is empty: the order has no registered Jubelio contact (customer onboarding incomplete)",
    );
  }
  const items: SalesOrderItem[] = input.items.map((item) => ({
    salesorder_detail_id: 0,
    item_id: item.itemId,
    qty_in_base: item.qty,
    unit: item.unit,
    price: item.price,
    amount: item.qty * item.price,
    disc: 0,
    disc_amount: 0,
    tax_amount: 0,
    tax_id: 1,
    location_id: env.JUBELIO_LOCATION_ID,
    description: item.itemName,
    channel_order_detail_id: null,
    shipper: "",
    tracking_no: "",
  }));

  return {
    salesorder_id: 0,
    salesorder_no: "[auto]",
    contact_id: input.contact.jubelioContactId ?? 0,
    customer_name: customerName,
    transaction_date: input.createdAt.toISOString(),
    location_id: env.JUBELIO_LOCATION_ID,
    source: 1,
    // The paid transition reads this; `is_paid` alone leaves the row at
    // `wms_status: "UNKNOWN"` and Jubelio then rejects its own
    // UNKNOWN → PAID step. See `SalesOrderPayload`.
    channel_status: "paid",
    is_paid: true,
    payment_method: "",
    store_id: JUBELIO_INTERNAL_STORE_ID,
    is_tax_included: false,
    // Empty, unlike the operator's typed "TESTING" in the capture — the field
    // has to be present for the payload to mirror the reference request.
    note: "",
    ref_no: "",
    is_canceled: false,
    cancel_reason: "",
    cancel_reason_detail: "",
    shipping_full_name: input.shipping.fullName,
    shipping_address: input.shipping.address,
    shipping_phone: input.shipping.phone,
    shipping_country: "",
    shipping_subdistrict: null,
    shipping_area: null,
    shipping_city: null,
    shipping_province: null,
    shipping_post_code: null,
    shipping_province_id: null,
    shipping_city_id: null,
    shipping_district_id: null,
    shipping_subdistrict_id: null,
    shipping_coordinate: null,
    shipping_cost: 0,
    shipping_cost_discount: 0,
    cod_fee: 0,
    cod_fee_discount: 0,
    insurance_cost: 0,
    service_fee: 0,
    add_disc: 0,
    add_fee: 0,
    order_processing_fee: 0,
    use_shipping_insurance: false,
    is_cod: false,
    is_jubelio_shipment: false,
    add_cost_detail: [],
    extra_info: {},
    voucher_codes: [],
    service_category_id: null,
    salesmen_id: null,
    items,
    sub_total: input.grandTotal,
    total_disc: 0,
    total_tax: 0,
    grand_total: input.grandTotal,
  };
}