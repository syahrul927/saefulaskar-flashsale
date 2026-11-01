import { describe, expect, it } from "vitest";

import {
  buildSalesOrderPayload,
  markConfirmed,
  pickConfirmContact,
  readSalesOrderId,
  type ConfirmContact,
  type ConfirmOrderInput,
  type ConfirmOrderItem,
} from "@/server/confirm-order";

describe("markConfirmed", () => {
  it("maps a successful SO into CONFIRMED + jubelioSoId", () => {
    expect(markConfirmed({ status: "UNPAID" }, 99123)).toEqual({
      status: "CONFIRMED",
      jubelioSoId: 99123,
    });
  });
});

/**
 * The response half of the create call. Live evidence 2026-10-28: our payload
 * created `SO-000192297` (`internal=PAID, channel=Paid, wms=PAID`), the route
 * read `data.salesorder_id`, found `undefined`, and answered 502 — leaving a
 * PAID sales order upstream with a local order still UNPAID and
 * `jubelio_so_id NULL`. `docs/PRD.md` §3.3 documents the shape as
 * `Response: { id: <salesorder_id> }`; every SO this account already has came
 * from elsewhere, so nothing in our code had ever parsed it before.
 */
describe("readSalesOrderId", () => {
  it("reads the documented `{ id }` response", () => {
    expect(readSalesOrderId({ id: 192297 })).toBe(192297);
  });

  it("still reads `salesorder_id` (the list/detail key, and what we assumed)", () => {
    expect(readSalesOrderId({ salesorder_id: 555 })).toBe(555);
  });

  it("unwraps a `{ data: … }` envelope", () => {
    expect(readSalesOrderId({ data: { id: 7 } })).toBe(7);
    expect(readSalesOrderId({ data: { salesorder_id: 8 } })).toBe(8);
  });

  it("coerces a numeric string id", () => {
    expect(readSalesOrderId({ id: "192297" })).toBe(192297);
  });

  it("returns null when there is no usable id — 0 included", () => {
    // `0` is the CREATE sentinel we send as `salesorder_id`; echoing it back
    // must never be stored as a real SO id.
    expect(readSalesOrderId({ id: 0 })).toBeNull();
    expect(readSalesOrderId({ id: "abc" })).toBeNull();
    expect(readSalesOrderId({})).toBeNull();
    expect(readSalesOrderId(null)).toBeNull();
    expect(readSalesOrderId(undefined)).toBeNull();
    expect(readSalesOrderId("nope")).toBeNull();
  });
});

describe("buildSalesOrderPayload", () => {
  it("maps items and order totals into the Jubelio SO shape", () => {
    const input: ConfirmOrderInput = {
      grandTotal: 175_000,
      createdAt: new Date("2026-10-25T12:00:00.000Z"),
      contact: {
        jubelioContactId: 42,
        contactName: "Toko Maju",
      },
      shipping: {
        fullName: "Toko Maju",
        address: "Jl. Melati 1",
        phone: "0812345678",
      },
      items: [
        {
          itemId: 101,
          sku: "SKU-1",
          itemName: "First",
          qty: 2,
          price: 50_000,
          subtotal: 100_000,
          unit: "Buah",
        },
      ],
    };

    const payload = buildSalesOrderPayload(input);

    expect(payload.salesorder_id).toBe(0);
    expect(payload.salesorder_no).toBe("[auto]");
    expect(payload.contact_id).toBe(42);
    expect(payload.customer_name).toBe("Toko Maju");
    expect(payload.is_paid).toBe(true);
    expect(payload.sub_total).toBe(175_000);
    expect(payload.grand_total).toBe(175_000);
    expect(payload.items).toEqual([
      {
        salesorder_detail_id: 0,
        item_id: 101,
        qty_in_base: 2,
        unit: "Buah",
        price: 50_000,
        amount: 100_000,
        disc: 0,
        disc_amount: 0,
        tax_amount: 0,
        tax_id: 1,
        location_id: 1,
        description: "First",
        channel_order_detail_id: null,
        shipper: "",
        tracking_no: "",
      },
    ]);
  });

  it("sends contact_id 0 when the contact exists but has no Jubelio id", () => {
    const payload = buildSalesOrderPayload({
      grandTotal: 10_000,
      createdAt: new Date("2026-10-25T00:00:00.000Z"),
      contact: { jubelioContactId: null, contactName: "Toko Baru" },
      shipping: { fullName: "Toko Baru", address: "", phone: "" },
      items: [],
    });
    expect(payload.contact_id).toBe(0);
    expect(payload.customer_name).toBe("Toko Baru");
    expect(payload.items).toEqual([]);
  });

  it("refuses to build a payload without a customer name (Jubelio rejects empty)", () => {
    expect(() =>
      buildSalesOrderPayload({
        grandTotal: 10_000,
        createdAt: new Date("2026-10-25T00:00:00.000Z"),
        contact: { jubelioContactId: null, contactName: null },
        shipping: { fullName: "", address: "", phone: "" },
        items: [],
      }),
    ).toThrow(/customer_name/);
  });
});

