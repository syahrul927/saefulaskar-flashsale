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
  soResult: { salesorder_id: number },
): MarkConfirmedPatch {
  return { status: "CONFIRMED", jubelioSoId: soResult.salesorder_id };
}

/** One persisted `order_items` row, narrowed to the fields the SO payload needs. */
export type ConfirmOrderItem = {
  itemId: number;
  sku: string;
  itemName: string;
  qty: number;
  price: number;
  subtotal: number;
};

/** A `contacts` row narrowed to the Jubelio customer fields. */
export type ConfirmContact = {
  jubelioContactId: number | null;
  contactName: string | null;
};

export type ConfirmOrderInput = {
  grandTotal: number;
  createdAt: Date;
  items: ConfirmOrderItem[];
  contact: ConfirmContact;
};

/**
 * Build the Jubelio `saveSalesOrderRequest` payload (spec §4.5). `sub_total`
 * and `grand_total` are taken from the local order; discounts/taxes/fees default
 * to 0 (flash-sale prices already embed the discount).
 */
export function buildSalesOrderPayload(input: ConfirmOrderInput): SalesOrderPayload {
  const items: SalesOrderItem[] = input.items.map((item) => ({
    item_id: item.itemId,
    item_name: item.itemName,
    sku: item.sku,
    qty: item.qty,
    price: item.price,
  }));

  return {
    salesorder_id: 0,
    salesorder_no: "[auto]",
    contact_id: input.contact.jubelioContactId ?? 0,
    customer_name: input.contact.contactName ?? "",
    transaction_date: input.createdAt.toISOString(),
    location_id: env.JUBELIO_LOCATION_ID,
    source: 1,
    is_paid: true,
    payment_method: "transfer",
    items,
    sub_total: input.grandTotal,
    total_disc: 0,
    total_tax: 0,
    grand_total: input.grandTotal,
    add_disc: 0,
    add_fee: 0,
    service_fee: 0,
  };
}