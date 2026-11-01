// Customer contact resolution for the cancel surfaces (spec §4.6). The admin's
// `Hubungi pelanggan` button dials the CUSTOMER, and the only honest way to
// learn their number is the same chain the confirm route walks: the contact the
// order links to, else the ORDER CUSTOMER's contact matched through their own
// user row, else the recipient snapshot checkout wrote on the order
// (`src/app/api/orders/[id]/confirm/route.ts:47-75`, batched here). Batched
// because the two doors that need a number — the `Hubungi pelanggan` button in
// an admin row and the same button in the detail dialog — are fed from one list
// page, and the cancel ROUTE never resolves one: the link is already in the row
// the admin clicked.
//
// `Hubungi CS` on the customer surface does NOT use anything in this file: it
// dials the storefront's own `env.WHATSAPP_NUMBER`
// (`src/app/(storefront)/orders/page.tsx:28`), which needs no lookup (spec
// §8.17). Server-only module — a client island may `import type` these shapes,
// never call them.

import { eq, inArray } from "drizzle-orm";

import { contacts, orders, user } from "./db/schema";
import type { StatusReader } from "./status-history";

/**
 * What a cancel surface needs to render one WhatsApp button: the digits
 * `wa.me` accepts and the name to greet. `phone` is always the output of
 * `toWhatsAppNumber`, never raw column text — so a caller that has a
 * `CustomerContact` knows the link is addressed to a real Indonesian number,
 * which is the only promise this type can make. Dropping the button on `null`
 * is how the rest of that promise is kept.
 */
export type CustomerContact = {
  phone: string;
  /** Best name we have. `null` means the message greets nobody, not "Guest". */
  name: string | null;
};

/**
 * E.164 caps at 15 digits; an Indonesian mobile that actually works is never
 * shorter than a `62` + operator + subscriber run. Anything outside this
 * window is a half-typed field, and dialling it opens a stranger's chat or no
 * chat at all.
 */
const MIN_DIGITS = 9;
const MAX_DIGITS = 15;

/**
 * Normalise one stored phone field for `wa.me`, or say there is no number.
 *
 * `wa.me` takes an Indonesian mobile and nothing else, so the rules below
 * recognise the local spellings and REJECT the rest rather than guessing: a
 * wrong-country link looks identical to a right one in the admin's browser and
 * silently opens somebody else's chat, which is worse than no button.
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  // Strip everything that is not a digit. That includes the separators contact
  // data is full of (`-`, spaces, dots, brackets) and the leading `+` itself —
  // after this line the only spelling that can mean "Indonesia" is the `62`,
  // `0` or `008` prefix, so `+62 …` and `62 …` land in the same branch.
  const digits = (raw ?? "").replace(/\D/g, "");

  let national: string;
  if (digits.startsWith("008")) {
    // The international access code written straight in front of a mobile:
    // `00` + `812…` becomes `62` + `812…`.
    national = `62${digits.slice(2)}`;
  } else if (digits.startsWith("00")) {
    // Any OTHER `00…` is an access code followed by a FOREIGN country code
    // (`0044…`). Rewriting it as `62…` would invent an Indonesian number out of
    // a UK one, so it gets the same answer as `+1…` below.
    return null;
  } else if (digits.startsWith("0")) {
    // Local trunk form: `0812…` → `62812…`.
    national = `62${digits.slice(1)}`;
  } else if (digits.startsWith("62")) {
    // Already normalised — including a `+62` that arrived through the strip —
    // with one exception: `+62 0812…` is the same mobile typed with its local
    // leading zero still in front. That zero has to go, because `620812…` sits
    // inside the length window below and would ship as a `wa.me` link to a
    // number that almost certainly does not exist — silently the wrong
    // recipient, which is worse than no button.
    //
    // Dropping it cannot corrupt a correct number: no Indonesian mobile starts
    // its national number with `0`, so `62` + `0…` is never a real subscriber
    // prefix. And the rewrite is idempotent — the result starts `628…`, so
    // normalising it a second time leaves it alone.
    national = digits[2] === "0" ? `62${digits.slice(3)}` : digits;
  } else {
    // `+1 555 0100` → `15550100`: no Indonesian prefix to hang it on, and the
    // guess ("maybe they meant 62") is exactly the wrong-country link above.
    return null;
  }

  if (national.length < MIN_DIGITS || national.length > MAX_DIGITS) return null;
  return national;
}

/**
 * The `wa.me` link an admin clicks to reach a customer about a cancelled
 * order. Same shape as the checkout proof link
 * (`src/server/checkout.ts:192-207`), which is the precedent for encoding the
 * whole message and nothing else.
 *
 * `phone` MUST already be the output of `toWhatsAppNumber` — and in practice it
 * always is, because it comes off `CustomerContact`, which only resolution can
 * build. This is why the function takes a `string` and returns a `string`: a
 * number that failed normalisation never reaches this line at all, so there is
 * no invalid-input branch to return `null` from.
 */
