import { describe, expect, it } from "vitest";

import {
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
    stockForItem: async () => 5,
    ...overrides,
  };
}

describe("evaluateCheckout", () => {
  it("blocks when the session is not ACTIVE", async () => {
    const result = await evaluateCheckout(
      deps({ sessionStatus: "ENDED" }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "SESSION_NOT_ACTIVE" },
    });
  });

  it("blocks when live stock is insufficient", async () => {
    const p = product();
    const result = await evaluateCheckout(
      deps({
        products: new Map([[p.sessionProductId, p]]),
        requested: [{ sessionProductId: p.sessionProductId, qty: 6 }],
        stockForItem: async () => 5,
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "STOCK_INSUFFICIENT", itemId: 101 },
    });
  });

  it("blocks when stock cannot be determined (null)", async () => {
    const p = product();
    const result = await evaluateCheckout(
      deps({
        products: new Map([[p.sessionProductId, p]]),
        requested: [{ sessionProductId: p.sessionProductId, qty: 1 }],
        stockForItem: async () => null,
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "STOCK_CHECK_FAILED", itemId: 101 },
    });
  });

  it("blocks when claimed + qty exceeds session quota", async () => {
    const p = product({ sessionQuota: 4, claimed: 0 });
    const result = await evaluateCheckout(
      deps({
        products: new Map([[p.sessionProductId, p]]),
        requested: [{ sessionProductId: p.sessionProductId, qty: 5 }],
        stockForItem: async () => 100,
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "QUOTA_EXCEEDED", itemId: 101 },
    });
  });

  it("blocks when qty is below min order", async () => {
    const p = product({ minOrder: 3 });
    const result = await evaluateCheckout(
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

  it("rejects an unknown session product", async () => {
    const result = await evaluateCheckout(
      deps({
        requested: [{ sessionProductId: "missing", qty: 1 }],
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "UNKNOWN_PRODUCT", sessionProductId: "missing" },
    });
  });

  it("returns lines and grand total on the happy path", async () => {
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
    const result = await evaluateCheckout(
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