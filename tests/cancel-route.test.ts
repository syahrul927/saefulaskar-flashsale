import { beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { orders } from "@/server/db/schema";

// The route's own decisions are what this file pins: the 401/403 guards, the
// 404/409 pre-checks, the input it hands the service, and the service verdict
// → status-code mapping. So the auth seam and `cancelOrder` are mocked, and
// `@/server/db` is a row QUEUE — the transaction semantics inside the service
// are Task 7's file, not this one's job to re-prove.
//
// Every `where()` condition is CAPTURED as well as ignored: a queue that threw
// its condition away would pass a route looking orders up by `booking_id`, by
// nothing at all, or by the wrong id, and this file would never notice. The
// `orders look up by id` test below decodes them with `PgDialect` (the idiom is
// `tests/confirm-route.test.ts:55,140-149`).
vi.mock("@/server/better-auth/server", () => ({ getSession: vi.fn() }));
vi.mock("@/server/cancel-order", () => ({ cancelOrder: vi.fn() }));

const state = vi.hoisted(() => ({
  // A queue, not a single row: the route reads once for its guards and — only
  // on the raced `already-ended` verdict — once more to name the current
  // status. `select().from(orders).where()` shifts the next row off the front;
  // an empty queue reads as "no such order".
  orderRows: [] as Record<string, unknown>[],
  /** One entry per read the route performed, in call order. */
  conditions: [] as unknown[],
}));

vi.mock("@/server/db", async () => {
  const { orders } = await import("@/server/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async (condition: unknown) => {
            state.conditions.push(condition);
            return table === orders ? state.orderRows.splice(0, 1) : [];
          },
        }),
      }),
    },
  };
});

import { POST } from "@/app/api/orders/[id]/cancel/route";
import { getSession } from "@/server/better-auth/server";
import { cancelOrder } from "@/server/cancel-order";

const ADMIN = {
  user: {
    id: "owner-1",
    role: "OWNER",
    email: "admin@example.com",
    token: "tok",
  },
};
const CUSTOMER = {
  user: {
    id: "cust-1",
    role: "CUSTOMER",
    email: "customer@example.com",
    token: "tok",
  },
};

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    bookingId: "FS-2026-0148",
    status: "UNPAID",
    ...overrides,
  };
}

function post() {
  return POST(new Request("http://test/api/orders/o1/cancel"), {
    params: Promise.resolve({ id: "o1" }),
  });
}

const dialect = new PgDialect();

beforeEach(() => {
  state.orderRows = [];
  state.conditions = [];
  vi.mocked(getSession).mockReset();
  vi.mocked(getSession).mockResolvedValue(ADMIN as never);
  vi.mocked(cancelOrder).mockReset();
});