export function buildCustomerWaLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/**
 * The pre-filled message (spec §4.6): name when we have it, the booking id,
 * and what actually happened — customer-facing Bahasa, three lines.
 *
 * The two branches state different facts and must not borrow each other's:
 * money we took is refunded by hand outside the system, so the admin needs the
 * account details; money we never confirmed means nothing to refund and the
 * quota simply went back. No other reason is invented — there is no
 * cancellation-reason field (spec §8.4).
 *
 * `wasPaid` is a boolean the CALLER decides from the order's status (Task 12
 * passes `order.status === "CONFIRMED"`). Nothing here reads a status, so the
 * copy cannot disagree with the row the admin is looking at.
 */
export function cancelMessageText(input: {
  bookingId: string;
  customerName: string | null;
  wasPaid: boolean;
}): string {
  const name = cleanName(input.customerName);
  const greeting = name
    ? `Halo ${name}, pesanan ${input.bookingId} kami batalkan.`
    : `Halo, pesanan ${input.bookingId} kami batalkan.`;
  const body = input.wasPaid
    ? [
        "Pembayaran yang sudah masuk akan kami refund manual, di luar sistem.",
        "Mohon kirim nama bank, nomor rekening, dan atas namanya supaya refund-nya bisa kami proses.",
      ]
    : [
        "Pembayaran untuk pesanan ini belum kami konfirmasi, jadi tidak ada dana yang kembali ke Anda.",
        "Kuota yang tertahan sudah kami lepaskan — silakan buat pesanan baru jika masih dibutuhkan.",
      ];
  return [greeting, ...body].join("\n");
}

/** Trimmed or nothing: a whitespace-only name must not greet as a person. */
function cleanName(value: string | null): string | null {
  const trimmed = value?.trim();
  // `?? null` would be wrong here: an empty string must clean to `null` too,
  // or a blank contact name greets the customer as nobody.
  if (trimmed === undefined || trimmed === "") return null;
  return trimmed;
}

/** One row a chain step joined: an order plus the number and names behind it. */
type ContactCandidate = {
  orderId: string;
  phone: string | null;
  contactName: string | null;
  recipientName: string | null;
};

/**
 * Take one step's candidates: an order is resolved by the FIRST step that
 * offers a number `toWhatsAppNumber` accepts, in chain order. A step that found
 * the order but not a usable number leaves it pending, so the next step still
 * gets asked — resolving it here would produce a link with no digits in it.
 *
 * Both joins are on unique keys (`orders.contact_id → contacts.id`,
 * `contacts.email` is UNIQUE), so a step returns at most one row per order; the
 * first-row-wins lookup below is belt-and-braces, not a fan-out rule.
 */