describe("buildSalesOrderPayload items", () => {
  const item: ConfirmOrderItem = {
    itemId: 101,
    sku: "SKU-1",
    itemName: "First",
    qty: 2,
    price: 50_000,
    subtotal: 100_000,
    unit: "Buah",
  };
  const input: ConfirmOrderInput = {
    grandTotal: 175_000,
    createdAt: new Date("2026-10-25T12:00:00.000Z"),
    contact: { jubelioContactId: 42, contactName: "Toko Maju" },
    shipping: {
      fullName: "Toko Maju",
      address: "Jl. Melati 1",
      phone: "0812345678",
    },
    items: [item],
  };

  it("maps each item into the Jubelio saveSalesOrderRequest line shape", () => {
    const payload = buildSalesOrderPayload(input);
    // OpenAPI `saveSalesOrderRequest.items[]` — strict Joi schema rejects
    // item_name/sku/qty keys (live probe 2026-10-27).
    expect(payload.items).toEqual([
      {
        salesorder_detail_id: 0,
        item_id: 101,
        qty_in_base: 2,
        unit: "Buah",
        price: 50_000,
        amount: 100_000,
        disc: 0,
        disc_amount: 0,
        tax_amount: 0,
        tax_id: 1,
        location_id: 1,
        description: "First",
        channel_order_detail_id: null,
        shipper: "",
        tracking_no: "",
      },
    ]);
  });

  it("computes amount as qty × price", () => {
    const payload = buildSalesOrderPayload(input);
    expect(payload.items[0]?.amount).toBe(100_000);
  });

  it("sends unit from the per-item uom (probed live: 'Buah')", () => {
    const payload = buildSalesOrderPayload({
      ...input,
      items: [{ ...item, unit: "Botol" }],
    });
    expect(payload.items[0]?.unit).toBe("Botol");
  });
});

/**
 * The paid-transition fields. Live evidence 2026-10-28: the same cart sent
 * through our builder created `SO-000192290`, which Jubelio left with
 * `internal_status: null`, `channel_status: null`, `wms_status: "UNKNOWN"`
 * and rejected in the same request —
 * `Pesanan sudah dipakai di transaksi lain … Status Channel: <NULL>,
 *  Status Sekarang: UNKNOWN, Status Dituju: PAID`.
 * The same cart created by the Jubelio dashboard (`SO-000192292`) came back
 * `internal=PAID, channel=Paid, wms=PAID`, and its captured request is the
 * reference these assertions encode. Jubelio does NOT derive the paid status
 * from `is_paid` alone — the status must be handed to it.
 */
describe("buildSalesOrderPayload paid-transition fields", () => {
  const base: ConfirmOrderInput = {
    grandTotal: 480_000,
    createdAt: new Date("2026-10-28T16:12:10.927Z"),
    contact: { jubelioContactId: 195465, contactName: "PT Suka Maju Mundur" },
    shipping: {
      fullName: "PT Suka Maju Mundur",
      address: "Perumahan Taman Alamanda Blok A16 No27",
      phone: "0813992002922",
    },
    items: [
      {
        itemId: 2895,
        sku: "10-SA000187NC",
        itemName: "[Dus] PIN SOCKET Controller Sinus - 10pcs",
        qty: 20,
        price: 9_000,
        subtotal: 180_000,
        unit: "Buah",
      },
    ],
  };

  it("hands Jubelio the target status explicitly", () => {
    const payload = buildSalesOrderPayload(base);
    expect(payload.channel_status).toBe("paid");
    expect(payload.is_paid).toBe(true);
  });

  it("sends the store + tax + reference defaults the dashboard sends", () => {
    const payload = buildSalesOrderPayload(base);
    // -100 = "Toko Default", the internal outlet every healthy internal SO
    // in this account carries; our dead row had store_id NULL.
    expect(payload.store_id).toBe(-100);
    expect(payload.is_tax_included).toBe(false);
    expect(payload.ref_no).toBe("");
  });

  it("sends no payment_method string — 'transfer' is not a Jubelio method", () => {
    const payload = buildSalesOrderPayload(base);
    // Healthy internal SOs sit at internal_status PAID with payment_method "".
    // Our dead row was the only one in the account carrying "transfer".
    expect(payload.payment_method).toBe("");
  });

  it("sends the cancel/extra header fields the dashboard sends", () => {
    const payload = buildSalesOrderPayload(base);
    expect(payload.is_canceled).toBe(false);
    expect(payload.cancel_reason).toBe("");
    expect(payload.cancel_reason_detail).toBe("");
    expect(payload.use_shipping_insurance).toBe(false);
    expect(payload.is_cod).toBe(false);
    expect(payload.is_jubelio_shipment).toBe(false);
    expect(payload.add_cost_detail).toEqual([]);
    expect(payload.voucher_codes).toEqual([]);
    expect(payload.extra_info).toEqual({});
    expect(payload.order_processing_fee).toBe(0);
    expect(payload.shipping_cost).toBe(0);
    expect(payload.insurance_cost).toBe(0);
  });

  it("sends the `note` field the capture carries", () => {
    const payload = buildSalesOrderPayload(base);
    // Key-set diff of our payload against the captured dashboard request:
    // `note` was the single header field missing. Empty string — the
    // dashboard's own value there was the operator's typed "TESTING".
    expect(payload.note).toBe("");
  });

  it("carries the recipient snapshot into the shipping block", () => {
    const payload = buildSalesOrderPayload(base);
    expect(payload.shipping_full_name).toBe("PT Suka Maju Mundur");
    expect(payload.shipping_address).toBe("Perumahan Taman Alamanda Blok A16 No27");
    expect(payload.shipping_phone).toBe("0813992002922");
  });
});

