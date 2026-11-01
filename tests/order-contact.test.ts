import { describe, expect, it } from "vitest";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  buildCustomerWaLink,
  cancelMessageText,
  resolveCustomerContacts,
  toWhatsAppNumber,
} from "@/server/order-contact";
import { contacts, orders, user } from "@/server/db/schema";

/**
 * The number behind the admin's `Hubungi pelanggan` button. Every rule here
 * earns its place the same way: a wrong one is not a cosmetic bug, it is a
 * link that opens a stranger's chat (or nothing) from a cancelled order the
 * customer is waiting on. Review Focus 5 — no number, no button, never a dead
 * link.
 */
describe("toWhatsAppNumber", () => {
  /**
   * Every spelling Indonesian contact data actually arrives in, mapped to the
   * digits `wa.me` wants. Expected values are literal: a test that computes
   * its own expectation from the input would pass even when the rules do not.
   */
  const LOCAL: readonly [raw: string, want: string][] = [
    ["0812-8877-1042", "6281288771042"],
    ["006281288771042", "6281288771042"],
    ["+62 812 8877 1042", "6281288771042"],
    ["6281288771042", "6281288771042"],
    // Country code typed with the local leading zero left in front of the
    // mobile. The only spelling that needs a digit REMOVED rather than a prefix
    // swapped — `620812…` is inside the length window, so keeping the zero
    // ships a link, not a `null`.
    ["62 0812 8877 1042", "6281288771042"],
    ["+62 0812-8877-1042", "6281288771042"],
    // `00` in place of `+`, country spelled out: the one `00…` prefix whose
    // country is stated in the input, so it strips to the case above.
    ["0062 0812 8877 1042", "6281288771042"],
  ];

  it("normalises every local spelling of an Indonesian number to 62…", () => {
    for (const [raw, want] of LOCAL) {
      expect(toWhatsAppNumber(raw), raw).toBe(want);
    }
  });

  it("keeps an already-normalised number untouched", () => {
    // The second normalise must not eat the `62` it just produced — the
    // resolver normalises once, but a caller re-checking must stay safe.
    for (const [, digits] of LOCAL) {
      expect(toWhatsAppNumber(digits), digits).toBe(digits);
    }
    // Spelled out for the trunk-zero input: one pass and two passes must land
    // on the same digits, or a caller that re-checks shifts the number by one.
    const once = toWhatsAppNumber("0812-8877-1042");
    expect(once).toBe("6281288771042");
    expect(toWhatsAppNumber(once)).toBe("6281288771042");
  });

  /**
   * `null` is the only acceptable answer for these: the surface drops the
   * button, so a wrong-country or half-typed number can never reach a click.
   * `0044…` belongs in this list rather than only in the test below, because a
   * future edit that folds the two `00` branches together has to go red HERE —
   * that is the table a reader trusts, not the one that explains the rule.
   * `0081288771042` and `021 555 1234` are in it for the same reason: they are
   * the two shapes that USED to normalise to something in-window and clickable
   * (`6281288771042` from a Tokyo number, `62215551234` from a Jakarta office),
   * so a rule that drifts back — reviving the `008…` rewrite or dropping the
   * mobile requirement — fails on the contract table, not on a comment.
   */
  const DEAD: readonly (string | null | undefined)[] = [
    null,
    undefined,
    "",
    "   ",
    "-",
    "12345",
    "bukan nomor",
    "+1 555 0100",
    "00442079460958",
    "0081288771042",
    "021 555 1234",
  ];

  it("returns null rather than a dead link for anything unusable", () => {
    for (const raw of DEAD) {
      expect(toWhatsAppNumber(raw), String(raw)).toBeNull();
    }
  });

  it("refuses to dress a foreign number in an Indonesian country code", () => {
    // `00` is the international access code, so `00` + anything is `00` + a
    // COUNTRY code. `0044…` is a UK number typed by hand and `0081 90…` is a
    // Japanese mobile; rewriting either leading-`00` string as `62…` hands the
    // admin a well-shaped Indonesian link belonging to somebody abroad.
    expect(toWhatsAppNumber("00442079460958")).toBeNull();
    expect(toWhatsAppNumber("+44 20 7946 0958")).toBeNull();
    expect(toWhatsAppNumber("00819012345678")).toBeNull();
    // The `0…` branch stays, by contrast: `0` is never a country code, so a
    // leading-`0` string can only be a domestic spelling.
    expect(toWhatsAppNumber("081288771042")).toBe("6281288771042");
  });

  it("requires an Indonesian MOBILE, not merely a 62-prefixed number", () => {
    // Fixed lines take area codes `21`–`76`, so `62` + `21…` is an office, not
    // the buyer. Length alone would have accepted it — `021 555 1234` is 11
    // digits once the trunk rewrite is done.
    expect(toWhatsAppNumber("021-555-1234")).toBeNull();
    expect(toWhatsAppNumber("62215551234")).toBeNull();
    expect(toWhatsAppNumber("+62 21 555 1234")).toBeNull();
    expect(toWhatsAppNumber("628123456")).toBe("628123456"); // `628` is the shape
  });

  it("holds the result inside the 9–15 digit window", () => {
    expect(toWhatsAppNumber("628123456")).toBe("628123456"); // 9 — shortest accepted
    expect(toWhatsAppNumber("62812345")).toBeNull(); // 8
    expect(toWhatsAppNumber("628123456789012")).toBe("628123456789012"); // 15
    expect(toWhatsAppNumber("6281234567890123")).toBeNull(); // 16
    expect(toWhatsAppNumber("0812")).toBeNull(); // trunk rewrite, still too short
  });
});

