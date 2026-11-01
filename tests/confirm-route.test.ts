import { beforeEach, describe, expect, it, vi } from "vitest";

import { PgDialect } from "drizzle-orm/pg-core";

// Route collaborators are seams (the `session-products-post.test.ts` idiom):
// `@/lib/jubelio` stays partially real so `isJubelioAuthError`/`JubelioError`
// identity matches the route's checks, while the Jubelio client itself is a
// mock whose `createSalesOrder` payload is captured — the SO customer_name is
// exactly what this test pins. `@/server/db` is a thenable-builder mock:
// selects hand back per-table fixtures (pre-filtered the way the DB would)
// and every `where()` condition is captured so the test can assert WHICH key
// the contacts lookup used — the customer's email, not the confirming admin's.
// `transaction()` hands the callback the SAME builders (so the final write and
// its status-history row run through one code path) and `insert()` captures
// `order_status_history` rows — that capture is what proves a refused
// transition writes no audit row.
vi.mock("@/server/better-auth/server", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/jubelio", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  // `{ id }` is what Jubelio's create actually returns (live 2026-10-28,
  // SO-000192297); a mock shaped like our old assumption hides the parse bug.
  const createSalesOrder = vi.fn(async () => ({ id: 555 }));
  const getStockBySku = vi.fn(async () => ({ uom_name: "Buah" }));
  return {
    ...actual,
    // Real export stays the seam — the captured fns hang off its return value.
    createJubelioClient: vi.fn(() => ({ createSalesOrder, getStockBySku })),
  };
});

const state = vi.hoisted(() => ({
  contactsEmailWhere: [] as unknown[],
  contactExists: true,
  orderExists: true,
  updatedSets: [] as Record<string, unknown>[],
  /** Rows the route inserted into `order_status_history`, in call order. */
  history: [] as Record<string, unknown>[],
  /** Parallel to `history`: was that insert made on a `tx`, not on `db`? */
  historyInTransaction: [] as boolean[],
}));