function takeCandidates(
  rows: readonly ContactCandidate[],
  pending: readonly string[],
  resolved: Map<string, CustomerContact | null>,
): string[] {
  const byOrder = new Map<string, ContactCandidate>();
  for (const row of rows) {
    if (!byOrder.has(row.orderId)) byOrder.set(row.orderId, row);
  }

  const stillPending: string[] = [];
  for (const orderId of pending) {
    const row = byOrder.get(orderId);
    const phone = row === undefined ? null : toWhatsAppNumber(row.phone);
    if (row === undefined || phone === null) {
      stillPending.push(orderId);
      continue;
    }
    resolved.set(orderId, {
      phone,
      name: cleanName(row.contactName) ?? cleanName(row.recipientName),
    });
  }
  return stillPending;
}

/**
 * Phone (and greeting name) for every order in `orderIds`, in at most three
 * queries for the WHOLE list — this runs on a page of rows, not per row.
 *
 * Sequential rather than `Promise.all`, because each step asks only for the ids
 * the step before it could not answer: a page whose orders all link a contact
 * costs one query, and a page whose orders are all resolved by step 2 never
 * builds the snapshot query at all.
 *
 * Every value the Map holds is a number that passed `toWhatsAppNumber`, or
 * `null` for an order the database has with no usable number anywhere — the
 * surface renders no button for those (Review Focus 5). An id the database does
 * not have is absent from the Map entirely, so "no number" and "never looked
 * this up" stay distinguishable.
 */
export async function resolveCustomerContacts(
  db: StatusReader,
  orderIds: readonly string[],
): Promise<Map<string, CustomerContact | null>> {
  const resolved = new Map<string, CustomerContact | null>();

  // An empty tab reaches this line on every visit, and `inArray(col, [])` is
  // still a round trip — the guard, not the empty Map, is the point.
  if (orderIds.length === 0) return resolved;

  // Deduped once up front: a repeated id must not widen an `IN (…)` list, and
  // the Map would silently collapse it anyway.
  let pending = [...new Set(orderIds)];

  // (1) The contact the order itself links to.
  const linked = await db
    .select({
      orderId: orders.id,
      phone: contacts.phone,
      contactName: contacts.contactName,
      recipientName: orders.recipientName,
    })
    .from(orders)
    .innerJoin(contacts, eq(orders.contactId, contacts.id))
    .where(inArray(orders.id, pending));
  pending = takeCandidates(linked, pending, resolved);
  if (pending.length === 0) return resolved;

  // (2) The ORDER CUSTOMER's contact, matched through their own user row. This
  // keys on the email of `orders.customer_id` — never whoever is reading the
  // page: an admin cancelling somebody else's order would otherwise look the
  // number up against their own account and find nothing (the empty
  // `customer_name` bug the confirm route documents at
  // `src/app/api/orders/[id]/confirm/route.ts:47-75`).
  const byEmail = await db
    .select({
      orderId: orders.id,
      phone: contacts.phone,
      contactName: contacts.contactName,
      recipientName: orders.recipientName,
    })
    .from(orders)
    .innerJoin(user, eq(orders.customerId, user.id))
    .innerJoin(contacts, eq(contacts.email, user.email))
    .where(inArray(orders.id, pending));
  pending = takeCandidates(byEmail, pending, resolved);
  if (pending.length === 0) return resolved;

  // (3) The recipient snapshot checkout wrote on the order — no contact row
  // anywhere, so its name is the order's own `recipient_name`.
  //
  // This last select touches `orders` alone, which also settles the `null`
  // case: a row here means the order EXISTS and no step had a number for it,
  // while an id with no row was never in the database and stays out of the Map.
  const snapshot = await db
    .select({
      orderId: orders.id,
      phone: orders.recipientPhone,
      recipientName: orders.recipientName,
    })
    .from(orders)
    .where(inArray(orders.id, pending));
  for (const row of snapshot) {
    const phone = toWhatsAppNumber(row.phone);
    resolved.set(
      row.orderId,
      phone ? { phone, name: cleanName(row.recipientName) } : null,
    );
  }

  return resolved;
}
