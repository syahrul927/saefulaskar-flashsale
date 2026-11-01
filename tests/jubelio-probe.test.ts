import { describe, expect, it } from "vitest";

import {
  SINK_MAX_BODY_BYTES,
  captureBody,
  checkSinkToken,
  detectCaptureRefs,
  diffProbeFields,
  formatProbeValue,
  readProbeFields,
  redactHeaders,
} from "@/server/jubelio-probe";

/**
 * Pure core of the Jubelio observation rig. Two questions it exists to answer,
 * because the upstream docs are silent on both:
 *   1. what does a Jubelio webhook POST actually contain (sink + capture), and
 *   2. what changes on the sales order when a faktur is created (snapshot diff).
 * Fixtures below are live-shaped: SO 192297 (our own PAID order) and the
 * SHIPPED / COMPLETED rows probed 2026-10-29 — note SO 85 reads
 * `channel_status: "remitted"`, which is the invoice-side of that SO's life.
 */

const PAID_SO = {
  items: [],
  salesorder_id: 192297,
  salesorder_no: "SO-000192297",
  internal_status: "PAID",
  channel_status: "Paid",
  wms_status: "PAID",
  tracking_number: "",
  shipper: "",
  // No invoice keys at all: this is the read from before anyone touched a
  // faktur, so the diff should be able to say `added`, not `changed`.
  is_canceled: false,
  ref_no: "",
  updated_at: "2026-10-29T04:00:00.000Z",
};

const INVOICED_SO = {
  ...PAID_SO,
  internal_status: "COMPLETED",
  channel_status: "remitted",
  wms_status: "COMPLETED",
  invoice_id: 44120,
  invoice_no: "FV-00044120",
  updated_at: "2026-10-31T02:15:00.000Z",
};

/** The verdict's `reason` only exists on the refusal branch; make that explicit. */
function refuse(provided: string | undefined, configured: string | undefined) {
  const verdict = checkSinkToken(provided, configured);
  if (verdict.ok) throw new Error(`expected a refusal for ${String(provided)}`);
  return verdict.reason;
}

describe("checkSinkToken", () => {
  it("refuses everything while the sink is unconfigured", () => {
    expect(checkSinkToken(undefined, undefined).ok).toBe(false);
    expect(checkSinkToken("anything", "").ok).toBe(false);
    expect(refuse("anything", undefined)).toBe("not-configured");
  });

  it("accepts only the exact configured token", () => {
    expect(checkSinkToken("abc123", "abc123")).toEqual({ ok: true });
    expect(refuse("abc124", "abc123")).toBe("mismatch");
    expect(refuse("", "abc123")).toBe("mismatch");
    // Trailing whitespace in a pasted secret is the most common way this fails
    // in real life, and it must read as a mismatch, not a hit.
    expect(refuse("abc123 ", "abc123")).toBe("mismatch");
  });
});

describe("redactHeaders", () => {
  it("keeps diagnostic headers and blanks credential ones", () => {
    const out = redactHeaders({
      "content-type": "application/json",
      "user-agent": "Jubelio/2.0",
      "x-request-id": "req-1",
      authorization: "Bearer eyJhbGciOi…",
      cookie: "session=abc",
      "x-api-key": "K-9999",
      "x-jubelio-secret": "s3cr3t",
    });
    expect(out["content-type"]).toBe("application/json");
    expect(out["user-agent"]).toBe("Jubelio/2.0");
    expect(out["x-request-id"]).toBe("req-1");
    expect(out.authorization).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    expect(out["x-api-key"]).toBe("[redacted]");
    expect(out["x-jubelio-secret"]).toBe("[redacted]");
  });

  it("matches credential names case-insensitively and drops nothing else", () => {
    const out = redactHeaders({ AUTHORIZATION: "Bearer x", Accept: "*/*" });
    expect(out.authorization).toBe("[redacted]");
    expect(out.accept).toBe("*/*");
  });
});

describe("captureBody", () => {
  it("parses JSON and keeps the raw text alongside it", () => {
    const text = JSON.stringify({ salesorder_id: 192297 });
    const c = captureBody(text, "application/json");
    expect(c.body).toEqual({ salesorder_id: 192297 });
    expect(c.rawBody).toBe(text);
    expect(c.truncated).toBe(false);
    expect(c.byteLength).toBe(text.length);
  });

  it("keeps a non-JSON body as raw text only", () => {
    const c = captureBody("not-json-at-all", "text/plain");
    expect(c.body).toBeNull();
    expect(c.rawBody).toBe("not-json-at-all");
  });

  it("does not claim to store a body it cut", () => {
    const huge = "x".repeat(SINK_MAX_BODY_BYTES + 10);
    const c = captureBody(huge, "application/json");
    expect(c.truncated).toBe(true);
    expect(c.byteLength).toBe(huge.length);
    expect(c.body).toBeNull();
    expect(c.rawBody.length).toBeLessThanOrEqual(SINK_MAX_BODY_BYTES);
  });

  it("counts bytes, not UTF-16 units, for multi-byte payloads", () => {
    const c = captureBody('{"note":"🧪"}', "application/json");
    expect(c.byteLength).toBe(15);
  });
});