/**
 * Field-set contract, taken verbatim from the dashboard capture. Deleting a
 * key here means deleting it from the request Jubelio answers to — the four
 * dead `UNKNOWN` SOs of 2026-10-28 were what "looks optional" cost us.
 */
describe("buildSalesOrderPayload field-set contract", () => {
  it("sends exactly the header keys the dashboard sends", () => {
    const payload = buildSalesOrderPayload({
      grandTotal: 480_000,
      createdAt: new Date("2026-10-28T16:20:58.137Z"),
      contact: { jubelioContactId: 195465, contactName: "PT Suka Maju Mundur" },
      shipping: {
        fullName: "PT Suka Maju Mundur",
        address: "Perumahan Taman Alamanda Blok A16 No27",
        phone: "0813992002922",
      },
      items: [
        {
          itemId: 2895,
          sku: "10-SA000187NC",
          itemName: "[Dus] PIN SOCKET Controller Sinus - 10pcs",
          qty: 20,
          price: 9_000,
          subtotal: 180_000,
          unit: "Buah",
        },
      ],
    });
    expect(Object.keys(payload).sort()).toEqual(
      [
        "salesorder_no", "salesorder_id", "shipping_full_name", "shipping_address",
        "shipping_subdistrict", "shipping_area", "shipping_city", "shipping_province",
        "shipping_post_code", "shipping_country", "shipping_province_id",
        "shipping_city_id", "shipping_district_id", "shipping_subdistrict_id",
        "shipping_coordinate", "transaction_date", "is_tax_included", "note", "ref_no",
        "store_id", "is_canceled", "cancel_reason", "cancel_reason_detail",
        "shipping_cost", "shipping_cost_discount", "cod_fee", "cod_fee_discount",
        "insurance_cost", "service_fee", "shipping_phone", "channel_status", "add_disc",
        "add_fee", "payment_method", "items", "is_paid", "use_shipping_insurance",
        "source", "add_cost_detail", "order_processing_fee", "is_cod", "extra_info",
        "contact_id", "customer_name", "salesmen_id", "location_id", "sub_total",
        "total_disc", "total_tax", "grand_total", "is_jubelio_shipment",
        "service_category_id", "voucher_codes",
      ].sort(),
    );
    expect(Object.keys(payload.items[0] ?? {}).sort()).toEqual(
      [
        "item_id", "price", "qty_in_base", "description", "disc", "disc_amount",
        "salesorder_detail_id", "amount", "unit", "tax_id", "channel_order_detail_id",
        "tax_amount", "shipper", "location_id", "tracking_no",
      ].sort(),
    );
  });
});

describe("pickConfirmContact", () => {
  // Both arguments are the SAME `contacts` row shape at the call site (the
  // route passes two lookups of one table), so the fixtures share the type —
  // that is what the return generic resolves to.
  const ORDER_LINKED: ConfirmContact = {
    jubelioContactId: 1,
    contactName: "Order Contact",
  };
  const BY_EMAIL: ConfirmContact = {
    jubelioContactId: 2,
    contactName: "Email Contact",
  };

  it("prefers the order-linked contact", () => {
    expect(pickConfirmContact(ORDER_LINKED, BY_EMAIL)).toEqual(ORDER_LINKED);
  });

  it("falls back to the email-resolved contact for legacy orders without contactId", () => {
    expect(pickConfirmContact(null, BY_EMAIL)).toEqual(BY_EMAIL);
  });

  it("returns null when neither lookup finds a contact", () => {
    expect(pickConfirmContact(null, null)).toBeNull();
  });

  it("does not fall back when the order-linked contact exists but is incomplete", () => {
    const partial: ConfirmContact = {
      jubelioContactId: null,
      contactName: "Ada Nama",
    };
    expect(pickConfirmContact(partial, BY_EMAIL)).toEqual(partial);
  });
});