/**
 * Checkout guard — pure, testable core (spec §4.4).
 *
 * `evaluateCheckout` is deliberately free of HTTP/db so it can be unit-tested:
 * stock re-check and the product table are injected via `deps`. The route
 * handler (`src/app/api/orders/route.ts`) supplies real implementations.
 */

/** One bank account from `env.BANK_ACCOUNTS` (JSON array). */
export type BankAccount = {
  bank: string;
  account_number: string;
  account_name: string;
};

/** Parse the raw `BANK_ACCOUNTS` JSON string; empty list on malformed input. */
export function parseBankAccounts(raw: string): BankAccount[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is BankAccount =>
        !!row &&
        typeof row === "object" &&
        typeof (row as BankAccount).bank === "string" &&
        typeof (row as BankAccount).account_number === "string" &&
        typeof (row as BankAccount).account_name === "string",
    );
  } catch {
    return [];
  }
}

/** Snapshot of a `session_products` row needed to validate one cart line. */
export type ProductState = {
  sessionProductId: string;
  itemId: number;
  skuCode: string;
  itemName: string;
  /** DB-stored Jubelio stock snapshot (`session_products.jubelio_stock`). */
  availableStock: number;
  claimed: number;
  sessionQuota: number;
  minOrder: number;
  flashPrice: number;
};

/** A persisted order line (mirrors `order_items` columns). */
export type CheckoutLine = {
  sessionProductId: string;
  itemId: number;
  sku: string;
  itemName: string;
  qty: number;
  price: number;
  subtotal: number;
};

export type CheckoutErrorCode =
  | "SESSION_NOT_ACTIVE"
  | "UNKNOWN_PRODUCT"
  | "STOCK_INSUFFICIENT"
  | "QUOTA_EXCEEDED"
  | "BELOW_MIN_ORDER";

export type CheckoutError = {
  code: CheckoutErrorCode;
  /** Present when the failure is specific to one product line. */
  itemId?: number;
  sessionProductId?: string;
};

export type EvaluateCheckoutDeps = {
  sessionStatus: string;
  products: Map<string, ProductState>;
  requested: Array<{ sessionProductId: string; qty: number }>;
};

export type EvaluateCheckoutResult =
  | { ok: true; lines: CheckoutLine[]; grandTotal: number }
  | { ok: false; error: CheckoutError };

/**
 * Validate a cart against a session. Check order matters (spec §4.4):
 *   1. session ACTIVE
 *   2. DB-stored `availableStock >= qty`
 *   3. `claimed + qty <= sessionQuota`
 *   4. `qty >= minOrder`
 *
 * Stock is the local DB snapshot (`session_products.jubelio_stock`) — customers
 * don't hold a Jubelio account, so there is no live per-cart recheck here.
 */
export function evaluateCheckout(
  deps: EvaluateCheckoutDeps,
): EvaluateCheckoutResult {
  if (deps.sessionStatus !== "ACTIVE") {
    return { ok: false, error: { code: "SESSION_NOT_ACTIVE" } };
  }

  const lines: CheckoutLine[] = [];
  let grandTotal = 0;

  for (const req of deps.requested) {
    const product = deps.products.get(req.sessionProductId);
    if (!product) {
      return {
        ok: false,
        error: {
          code: "UNKNOWN_PRODUCT",
          sessionProductId: req.sessionProductId,
        },
      };
    }

    if (product.availableStock < req.qty) {
      return {
        ok: false,
        error: { code: "STOCK_INSUFFICIENT", itemId: product.itemId },
      };
    }
    if (product.claimed + req.qty > product.sessionQuota) {
      return {
        ok: false,
        error: { code: "QUOTA_EXCEEDED", itemId: product.itemId },
      };
    }
    if (req.qty < product.minOrder) {
      return {
        ok: false,
        error: { code: "BELOW_MIN_ORDER", itemId: product.itemId },
      };
    }

    const subtotal = req.qty * product.flashPrice;
    lines.push({
      sessionProductId: product.sessionProductId,
      itemId: product.itemId,
      sku: product.skuCode,
      itemName: product.itemName,
      qty: req.qty,
      price: product.flashPrice,
      subtotal,
    });
    grandTotal += subtotal;
  }

  return { ok: true, lines, grandTotal };
}

/** Recipient fields a checkout body may carry (see `recipientSchema`). */
export type CheckoutRecipientInput = {
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientAddress?: string | null;
};

/**
 * Build the `orders` insert values from a validated checkout body (Task 12).
 * Pure so the recipient-snapshot rule is unit-testable: the three recipient
 * fields land verbatim on the order, and missing/undefined inputs persist as
 * `null` (never `undefined` — the columns are nullable and the receipt layer
 * renders `null` as an em dash). `evaluateCheckout` stays untouched; this is
 * the snapshot half of the same guard file. `contactId` is the customer's
 * registered `contacts` row (resolved by email in the route) so payment
 * confirmation can build the Jubelio sales order without a re-lookup; `null`
 * when the customer never completed onboarding.
 */
export function buildOrderValues(
  body: CheckoutRecipientInput & { contactId?: string | null },
  customerId: string,
  sessionId: string,
  grandTotal: number,
  contactId: string | null = null,
) {
  return {
    customerId,
    sessionId,
    status: "UNPAID" as const,
    grandTotal,
    paymentMethod: "transfer",
    recipientName: body.recipientName ?? null,
    recipientPhone: body.recipientPhone ?? null,
    recipientAddress: body.recipientAddress ?? null,
    contactId,
  };
}

/**
 * Build the pre-filled WhatsApp "proof of transfer" link (spec §5.2, template G6).
 * The number is `WHATSAPP_NUMBER` without the leading `+` (already `wa.me`-ready).
 */
export function buildWaLink(input: {
  bookingId: string;
  grandTotal: number;
  bank: BankAccount;
  whatsappNumber: string;
}): string {
  const formattedTotal = new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(input.grandTotal);
  const text =
    `Halo, saya sudah transfer untuk pesanan ${input.bookingId} sejumlah ` +
    `Rp${formattedTotal} ke rekening ${input.bank.bank} ` +
    `${input.bank.account_number} atas nama ${input.bank.account_name}. ` +
    `Bukti transfer terlampir.`;
  return `https://wa.me/${input.whatsappNumber}?text=${encodeURIComponent(text)}`;
}