describe("buildCustomerWaLink", () => {
  it("builds an encoded wa.me link", () => {
    expect(
      buildCustomerWaLink("6281288771042", "Halo Rina\nPesanan FS-1 dibatalkan."),
    ).toBe(
      "https://wa.me/6281288771042?text=Halo%20Rina%0APesanan%20FS-1%20dibatalkan.",
    );
  });
});

describe("cancelMessageText", () => {
  it("states the refund when the customer already paid, and does not when they did not", () => {
    expect(cancelMessageText({ bookingId: "FS-1", customerName: "Rina", wasPaid: true })).toMatch(/FS-1/);
    expect(cancelMessageText({ bookingId: "FS-1", customerName: "Rina", wasPaid: true })).toMatch(/refund|kembali/i);
    expect(cancelMessageText({ bookingId: "FS-1", customerName: null, wasPaid: false })).not.toMatch(/refund/i);
    expect(cancelMessageText({ bookingId: "FS-1", customerName: null, wasPaid: false })).toMatch(/FS-1/);
  });

  it("is three lines and greets the customer by name only when we have one", () => {
    const named = cancelMessageText({ bookingId: "FS-1", customerName: "Rina", wasPaid: true });
    expect(named.split("\n")).toHaveLength(3);
    expect(named.split("\n")[0]).toBe("Halo Rina, pesanan FS-1 kami batalkan.");

    const anonymous = cancelMessageText({ bookingId: "FS-1", customerName: null, wasPaid: false });
    expect(anonymous.split("\n")).toHaveLength(3);
    // No invented name and no template hole — just a greeting with nobody in it.
    expect(anonymous.split("\n")[0]).toBe("Halo, pesanan FS-1 kami batalkan.");
  });

  it("asks for account details only for money we actually took", () => {
    const paid = cancelMessageText({ bookingId: "FS-1", customerName: null, wasPaid: true });
    expect(paid).toMatch(/rekening/i);
    expect(paid).toMatch(/manual|di luar sistem/i);

    const unpaid = cancelMessageText({ bookingId: "FS-1", customerName: null, wasPaid: false });
    expect(unpaid).not.toMatch(/rekening/i);
    // The two facts the plan allows for this branch, and nothing else: no
    // confirmed payment arrived, and the quota went back.
    expect(unpaid).toMatch(/belum kami konfirmasi/i);
    expect(unpaid).toMatch(/kuota/i);
  });

  it("carries no placeholder-looking text in either branch", () => {
    for (const wasPaid of [true, false]) {
      const text = cancelMessageText({ bookingId: "FS-1", customerName: null, wasPaid });
      expect(text).not.toMatch(/\[[^\]]*\]|\{\{|\bTBD\b|<[^>]*>/i);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Resolution: a select-only fake that actually joins.
 * ------------------------------------------------------------------ */

/**
 * The `tests/confirm-route.test.ts:33-117` per-table capture, widened to the
 * join shape: this module's three queries all start at `orders`, so a fake
 * keyed on `.from()` alone would answer all three with the same rows and prove
 * nothing about the chain. Instead the fake keeps the three tables as data and
 * evaluates the ON clauses it is handed (reading the real drizzle columns off
 * the condition), then filters by the `WHERE` it is handed and projects the
 * `SELECT` map it is handed.
 *
 * That costs a few more lines than a fixture lookup and buys the things that
 * matter here: joining on the wrong column (`contacts.email = orders.customer_id`)
 * returns no rows instead of the answer the test wanted, an `inArray` on the
 * wrong column filters nothing, and `contactId IS NULL` drops out of the inner
 * join exactly the way a real inner join drops it.
 */
type TableName = "orders" | "contacts" | "user";
type FakeRow = Record<string, string | null>;
type FakeStore = Record<TableName, FakeRow[]>;

/** One query as the module issued it, for the batch/selectivity assertions. */
type CapturedQuery = {
  /** Joined tables in chain order, with the ON clause as SQL text. */
  joins: { table: TableName; on: string }[];
  /** The values the `WHERE … IN (…)` was given, in order. */
  ids: string[];
};

const TABLE_NAME = new Map<unknown, TableName>([
  [orders, "orders"],
  [contacts, "contacts"],
  [user, "user"],
]);

const dialect = new PgDialect();

function tableOf(table: unknown): TableName {
  const name = TABLE_NAME.get(table);
  if (!name) throw new Error("fake db: query touches a table it should not");
  return name;
}

/** `[table, column]` when drizzle handed us a column, otherwise `null`. */
function columnOf(value: unknown): [TableName, string] | null {
  const shape = value as { name?: unknown; table?: unknown } | null;
  if (!shape || typeof shape.name !== "string" || !shape.table) return null;
  const table = TABLE_NAME.get(shape.table);
  return table ? [table, shape.name] : null;
}

/** Every column referenced anywhere in a condition's SQL chunks. */
function columnsIn(condition: unknown): [TableName, string][] {
  const chunks = (condition as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) {
    throw new Error("fake db: condition is not a drizzle SQL expression");
  }
  return chunks.map(columnOf).filter((c): c is [TableName, string] => c !== null);
}

function makeFakeDb(store: FakeStore) {
  const queries: CapturedQuery[] = [];

  const select = (selection: Record<string, unknown> = {}) => {
    const captured: CapturedQuery = { joins: [], ids: [] };
    let rows: Partial<Record<TableName, FakeRow | null>>[] = [];

    const join = (table: unknown, on: unknown) => {
      const name = tableOf(table);
      const cols = columnsIn(on);
      if (cols.length !== 2) {
        throw new Error(`fake db: ON clause on ${name} is not a plain column = column`);
      }
      const fresh = cols.find((c) => c[0] === name);
      const known = cols.find((c) => c[0] !== name);
      if (!fresh || !known) {
        throw new Error(`fake db: ON clause must join ${name} to a table already in the query`);
      }
      const next: Partial<Record<TableName, FakeRow | null>>[] = [];
      for (const row of rows) {
        const left = row[known[0]]?.[known[1]] ?? null;
        // A NULL key matches nothing, which is what makes this an INNER join:
        // an order with `contact_id IS NULL` drops out of step 1 instead of
        // pairing with a contact whose column is also NULL.
        const matches =
          left === null ? [] : store[name].filter((r) => (r[fresh[1]] ?? null) === left);
        for (const match of matches) next.push({ ...row, [name]: match });
      }
      rows = next;
      captured.joins.push({ table: name, on: dialect.sqlToQuery(on as never).sql });
      return chain;
    };

    const chain = {
      innerJoin: (table: unknown, on: unknown) => join(table, on),
      where: (condition: unknown) => {
        const cols = columnsIn(condition);
        if (cols.length !== 1) {
          throw new Error("fake db: WHERE must filter exactly one column");
        }
        const [table, column] = cols[0]!;
        const ids = dialect.sqlToQuery(condition as never).params.map(String);
        rows = rows.filter((row) => {
          const value = row[table]?.[column];
          return value !== null && value !== undefined && ids.includes(value);
        });
        // The capture happens HERE, inside `where()`, not when `.from()` is
        // reached: a query this fake never sees a `where` for would be invisible
        // to the "without issuing a query" assertion. All three steps filter by
        // id, so nothing is missed today — but a future `where`-less step would
        // have to be recorded somewhere else too.
        captured.ids = ids;
        queries.push(captured);
        return Promise.resolve(
          rows.map((row) => {
            const projected: Record<string, string | null> = {};
            for (const [alias, value] of Object.entries(selection)) {
              const ref = columnOf(value);
              if (!ref) throw new Error(`fake db: selected field ${alias} is not a column`);
              projected[alias] = row[ref[0]]?.[ref[1]] ?? null;
            }
            return projected;
          }),
        );
      },
    };

    return {
      from: (table: unknown) => {
        const name = tableOf(table);
        rows = store[name].map((row) => ({ [name]: row }));
        return chain;
      },
    };
  };

  return { db: { select } as never, queries };
}

/**
 * One order per way the chain can be walked, and each step's number is DIFFERENT
 * from every other step's, so a result can only be right if the precedence was
 * right. `c-email` is reachable for `o-linked` too (same customer), which is what
 * makes that case a precedence test rather than a lookup test.
 */
function store(): FakeStore {
  return {
    orders: [
      {
        id: "o-linked",
        contact_id: "c-linked",
        customer_id: "u-rina",
        recipient_name: "Rina Snapshot",
        recipient_phone: "0812-9999-9999",
      },
      {
        id: "o-email",
        contact_id: null,
        customer_id: "u-rina",
        recipient_name: "Tetangga",
        recipient_phone: "0812-8888-8888",
      },
      {
        id: "o-snapshot",
        contact_id: null,
        customer_id: "u-nobody",
        recipient_name: "Tante Dewi",
        recipient_phone: "+62 812 3333 3333",
      },
      {
        id: "o-nothing",
        contact_id: null,
        customer_id: "u-nobody",
        recipient_name: null,
        recipient_phone: null,
      },
      {
        id: "o-garbage",
        contact_id: "c-bad",
        customer_id: "u-nobody",
        recipient_name: null,
        recipient_phone: "bukan nomor",
      },
      {
        // The shape the `^628` rule exists for: the CRM contact is a COMPANY on
        // a Jakarta fixed line, and the buyer's own checkout mobile is sitting
        // one step further down the chain. Step 1 must not answer this order.
        id: "o-landline",
        contact_id: "c-office",
        customer_id: "u-nobody",
        recipient_name: "Budi Checkout",
        recipient_phone: "0813-7777-7777",
      },
    ],
    contacts: [
      {
        id: "c-linked",
        email: "linked@example.com",
        contact_name: "PT Linked Jaya",
        phone: "0812-1111-1111",
      },
      {
        id: "c-email",
        email: "rina@example.com",
        contact_name: "Rina Kartika",
        phone: "0812-2222-2222",
      },
      { id: "c-bad", email: "bad@example.com", contact_name: "Pak Badu", phone: "bukan nomor" },
      {
        id: "c-office",
        // No user row carries this email, so step 2 cannot reach `c-office` —
        // the landline is only ever offered by step 1.
        email: "office@example.com",
        contact_name: "PT Kantor Sentosa",
        phone: "021-555-1234",
      },
    ],
    user: [
      { id: "u-rina", email: "rina@example.com" },
      { id: "u-nobody", email: "nobody@example.com" },
    ],
  };
}

async function resolve(orderIds: readonly string[], fakeStore: FakeStore = store()) {
  const { db, queries } = makeFakeDb(fakeStore);
  const result = await resolveCustomerContacts(db, orderIds);
  return { result, queries };
}

describe("resolveCustomerContacts", () => {
  it("prefers the linked contact's phone", async () => {
    const { result, queries } = await resolve(["o-linked"]);
    expect(result.get("o-linked")).toEqual({
      phone: "6281211111111",
      name: "PT Linked Jaya",
    });
    // One query was enough: the linked contact answered it.
    expect(queries).toHaveLength(1);
    expect(queries[0]?.joins).toEqual([
      {
        table: "contacts",
        on: '"pg-drizzle_order"."contact_id" = "pg-drizzle_contact"."id"',
      },
    ]);
  });

  it("falls back to the order customer's contact by email", async () => {
    const { result, queries } = await resolve(["o-email"]);
    expect(result.get("o-email")).toEqual({
      phone: "6281222222222",
      name: "Rina Kartika",
    });
    // The chain keys on the ORDER CUSTOMER's user row and then that account's
    // email — the confirm route's bug was looking up the confirming admin's
    // email instead (`src/app/api/orders/[id]/confirm/route.ts:47-75`).
    expect(queries[1]?.joins).toEqual([
      { table: "user", on: '"pg-drizzle_order"."customer_id" = "user"."id"' },
      { table: "contacts", on: '"pg-drizzle_contact"."email" = "user"."email"' },
    ]);
  });

  it("falls back to the order's recipient snapshot", async () => {
    // `u-nobody` has no contact row, so steps 1 and 2 return nothing for this
    // order and the checkout snapshot is all we have — name included.
    const { result, queries } = await resolve(["o-snapshot"]);
    expect(result.get("o-snapshot")).toEqual({
      phone: "6281233333333",
      name: "Tante Dewi",
    });
    expect(queries).toHaveLength(3);
    expect(queries[2]?.joins).toEqual([]);
  });

  it("yields null when there is no number anywhere", async () => {
    const { result } = await resolve(["o-nothing", "o-garbage"]);
    // Review Focus 5: the surface renders no button. `o-garbage` is the harsher
    // case — a contact row exists and is even named, its phone is prose.
    expect(result.get("o-nothing")).toBeNull();
    expect(result.get("o-garbage")).toBeNull();
    expect(result.has("o-nothing")).toBe(true);
    expect(result.has("o-garbage")).toBe(true);
  });

  it("tells an order with no number apart from an order that does not exist", async () => {
    const { result } = await resolve(["o-nothing", "o-ghost"]);
    expect(result.get("o-nothing")).toBeNull();
    expect(result.has("o-nothing")).toBe(true);
    // Nothing was ever looked up for a phantom id, so it must not be a key at
    // all — a caller could otherwise read "no number" off a typo'd id.
    expect(result.has("o-ghost")).toBe(false);
  });

  it("resolves a whole list in one pass and keeps the order ids straight", async () => {
    const { result, queries } = await resolve([
      "o-linked",
      "o-email",
      "o-snapshot",
      "o-nothing",
    ]);
    // Every requested id present, each carrying ITS OWN customer's number —
    // the ids cannot be shuffled by a Map built from the wrong row.
    expect([...result.keys()].sort()).toEqual([
      "o-email",
      "o-linked",
      "o-nothing",
      "o-snapshot",
    ]);
    expect(result.get("o-linked")).toEqual({ phone: "6281211111111", name: "PT Linked Jaya" });
    expect(result.get("o-email")).toEqual({ phone: "6281222222222", name: "Rina Kartika" });
    expect(result.get("o-snapshot")).toEqual({ phone: "6281233333333", name: "Tante Dewi" });
    expect(result.get("o-nothing")).toBeNull();
    // One pass, not four: at most one query per chain step for the whole list.
    expect(queries.length).toBeLessThanOrEqual(3);
  });

  it("asks the later steps only for the orders the earlier steps could not answer", async () => {
    const { queries } = await resolve(["o-linked", "o-email", "o-snapshot", "o-nothing"]);
    expect(queries[0]?.ids).toEqual(["o-linked", "o-email", "o-snapshot", "o-nothing"]);
    expect(queries[1]?.ids).toEqual(["o-email", "o-snapshot", "o-nothing"]);
    expect(queries[2]?.ids).toEqual(["o-snapshot", "o-nothing"]);
  });

  it("stops the chain as soon as every order in the list is answered", async () => {
    const { result, queries } = await resolve(["o-linked", "o-email"]);
    // Step 1 answers `o-linked`, step 2 answers `o-email`, so the snapshot
    // query is never built — a page of linked orders costs two round trips,
    // not three.
    expect(queries).toHaveLength(2);
    expect(result.get("o-linked")).toEqual({ phone: "6281211111111", name: "PT Linked Jaya" });
    expect(result.get("o-email")).toEqual({ phone: "6281222222222", name: "Rina Kartika" });
  });

  it("walks all three steps for an order whose contact phone is unusable", async () => {
    const { result, queries } = await resolve(["o-linked", "o-garbage"]);
    // Step 1 returns a NAMED contact row for `o-garbage` whose phone is prose.
    // Resolving it there would mint `{ phone: null }` downstream, so the order
    // stays pending and every later step is asked for it alone.
    expect(queries).toHaveLength(3);
    expect(queries[1]?.ids).toEqual(["o-garbage"]);
    expect(queries[2]?.ids).toEqual(["o-garbage"]);
    expect(result.get("o-garbage")).toBeNull();
    expect(result.get("o-linked")).toEqual({ phone: "6281211111111", name: "PT Linked Jaya" });
  });

  it("falls through a contact whose only number is a landline to the checkout mobile", async () => {
    const { result, queries } = await resolve(["o-landline"]);
    // `c-office` IS linked and IS named, so step 1 returns a row for this order —
    // but `021-555-1234` normalises to `null`, and a candidate that normalises to
    // `null` leaves the order pending instead of resolving it to a link that
    // WhatsApp refuses. The chain order is untouched; the `^628` rule is what
    // keeps the office line from winning, and the buyer's own mobile from being
    // stranded behind a CRM record.
    expect(result.get("o-landline")).toEqual({
      phone: "6281377777777",
      name: "Budi Checkout",
    });
    // All three steps ran, and each later one was still asked for this order —
    // its customer has no contact row, so the checkout snapshot is the answer.
    expect(queries).toHaveLength(3);
    expect(queries[1]?.ids).toEqual(["o-landline"]);
    expect(queries[2]?.ids).toEqual(["o-landline"]);
  });

  it("uses the order's recipient name when the contact row has none", async () => {
    // The name rule is `contactName → recipientName → null`. Every contact in the
    // default store is named, so without these variants the fallback half of it
    // ships untested: deleting `?? cleanName(row.recipientName)` from the module
    // would leave every other assertion green. `"Rina Snapshot"` also proves the
    // name came from the same step as the phone — step 2 could reach this order
    // too, and would have said `"Rina Kartika"`.
    const nullName = store();
    nullName.contacts[0]!.contact_name = null;
    expect((await resolve(["o-linked"], nullName)).result.get("o-linked")).toEqual({
      phone: "6281211111111",
      name: "Rina Snapshot",
    });

    // A whitespace-only name is not a name: it would render `Halo    ,` in the
    // message, so `cleanName` treats it as absent rather than as a value.
    const blankName = store();
    blankName.contacts[0]!.contact_name = "   ";
    expect((await resolve(["o-linked"], blankName)).result.get("o-linked")).toEqual({
      phone: "6281211111111",
      name: "Rina Snapshot",
    });

    // With neither, `cancelMessageText` gets `customerName: null` and drops the
    // greeting instead of inventing one.
    const noName = store();
    noName.contacts[0]!.contact_name = null;
    noName.orders[0]!.recipient_name = "  ";
    expect((await resolve(["o-linked"], noName)).result.get("o-linked")).toEqual({
      phone: "6281211111111",
      name: null,
    });
  });

  it("asks each query once for a repeated order id", async () => {
    // A list can hold the same id twice, and `inArray` would widen it to
    // `IN ('o-linked','o-linked')` — harmless to the result, wasteful in the SQL
    // and confusing in a slow-query log. The dedupe is the module's stated
    // behaviour, so it gets an assertion rather than a comment.
    const { result, queries } = await resolve(["o-linked", "o-linked"]);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.ids).toEqual(["o-linked"]);
    expect(result.size).toBe(1);
    expect(result.get("o-linked")).toEqual({ phone: "6281211111111", name: "PT Linked Jaya" });
  });

  it("returns an empty Map for an empty id list without issuing a query", async () => {
    const { result, queries } = await resolve([]);
    // An empty tab reaches this line on every page visit, and `inArray(col, [])`
    // is still a round trip — the guard, not the empty Map, is what is tested.
    expect(queries).toEqual([]);
    expect(result.size).toBe(0);
  });
});
