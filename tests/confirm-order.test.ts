import { describe, expect, it } from "vitest";

import {
  buildSalesOrderPayload,
  markConfirmed,
  type ConfirmOrderInput,
} from "@/server/confirm-order";

describe("markConfirmed", () => {
  it("maps a successful SO into CONFIRMED + jubelioSoId", () => {
    expect(
      markConfirmed({ status: "UNPAID" }, { salesorder_id: 99123 }),
    ).toEqual({ status: "CONFIRMED", jubelioSoId: 99123 });
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
      items: [
        {
          itemId: 101,
          sku: "SKU-1",
          itemName: "First",
          qty: 2,
          price: 50_000,
          subtotal: 100_000,
        },
      ],
    };

    const payload = buildSalesOrderPayload(input);

    expect(payload.salesorder_id).toBe(0);
    expect(payload.salesorder_no).toBe("[auto]");
    expect(payload.contact_id).toBe(42);
    expect(payload.customer_name).toBe("Toko Maju");
    expect(payload.is_paid).toBe(true);
    expect(payload.payment_method).toBe("transfer");
    expect(payload.sub_total).toBe(175_000);
    expect(payload.grand_total).toBe(175_000);
    expect(payload.items).toEqual([
      {
        item_id: 101,
        item_name: "First",
        sku: "SKU-1",
        qty: 2,
        price: 50_000,
      },
    ]);
  });

  it("falls back to contact_id 0 and empty name when the contact is empty", () => {
    const payload = buildSalesOrderPayload({
      grandTotal: 10_000,
      createdAt: new Date("2026-10-25T00:00:00.000Z"),
      contact: { jubelioContactId: null, contactName: null },
      items: [],
    });
    expect(payload.contact_id).toBe(0);
    expect(payload.customer_name).toBe("");
    expect(payload.items).toEqual([]);
  });
});