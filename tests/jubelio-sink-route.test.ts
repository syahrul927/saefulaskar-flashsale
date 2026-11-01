import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inserts: [] as { table: unknown; value: Record<string, unknown> }[],
  prunes: 0,
  pruneFails: false,
  insertFails: false,
}));

// The sink route's only collaborators are the probe core (pure, tested in
// `jubelio-probe.test.ts`) and the DB. Mock the DB as a capturing builder so
// these tests pin the ROUTE: credential gate, what got written, and what a
// failure does to the response.
vi.mock("@/server/db", () => ({
  db: {
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          if (state.insertFails) throw new Error("db down");
          state.inserts.push({ table, value });
          return [{ id: `cap-${state.inserts.length}` }];
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        state.prunes += 1;
        if (state.pruneFails) throw new Error("delete exploded");
        return { rowCount: 0 };
      },
    }),
  },
}));

import { env } from "@/env";
import { webhookCaptures } from "@/server/db/schema";
import { POST } from "@/app/api/jubelio/webhook-sink/[token]/route";

const TOKEN = env.JUBELIO_WEBHOOK_SINK_TOKEN ?? "";

function post(opts: {
  token?: string;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
  query?: string;
}) {
  const headers = new Headers({
    "content-type": opts.contentType ?? "application/json",
    ...opts.headers,
  });
  return POST(
    new Request(`http://test/api/jubelio/webhook-sink/${opts.token ?? TOKEN}${opts.query ?? ""}`, {
      method: "POST",
      headers,
      body: opts.body ?? "{}",
    }),
    { params: Promise.resolve({ token: opts.token ?? TOKEN }) },
  );
}

beforeEach(() => {
  state.inserts = [];
  state.prunes = 0;
  state.pruneFails = false;
  state.insertFails = false;
});

describe("POST /api/jubelio/webhook-sink/[token]", () => {
  it("stores the parsed body, the join keys and the event label", async () => {
    const res = await post({
      body: JSON.stringify({
        salesorder_id: 192297,
        invoice_id: 44120,
        ref_no: "FS-2026-0001",
        status: "invoice_created",
      }),
      query: "?event=sales-order",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      id: "cap-1",
      salesorderId: 192297,
      invoiceId: 44120,
      refNo: "FS-2026-0001",
    });
    expect(state.inserts[0]?.table).toBe(webhookCaptures);
    const value = state.inserts[0]?.value;
    expect(value?.source).toBe("sales-order");
    expect(value?.method).toBe("POST");
    expect(value?.body).toEqual({
      salesorder_id: 192297,
      invoice_id: 44120,
      ref_no: "FS-2026-0001",
      status: "invoice_created",
    });
    expect(value?.truncated).toBe(false);
  });

  it("labels an unlabelled call `unknown` rather than guessing an event", async () => {
    await post({ body: "{}" });
    expect(state.inserts[0]?.value.source).toBe("unknown");
  });

  it("redacts credentials out of the stored headers", async () => {
    await post({
      headers: {
        authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.real",
        "x-jubelio-signature": "abc123",
        "user-agent": "Jubelio/2.0",
      },
    });
    const headers = state.inserts[0]?.value.headers as Record<string, string>;
    expect(headers.authorization).toBe("[redacted]");
    // A signature is a finding, not a secret — we need to see whether it exists.
    expect(headers["x-jubelio-signature"]).toBe("abc123");
    expect(headers["user-agent"]).toBe("Jubelio/2.0");
  });

  it("keeps a non-JSON body as raw text with body null", async () => {
    const res = await post({ body: "hello", contentType: "text/plain" });
    expect(res.status).toBe(200);
    const value = state.inserts[0]?.value;
    expect(value?.body).toBeNull();
    expect(value?.rawBody).toBe("hello");
    expect(value?.contentType).toBe("text/plain");
  });

  it("flags a body it had to cut instead of storing a truncated JSON as parsed", async () => {
    const huge = JSON.stringify({ note: "x".repeat(200_000) });
    await post({ body: huge });
    const value = state.inserts[0]?.value;
    expect(value?.truncated).toBe(true);
    expect(value?.body).toBeNull();
    expect((value?.rawBody as string).length).toBeLessThanOrEqual(64 * 1024);
    expect(value?.byteLength).toBe(huge.length);
  });

  it("401s a wrong token and stores nothing", async () => {
    const res = await post({ token: "wrong-token", body: '{"a":1}' });
    expect(res.status).toBe(401);
    expect(state.inserts).toHaveLength(0);
  });

  it("503s and stores nothing when the sink is not configured", async () => {
    const previous = env.JUBELIO_WEBHOOK_SINK_TOKEN;
    // The token is optional by design: unset must close the endpoint, not open
    // it to anyone who finds the path.
    (env as { JUBELIO_WEBHOOK_SINK_TOKEN?: string }).JUBELIO_WEBHOOK_SINK_TOKEN =
      undefined;
    try {
      const res = await POST(
        new Request("http://test/api/jubelio/webhook-sink/whatever", {
          method: "POST",
          body: "{}",
        }),
        { params: Promise.resolve({ token: "whatever" }) },
      );
      expect(res.status).toBe(503);
      expect(state.inserts).toHaveLength(0);
    } finally {
      (env as { JUBELIO_WEBHOOK_SINK_TOKEN?: string }).JUBELIO_WEBHOOK_SINK_TOKEN =
        previous;
    }
  });

  it("still answers 200 when pruning fails — the capture already landed", async () => {
    state.pruneFails = true;
    const res = await post({ body: "{}" });
    expect(res.status).toBe(200);
    expect(state.prunes).toBe(1);
  });

  it("answers 500, not 200, when the capture cannot be written", async () => {
    // A false 200 tells Jubelio the event landed. It did not, and the whole
    // point of the rig is that we never trust a delivery we cannot read back.
    state.insertFails = true;
    const res = await post({ body: '{"salesorder_id":1}' });
    expect(res.status).toBe(500);
    expect(state.inserts).toHaveLength(0);
  });
});