vi.mock("@/server/db", async () => {
  const { contacts, orderItems, orders, orderStatusHistory, user } =
    await import("@/server/db/schema");
  const ORDER = {
    id: "order-1",
    status: "UNPAID",
    contactId: null,
    customerId: "cust-1",
    grandTotal: 692_000,
    createdAt: new Date("2026-10-26T10:00:00.000Z"),
  };
  const select = () => ({
    from: (table: unknown) => ({
      where: (cond: unknown) => {
        if (table === contacts) state.contactsEmailWhere.push(cond);
        const rows =
          table === orders
            ? state.orderExists
              ? [ORDER]
              : []
            : table === orderItems
              ? [
                  {
                    itemId: 1880,
                    sku: "SD05100999",
                    itemName: "Kunci Kontak",
                    qty: 5,
                    price: 80_000,
                    subtotal: 400_000,
                  },
                ]
              : table === user
                ? [{ email: "customer@example.com" }]
                : table === contacts
                  ? state.contactExists
                    ? [
                        {
                          id: "contact-1",
                          email: "customer@example.com",
                          jubelioContactId: 195465,
                          contactName: "PT Suka Maju Mundur",
                        },
                      ]
                    : []
                  : [];
        return Promise.resolve(rows);
      },
    }),
  });
  const update = () => ({
    set: (v: Record<string, unknown>) => {
      state.updatedSets.push(v);
      return {
        where: () => ({
          returning: () =>
            Promise.resolve([{ id: "order-1", status: "CONFIRMED", ...v }]),
        }),
      };
    },
  });
  // Captured per table: `history` must hold ONLY the `order_status_history`
  // rows, otherwise an insert into any other table would pass for an audit row.
  // The builder is made per RECEIVER so the mock can tell `tx.insert` from
  // `db.insert`: an audit row written on `db` would commit even when the
  // status UPDATE rolls back, so "the row exists" alone is not enough.
  const insertFor = (inTransaction: boolean) => (table: unknown) => ({
    values: async (row: Record<string, unknown>) => {
      if (table === orderStatusHistory) {
        state.history.push(row);
        state.historyInTransaction.push(inTransaction);
      }
      return [row];
    },
  });
  const tx = { select, update, insert: insertFor(true) };
  return {
    db: {
      select,
      update,
      insert: insertFor(false),
      // The route's final write runs in a transaction; the fake hands the
      // callback a tx whose select/update are the same builders (so the
      // captured status UPDATE still lands) but whose insert is tagged.
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

import { POST } from "@/app/api/orders/[id]/confirm/route";
import { createJubelioClient } from "@/lib/jubelio";
import { getSession } from "@/server/better-auth/server";

/** The captured Jubelio client the route builds (mocked at module seam). */
const client = createJubelioClient("test") as unknown as {
  createSalesOrder: ReturnType<typeof vi.fn>;
  getStockBySku: ReturnType<typeof vi.fn>;
};

const dialect = new PgDialect();

/** The literal value a captured `WHERE contacts.email = <x>` compares against. */
function capturedEmailValue(): string | undefined {
  const cond = state.contactsEmailWhere[0];
  if (!cond) return undefined;
  return dialect.sqlToQuery(cond as never).params.find(
    (p) => typeof p === "string",
  );
}

const ADMIN = {
  user: {
    id: "admin-1",
    role: "OWNER",
    email: "admin@example.com",
    token: "tok",
  },
};

function request(id = "order-1") {
  return POST(new Request("http://test/api/orders/1/confirm"), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  state.contactsEmailWhere = [];
  state.contactExists = true;
  state.orderExists = true;
  state.history = [];
  state.historyInTransaction = [];
  vi.mocked(getSession).mockReset();
  vi.mocked(getSession).mockResolvedValue(ADMIN as never);
  client.createSalesOrder.mockClear();
  state.updatedSets = [];
});

/**
 * Live failure 2026-10-28: the create succeeded (`SO-000192297`,
 * `internal=PAID / channel=Paid / wms=PAID`) but the route read
 * `data.salesorder_id` — Jubelio returns `{ id }` — so it answered 502 and
 * never stored the link. The local order stayed UNPAID next to a PAID sales
 * order upstream, and the next click would have made a second one.
 */
describe("confirm route SO id", () => {
  it("links the id Jubelio actually returns", async () => {
    const res = await request();
    expect(res.status).toBe(200);
    expect(state.updatedSets).toEqual([
      { status: "CONFIRMED", jubelioSoId: 555 },
    ]);
    const body = (await res.json()) as { order: { jubelioSoId: number } };
    expect(body.order.jubelioSoId).toBe(555);
  });

  it("records the UNPAID → CONFIRMED transition with the confirming admin", async () => {
    const res = await request();
    expect(res.status).toBe(200);
    // The stepper reads this row: `fromStatus` must be the status the route
    // read BEFORE the update (UNPAID), never the value it just wrote.
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({
      orderId: "order-1",
      fromStatus: "UNPAID",
      toStatus: "CONFIRMED",
      source: "admin",
      actorUserId: ADMIN.user.id,
    });
    expect(String(state.history[0]?.note)).toContain("SO #555");
    // Not just that a row was written: it must be written INSIDE the
    // transaction. An insert on `db` after the commit would leave an audit row
    // claiming CONFIRMED on an order whose UPDATE rolled back.
    expect(state.historyInTransaction).toEqual([true]);
  });

  it("502s without marking the order when the response carries no id", async () => {
    client.createSalesOrder.mockResolvedValueOnce({});
    const res = await request();
    expect(res.status).toBe(502);
    expect(state.updatedSets).toEqual([]);
    expect(state.history).toEqual([]);
    // The admin must be told a SO may already exist — a blind retry is what
    // produced the four dead `UNKNOWN` rows of the same afternoon.
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/mungkin sudah dibuat/i);
  });
});

/**
 * A transition that never happened must never be audited: no row for a 404,
 * whatever else the route touched first. The 409 (contact) and 502 (no SO id)
 * paths assert the same thing in their own describe blocks.
 */
describe("confirm route refused transitions", () => {
  it("writes no history row for an order that does not exist", async () => {
    state.orderExists = false;
    const res = await request();
    expect(res.status).toBe(404);
    expect(state.history).toEqual([]);
  });
});

describe("confirm route contact resolution", () => {
  it("looks the contact up by the ORDER CUSTOMER's email, not the confirming admin's", async () => {
    const res = await request();
    expect(res.status).toBe(200);
    // Legacy order (contactId null) + admin account ≠ customer account: the
    // fallback must key on the customer (cust-1 → customer@example.com),
    // otherwise a real admin can never confirm anyone else's order.
    expect(capturedEmailValue()).toBe("customer@example.com");
  });

  it("sends the customer's contact name in the SO payload", async () => {
    await request();
    expect(client.createSalesOrder).toHaveBeenCalledTimes(1);
    const payload = client.createSalesOrder.mock.calls[0]?.[0] as {
      customer_name: string;
      contact_id: number;
    };
    expect(payload.customer_name).toBe("PT Suka Maju Mundur");
    expect(payload.contact_id).toBe(195465);
  });

  it("returns 409 (not 500) when no contact exists for the customer", async () => {
    state.contactExists = false;
    const res = await request();
    expect(res.status).toBe(409);
    expect(client.createSalesOrder).not.toHaveBeenCalled();
    expect(state.history).toEqual([]);
  });
});
