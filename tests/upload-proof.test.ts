import { describe, expect, it } from "vitest";

import {
  MAX_PROOF_BYTES,
  validateProof,
} from "@/server/upload";

describe("validateProof", () => {
  it("rejects a png over 5 MB", () => {
    expect(
      validateProof({ size: 6 * 1024 * 1024, type: "image/png" }),
    ).toEqual({ ok: false, error: "TOO_LARGE" });
  });

  it("rejects a non-image type", () => {
    expect(
      validateProof({ size: 1024, type: "application/pdf" }),
    ).toEqual({ ok: false, error: "INVALID_TYPE" });
  });

  it("accepts a 3 MB jpeg", () => {
    expect(
      validateProof({ size: 3 * 1024 * 1024, type: "image/jpeg" }),
    ).toEqual({ ok: true });
  });

  it("rejects a file exactly at the limit + 1 byte", () => {
    expect(
      validateProof({ size: MAX_PROOF_BYTES + 1, type: "image/png" }),
    ).toEqual({ ok: false, error: "TOO_LARGE" });
  });

  it("accepts a file exactly at the limit", () => {
    expect(
      validateProof({ size: MAX_PROOF_BYTES, type: "image/png" }),
    ).toEqual({ ok: true });
  });
});