describe("cancel route guards", () => {
  it("401s with no session and never touches the order", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    state.orderRows = [orderRow()];
    const res = await post();
    expect(res.status).toBe(401);
    // The row is still in the queue: no read happened before the 401.
    expect(state.orderRows).toHaveLength(1);
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("403s a signed-in CUSTOMER", async () => {
    vi.mocked(getSession).mockResolvedValue(CUSTOMER as never);
    state.orderRows = [orderRow()];
    const res = await post();
    expect(res.status).toBe(403);
    expect(state.orderRows).toHaveLength(1);
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("404s an unknown order id", async () => {
    const res = await post();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: false; error: string };
    expect(body.error).toBe("Pesanan tidak ditemukan");
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("409s a COMPLETED order and names the current status", async () => {
    state.orderRows = [orderRow({ status: "COMPLETED" })];
    const res = await post();
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: false; error: string };
    expect(body.error).toBe("Pesanan sudah berstatus COMPLETED");
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("409s a legacy SHIPPED order", async () => {
    // `isCancellable` is UNPAID | CONFIRMED only, so the ADMIN door refuses a
    // legacy SHIPPED row even though the service itself would accept it —
    // deliberate asymmetry (spec §3.3): the sync may clean up legacy rows,
    // an admin pressing the button may not.
    state.orderRows = [orderRow({ status: "SHIPPED" })];
    const res = await post();
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: false; error: string };
    expect(body.error).toBe("Pesanan sudah berstatus SHIPPED");
    expect(cancelOrder).not.toHaveBeenCalled();
  });
});

describe("cancel route happy paths", () => {
  it("cancels an UNPAID order as the acting admin", async () => {
    state.orderRows = [orderRow()];
    vi.mocked(cancelOrder).mockResolvedValue({
      cancelled: true,
      fromStatus: "UNPAID",
      releasedUnits: 2,
    });
    const res = await post();
    expect(res.status).toBe(200);
    // The input object only: the first argument is the mocked module's `db`
    // export and pins nothing here (the real db satisfying `CancelDb` is
    // Task 7's concern).
    const call = vi.mocked(cancelOrder).mock.calls[0];
    expect(call?.[1]).toEqual({
      orderId: "o1",
      source: "admin",
      actorUserId: "owner-1",
    });
    expect(await res.json()).toEqual({
      ok: true,
      order: {
        id: "o1",
        bookingId: "FS-2026-0148",
        status: "CANCEL",
        releasedUnits: 2,
      },
    });
  });

  it("cancels a CONFIRMED order too — the paid case is deliberate", async () => {
    // Money may already have been taken; the refund is handled offline
    // (spec §2). The route must not special-case CONFIRMED into a refusal.
    state.orderRows = [orderRow({ status: "CONFIRMED" })];
    vi.mocked(cancelOrder).mockResolvedValue({
      cancelled: true,
      fromStatus: "CONFIRMED",
      releasedUnits: 1,
    });
    const res = await post();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      order: { status: string; releasedUnits: number };
    };
    expect(body.order.status).toBe("CANCEL");
    expect(body.order.releasedUnits).toBe(1);
  });
});

describe("cancel route verdict mapping", () => {
  it("maps the service's already-ended verdict to 409, naming the status it re-read", async () => {
    // The race: the pre-check passes on the FIRST read (UNPAID), the guarded
    // UPDATE inside the service finds the row already ended, and the route
    // re-reads to name the CURRENT status — the pre-check cannot tell a
    // cancel from a completion, so the message must not be guessed.
    state.orderRows = [orderRow(), orderRow({ status: "COMPLETED" })];
    vi.mocked(cancelOrder).mockResolvedValue({
      cancelled: false,
      reason: "already-ended",
    });
    const res = await post();
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: false; error: string };
    expect(body.error).toBe("Pesanan sudah berstatus COMPLETED");
    // Both reads consumed: exactly one re-read happened, no more.
    expect(state.orderRows).toHaveLength(0);
  });

  it("maps the service's not-found verdict to 404", async () => {
    // A second, DIFFERENT row sits behind the first: if the route treated
    // `not-found` like `already-ended` and re-read for the message, it would
    // consume this one. An empty queue after the first read would hide that.
    state.orderRows = [orderRow(), orderRow({ status: "COMPLETED" })];
    vi.mocked(cancelOrder).mockResolvedValue({
      cancelled: false,
      reason: "not-found",
    });
    const res = await post();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: false; error: string };
    expect(body.error).toBe("Pesanan tidak ditemukan");
    expect(state.orderRows).toHaveLength(1);
  });

  it("404s when the re-read after an already-ended verdict finds no row", async () => {
    // The row was deleted outright between our read and the guarded UPDATE.
    // Reporting `Pesanan sudah berstatus CANCEL` here would name a status we
    // never observed — the honest answer for a vanished row is 404, the same
    // sentence the pre-check uses.
    state.orderRows = [orderRow()];
    vi.mocked(cancelOrder).mockResolvedValue({
      cancelled: false,
      reason: "already-ended",
    });
    const res = await post();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: false; error: string };
    expect(body.error).toBe("Pesanan tidak ditemukan");
  });

  it("turns a service throw into a 500 JSON sentence, stack kept server-side", async () => {
    // The one outcome that is invisible to the admin until it breaks: every
    // other branch has a status code the UI can show, while an escaping
    // rejection becomes Next's non-JSON error page and the button's
    // `data?.error` read finds nothing.
    state.orderRows = [orderRow()];
    vi.mocked(cancelOrder).mockRejectedValue(new Error("connection terminated"));
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const res = await post();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        ok: false,
        error: "Gagal membatalkan pesanan, coba lagi",
      });
      expect(logged).toHaveBeenCalledWith(
        "cancel: cancelOrder failed",
        expect.any(Error),
      );
      expect(state.orderRows).toHaveLength(0);
    } finally {
      logged.mockRestore();
    }
  });
});

describe("cancel route lookups", () => {
  it("reads the order up by id, both times it reads", async () => {
    // Pre-check read and the raced re-read. A wrong column here (`booking_id`,
    // or no predicate at all) is a cancel applied to somebody else's order, and
    // nothing else in this file can see it — the queue hands back a row either
    // way.
    state.orderRows = [orderRow(), orderRow({ status: "COMPLETED" })];
    vi.mocked(cancelOrder).mockResolvedValue({
      cancelled: false,
      reason: "already-ended",
    });
    await post();

    // The expected SQL is RENDERED FROM THE SCHEMA rather than typed out as a
    // string literal: this table's database name is `pg-drizzle_order`, not
    // `orders`, and a hand-written expectation would be a second source of
    // truth that drifts the moment the schema is renamed.
    const byId = dialect.sqlToQuery(eq(orders.id, "o1"));
    expect(state.conditions).toHaveLength(2);
    for (const cond of state.conditions) {
      const query = dialect.sqlToQuery(cond as never);
      expect(query.sql).toBe(byId.sql);
      expect(query.params).toEqual(["o1"]);
    }
  });
});
