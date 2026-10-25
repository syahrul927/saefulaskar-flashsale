import { z } from "zod";

/**
 * Checkout payload for the recipient snapshot. All three fields are optional
 * (additive to the existing checkout body) and trimmed before they persist.
 */
export const recipientSchema = z.object({
  recipientName: z.string().trim().min(2).max(120).optional(),
  recipientPhone: z.string().trim().min(6).max(20).optional(),
  recipientAddress: z.string().trim().min(10).max(400).optional(),
});

/**
 * SSR-fetched checkout prefill (Task 12): the latest contact per field, or
 * `null` when the shopper has none — the client form renders `null` as an
 * empty input with no "← dari akun Anda" hint.
 */
export type RecipientDefaults = {
  name: string | null;
  phone: string | null;
  address: string | null;
};

/**
 * Resolve the shipping recipient for an order, field by field: the order's own
 * snapshot first, then the linked `contacts` record (orders created before the
 * snapshot columns existed), then `null`.
 *
 * `contact` may be `null` (contact deleted, or the order never linked one) —
 * callers render `null` as an em dash, never crash.
 */
export function resolveRecipient(input: {
  order: {
    recipientName: string | null;
    recipientPhone: string | null;
    recipientAddress: string | null;
  };
  contact: {
    contactName: string | null;
    phone: string | null;
    sAddress: string | null;
  } | null;
}): { name: string | null; phone: string | null; address: string | null } {
  const { order, contact } = input;
  return {
    name: order.recipientName ?? contact?.contactName ?? null,
    phone: order.recipientPhone ?? contact?.phone ?? null,
    address: order.recipientAddress ?? contact?.sAddress ?? null,
  };
}
