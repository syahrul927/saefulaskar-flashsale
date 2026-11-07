import { describe, expect, it } from "vitest";

import {
  checkHookToken,
  decideHookFlip,
  parseHookEvent,
  parseInvoiceHookRef,
} from "@/server/invoice-hook";

/**
 * Pure core of the Jubelio invoice-webhook consumer — the parse/decision half
 * that the consumer route (Task 3) wraps in HTTP. Pinned to the live capture
 * of 2026-11-07/08 (spec §1) and the owner-verified `SO-<digits>` join
 * (spec §2, verified 2026-11-08): our own hooks echo `SO-000192297`-shape
 * numbers; the `SP-…` shape is marketplace traffic we must ignore.
 */

/** The spec §1 capture, live-shaped. */
const CAPTURE = {
  action: "hook-invoice",
  ref_no: "SO-000192297",
  invoice_id: 188102,
  invoice_no: "INV-000188102",
};

describe("parseInvoiceHookRef", () => {
  it("parses the owner-verified SO number shape", () => {
    expect(parseInvoiceHookRef("SO-000192297")).toBe(192297);
    // Padding is not guaranteed — the number, not the format, is the contract.
    expect(parseInvoiceHookRef("SO-192297")).toBe(192297);
    // Defensive: bare digits accepted in case the body format drifts (spec §8.3).
    expect(parseInvoiceHookRef("192297")).toBe(192297);
    // Trimmed before the match, so a pasted/logged value with air still joins.
    expect(parseInvoiceHookRef(" SO-000192297 ")).toBe(192297);
  });

  it("rejects everything that is not our own SO echo", () => {
    // The live marketplace capture from the observation sink (spec §1).
    expect(parseInvoiceHookRef("SP-261107NGP1K1DB")).toBeNull();
    expect(parseInvoiceHookRef("")).toBeNull();
    expect(parseInvoiceHookRef("SO-")).toBeNull();
    expect(parseInvoiceHookRef("SO-0")).toBeNull();
    expect(parseInvoiceHookRef("  ")).toBeNull();
    expect(parseInvoiceHookRef(null)).toBeNull();
    expect(parseInvoiceHookRef(undefined)).toBeNull();
    expect(parseInvoiceHookRef(42)).toBeNull();
    expect(parseInvoiceHookRef("SO-12ab")).toBeNull();
  });
});

describe("parseHookEvent", () => {
  it("parses the spec §1 capture into the ids the route joins on", () => {
    expect(parseHookEvent(CAPTURE)).toEqual({
      action: "hook-invoice",
      salesorderId: 192297,
      invoiceId: 188102,
      invoiceNo: "INV-000188102",
    });
  });

  it("accepts a numeric-string invoice id and rejects non-positive ones", () => {
    expect(parseHookEvent({ ...CAPTURE, invoice_id: "188102" })).toEqual({
      action: "hook-invoice",
      salesorderId: 192297,
      invoiceId: 188102,
      invoiceNo: "INV-000188102",
    });
    expect(parseHookEvent({ ...CAPTURE, invoice_id: 0 })).toEqual({
      action: "hook-invoice",
      salesorderId: 192297,
      invoiceId: null,
      invoiceNo: "INV-000188102",
    });
    expect(parseHookEvent({ ...CAPTURE, invoice_id: -5 })).toEqual({
      action: "hook-invoice",
      salesorderId: 192297,
      invoiceId: null,
      invoiceNo: "INV-000188102",
    });
  });

  it("keeps a hook-invoice event parseable when ids are missing — null fields, not an error", () => {
    expect(parseHookEvent({ action: "hook-invoice" })).toEqual({
      action: "hook-invoice",
      salesorderId: null,
      invoiceId: null,
      invoiceNo: null,
    });
    expect(parseHookEvent({ ...CAPTURE, invoice_no: undefined })).toEqual({
      action: "hook-invoice",
      salesorderId: 192297,
      invoiceId: 188102,
      invoiceNo: null,
    });
  });

  it("marks the event unjoined when ref_no is missing or not our SO shape", () => {
    const expected = {
      action: "hook-invoice",
      salesorderId: null,
      invoiceId: 188102,
      invoiceNo: "INV-000188102",
    };
    // null salesorderId is how the route knows to answer {ok:false, reason:"unjoined"}.
    expect(parseHookEvent({ ...CAPTURE, ref_no: undefined })).toEqual(expected);
    expect(parseHookEvent({ ...CAPTURE, ref_no: "SP-261107NGP1K1DB" })).toEqual(expected);
  });

  it("classifies other known Jubelio events as other", () => {
    expect(parseHookEvent({ action: "hook-salesorder" })).toEqual({
      action: "other",
      actionName: "hook-salesorder",
    });
  });

  it("answers null for a body that is not an object", () => {
    expect(parseHookEvent([])).toBeNull();
    expect(parseHookEvent("text")).toBeNull();
    expect(parseHookEvent(null)).toBeNull();
    expect(parseHookEvent(undefined)).toBeNull();
  });

  it("passes unknown action strings through untouched for the log line", () => {
    expect(parseHookEvent({ action: "hook-stock" })).toEqual({
      action: "other",
      actionName: "hook-stock",
    });
  });
});

describe("decideHookFlip", () => {
  it("routes a cancelled SO to the cancel path, case and space tolerant", () => {
    expect(decideHookFlip("CANCELED")).toBe("cancel");
    expect(decideHookFlip(" canceled ")).toBe("cancel");
    expect(decideHookFlip("Canceled")).toBe("cancel");
  });

  it("flips on every other SO state — existence of our SO is the evidence (spec §4.3)", () => {
    for (const status of ["COMPLETED", "PAID", "SHIPPED", "PENDING", "weird"]) {
      expect(decideHookFlip(status)).toBe("flip");
    }
  });
});

describe("checkHookToken", () => {
  it("denies everything while no hook token is configured — inverted from the sink (spec §4.1)", () => {
    // The inverted default is the point: a consumer that writes orders must not
    // be open by default the way the observation sink is.
    expect(checkHookToken("tok", undefined)).toBe(false);
    expect(checkHookToken(undefined, undefined)).toBe(false);
    expect(checkHookToken("tok", "")).toBe(false);
    expect(checkHookToken("tok", "   ")).toBe(false);
  });

  it("accepts only the exact configured token once one is set", () => {
    expect(checkHookToken("tok", "tok")).toBe(true);
    // No normalisation of the incoming value — a paste with trailing
    // whitespace is a mismatch, same as the sink.
    expect(checkHookToken("tok ", "tok")).toBe(false);
    // The configured value IS trimmed — the exact asymmetry checkSinkToken has,
    // pinned here so the two can never drift apart silently.
    expect(checkHookToken("tok", " tok")).toBe(true);
    expect(checkHookToken(undefined, "tok")).toBe(false);
    expect(checkHookToken("other", "tok")).toBe(false);
  });
});