describe("detectCaptureRefs", () => {
  it("finds the ids we would have to map a webhook back on", () => {
    expect(
      detectCaptureRefs({ salesorder_id: 192297, invoice_id: 44120, ref_no: "FS-2026-0001" }),
    ).toEqual({ salesorderId: 192297, invoiceId: 44120, refNo: "FS-2026-0001" });
  });

  it("looks inside a data envelope, and inside each row of a data array", () => {
    expect(
      detectCaptureRefs({ data: [{ salesorder_id: 5 }, { salesorder_id: 6 }] }),
    ).toEqual({ salesorderId: 5, invoiceId: null, refNo: null });
    expect(detectCaptureRefs({ data: { id: 9 } }).salesorderId).toBe(9);
  });

  it("returns all-null for a body that is not an object", () => {
    expect(detectCaptureRefs("boom")).toEqual({
      salesorderId: null,
      invoiceId: null,
      refNo: null,
    });
    expect(detectCaptureRefs(null)).toEqual({
      salesorderId: null,
      invoiceId: null,
      refNo: null,
    });
  });
});

describe("readProbeFields", () => {
  it("pulls the status triple plus the invoice and shipping detail", () => {
    expect(readProbeFields(INVOICED_SO)).toEqual({
      salesorderId: 192297,
      salesorderNo: "SO-000192297",
      internalStatus: "COMPLETED",
      channelStatus: "remitted",
      wmsStatus: "COMPLETED",
      trackingNumber: null,
      shipper: null,
      invoiceId: 44120,
      invoiceNo: "FV-00044120",
      refNo: null,
      isCanceled: false,
    });
  });

  it("treats empty strings as absent, the way the sync does", () => {
    const f = readProbeFields(PAID_SO);
    if (!f) throw new Error("PAID_SO must read as a sales order");
    expect(f.trackingNumber).toBeNull();
    expect(f.shipper).toBeNull();
    expect(f.invoiceNo).toBeNull();
  });

  it("reads the same fields out of a { data: … } envelope", () => {
    expect(readProbeFields({ data: INVOICED_SO })?.invoiceNo).toBe("FV-00044120");
  });

  it("returns null for anything without a recognisable header", () => {
    expect(readProbeFields(null)).toBeNull();
    expect(readProbeFields("nope")).toBeNull();
    expect(readProbeFields([1, 2])).toBeNull();
    expect(readProbeFields({ foo: 1 })).toBeNull();
  });
});

describe("diffProbeFields", () => {
  it("lists exactly the keys that moved, with before and after", () => {
    const diff = diffProbeFields(PAID_SO, INVOICED_SO);
    const byKey = Object.fromEntries(diff.map((d) => [d.key, d]));
    expect(Object.keys(byKey).sort()).toEqual([
      "channel_status",
      "internal_status",
      "invoice_id",
      "invoice_no",
      "updated_at",
      "wms_status",
    ]);
    expect(byKey.internal_status).toMatchObject({
      kind: "changed",
      before: "PAID",
      after: "COMPLETED",
    });
    expect(byKey.invoice_no).toMatchObject({
      kind: "added",
      before: null,
      after: "FV-00044120",
    });
  });

  it("reports a disappeared key", () => {
    const diff = diffProbeFields({ a: 1, b: 2 }, { a: 1 });
    expect(diff).toEqual([{ key: "b", kind: "removed", before: 2, after: null }]);
  });

  it("is empty when nothing changed", () => {
    expect(diffProbeFields(PAID_SO, { ...PAID_SO })).toEqual([]);
  });

  it("keys nested changes as one entry with serialised values", () => {
    const diff = diffProbeFields(
      { items: [{ qty: 1 }], status: "PAID" },
      { items: [{ qty: 2 }], status: "PAID" },
    );
    expect(diff).toHaveLength(1);
    expect(diff[0]?.key).toBe("items");
    expect(diffProbeFields({ items: [{ qty: 1 }] }, { items: [{ qty: 1 }] })).toEqual([]);
  });
});

describe("formatProbeValue", () => {
  it("renders primitives plainly and objects compactly", () => {
    expect(formatProbeValue(null)).toBe("—");
    expect(formatProbeValue("")).toBe("(kosong)");
    expect(formatProbeValue(true)).toBe("true");
    expect(formatProbeValue(192297)).toBe("192297");
    expect(formatProbeValue({ a: 1 })).toBe('{"a":1}');
    expect(formatProbeValue(undefined)).toBe("—");
  });

  it("cuts a long value so one row stays one row", () => {
    expect(formatProbeValue("x".repeat(500)).length).toBeLessThanOrEqual(201);
    expect(formatProbeValue("x".repeat(500)).endsWith("…")).toBe(true);
  });
});
