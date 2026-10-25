import { describe, expect, it } from "vitest";

import {
  buildOrderValues,
  buildWaLink,
  evaluateCheckout,
  type EvaluateCheckoutDeps,
  type ProductState,
} from "@/server/checkout";

function product(overrides: Partial<ProductState> = {}): ProductState {
  return {
    sessionProductId: "00000000-0000-0000-0000-000000000001",
    itemId: 101,
    skuCode: "SKU-1",
    itemName: "Test Product",
    availableStock: 5,
    claimed: 0,
    sessionQuota: 10,
    minOrder: 1,
    flashPrice: 50_000,
    ...overrides,
  };
}

function deps(overrides: Partial<EvaluateCheckoutDeps> = {}): EvaluateCheckoutDeps {
  return {
    sessionStatus: "ACTIVE",
    products: new Map(),
    requested: [],
    ...overrides,
  };
}

describe("evaluateCheckout", () => {
  it("blocks when the session is not ACTIVE", () => {
    const result = evaluateCheckout(
      deps({ sessionStatus: "ENDED" }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "SESSION_NOT_ACTIVE" },
    });
  });

  it("blocks when DB stock is insufficient", () => {
    const p = product({ availableStock: 5 });
    const result = evaluateCheckout(
      deps({
        products: new Map([[p.sessionProductId, p]]),
        requested: [{ sessionProductId: p.sessionProductId, qty: 6 }],
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "STOCK_INSUFFICIENT", itemId: 101 },
    });
  });

  it("blocks when claimed + qty exceeds session quota", () => {
    const p = product({ sessionQuota: 4, claimed: 0, availableStock: 100 });
    const result = evaluateCheckout(
      deps({
        products: new Map([[p.sessionProductId, p]]),
        requested: [{ sessionProductId: p.sessionProductId, qty: 5 }],
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "QUOTA_EXCEEDED", itemId: 101 },
    });
  });

  it("blocks when qty is below min order", () => {
    const p = product({ minOrder: 3 });
    const result = evaluateCheckout(
      deps({
        products: new Map([[p.sessionProductId, p]]),
        requested: [{ sessionProductId: p.sessionProductId, qty: 2 }],
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "BELOW_MIN_ORDER", itemId: 101 },
    });
  });

  it("rejects an unknown session product", () => {
    const result = evaluateCheckout(
      deps({
        requested: [{ sessionProductId: "missing", qty: 1 }],
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "UNKNOWN_PRODUCT", sessionProductId: "missing" },
    });
  });

  it("returns lines and grand total on the happy path", () => {
    const p1 = product({
      itemId: 101,
      skuCode: "SKU-1",
      itemName: "First",
      flashPrice: 50_000,
    });
    const p2 = product({
      sessionProductId: "00000000-0000-0000-0000-000000000002",
      itemId: 202,
      skuCode: "SKU-2",
      itemName: "Second",
      flashPrice: 25_000,
    });
    const result = evaluateCheckout(
      deps({
        products: new Map([
          [p1.sessionProductId, p1],
          [p2.sessionProductId, p2],
        ]),
        requested: [
          { sessionProductId: p1.sessionProductId, qty: 2 },
          { sessionProductId: p2.sessionProductId, qty: 3 },
        ],
      }),
    );

    expect(result).toEqual({
      ok: true,
      grandTotal: 175_000,
      lines: [
        {
          sessionProductId: p1.sessionProductId,
          itemId: 101,
          sku: "SKU-1",
          itemName: "First",
          qty: 2,
          price: 50_000,
          subtotal: 100_000,
        },
        {
          sessionProductId: p2.sessionProductId,
          itemId: 202,
          sku: "SKU-2",
          itemName: "Second",
          qty: 3,
          price: 25_000,
          subtotal: 75_000,
        },
      ],
    });
  });
});

describe("buildOrderValues", () => {
  it("carries the three recipient fields verbatim into the order values", () => {
    const values = buildOrderValues(
      {
        recipientName: "Budi Santoso",
        recipientPhone: "081234567890",
        recipientAddress: "Jl. Merdeka No. 1, Jakarta Pusat",
      },
      "customer-1",
      "00000000-0000-0000-0000-000000000009",
      175_000,
    );

    expect(values).toEqual({
      customerId: "customer-1",
      sessionId: "00000000-0000-0000-0000-000000000009",
      status: "UNPAID",
      grandTotal: 175_000,
      paymentMethod: "transfer",
      recipientName: "Budi Santoso",
      recipientPhone: "081234567890",
      recipientAddress: "Jl. Merdeka No. 1, Jakarta Pusat",
    });
  });

  it("maps missing recipient fields to null", () => {
    const values = buildOrderValues({}, "customer-1", "session-1", 50_000);

    expect(values.recipientName).toBeNull();
    expect(values.recipientPhone).toBeNull();
    expect(values.recipientAddress).toBeNull();
  });

  it("maps explicitly undefined recipient fields to null", () => {
    const values = buildOrderValues(
      {
        recipientName: undefined,
        recipientPhone: undefined,
        recipientAddress: undefined,
      },
      "customer-1",
      "session-1",
      50_000,
    );

    expect(values.recipientName).toBeNull();
    expect(values.recipientPhone).toBeNull();
    expect(values.recipientAddress).toBeNull();
  });
});

describe("buildWaLink", () => {
  it("encodes the G6 template into a wa.me link", () => {
    const link = buildWaLink({
      bookingId: "FS-20261025-0001",
      grandTotal: 175_000,
      bank: { bank: "BCA", account_number: "123456", account_name: "Saeful" },
      whatsappNumber: "628123456789",
    });
    expect(link.startsWith("https://wa.me/628123456789?text=")).toBe(true);
    const text = decodeURIComponent(link.split("?text=")[1] ?? "");
    expect(text).toContain("FS-20261025-0001");
    expect(text).toContain("Rp175.000");
    expect(text).toContain("BCA 123456");
    expect(text).toContain("Saeful");
    expect(text).toContain("Bukti transfer terlampir.");
  });
});