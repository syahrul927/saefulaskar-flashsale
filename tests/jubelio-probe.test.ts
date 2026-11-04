import { describe, expect, it } from "vitest";

import {
  SINK_MAX_BODY_BYTES,
  captureBody,
  checkSinkToken,
  detectCaptureRefs,
  redactHeaders,
} from "@/server/jubelio-probe";

/**
 * Pure core of the Jubelio webhook sink — the observation half of the rig
 * (spec §4.7), and the question it exists to answer: what does a Jubelio
 * webhook POST actually contain? Fixtures below are live-shaped, probed
 * 2026-10-29: SO 192297 (our own PAID order), invoice 44120.
 */

describe("checkSinkToken", () => {
  it("accepts any path segment while no sink token is configured", () => {
    // The bench has to work without minting a secret first; the token is a
    // hardening step, not a prerequisite.
    expect(checkSinkToken("anything", undefined)).toBe(true);
    expect(checkSinkToken("anything", "")).toBe(true);
    expect(checkSinkToken(undefined, "   ")).toBe(true);
  });

  it("accepts only the exact configured token once one is set", () => {
    expect(checkSinkToken("abc123", "abc123")).toBe(true);
    expect(checkSinkToken("abc124", "abc123")).toBe(false);
    expect(checkSinkToken("", "abc123")).toBe(false);
    // Trailing whitespace in a pasted secret is the most common way this fails
    // in real life, and it must read as a mismatch, not a hit.
    expect(checkSinkToken("abc123 ", "abc123")).toBe(false);
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

