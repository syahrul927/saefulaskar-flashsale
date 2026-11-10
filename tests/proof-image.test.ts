import { describe, expect, it } from "vitest";

import { MAX_PROOF_DATA_BYTES, validateImageDataUri } from "@/lib/proof-image";

const jpeg = (payload: string) => `data:image/jpeg;base64,${payload}`;

// MAX % 3 === 2, so an exact-cap payload is floor(MAX/3) full 4-char groups
// (3 bytes each) plus one "AAA=" group (4 chars, 1 pad, 2 bytes).
const payloadAtCap =
  "A".repeat(Math.floor(MAX_PROOF_DATA_BYTES / 3) * 4) + "AAA=";
// (MAX + 1) % 3 === 0, so one byte over the cap is plain full groups.
const payloadOneOver = "A".repeat(((MAX_PROOF_DATA_BYTES + 1) / 3) * 4);

describe("validateImageDataUri", () => {
  it("accepts a small jpeg data URI and reports decoded byte length", () => {
    const result = validateImageDataUri(jpeg("aGVsbG8=")); // "hello"
    expect(result).toEqual({ ok: true, bytes: 5 });
  });

  it("accepts a png data URI", () => {
    const result = validateImageDataUri("data:image/png;base64,aGVsbG8=");
    expect(result).toEqual({ ok: true, bytes: 5 });
  });

  it("rejects non-image / wrong-type prefixes", () => {
    expect(validateImageDataUri("data:text/html;base64,aGVsbG8=").ok).toBe(
      false,
    );
    expect(validateImageDataUri("data:image/svg+xml;base64,aGVsbG8=").ok).toBe(
      false,
    );
    expect(validateImageDataUri("data:image/webp;base64,aGVsbG8=").ok).toBe(
      false,
    );
  });

  it("rejects missing or non-base64 payloads", () => {
    expect(validateImageDataUri("data:image/jpeg;base64,").ok).toBe(false);
    expect(validateImageDataUri("data:image/jpeg;base64,not@@base64!").ok).toBe(
      false,
    );
    expect(validateImageDataUri("data:image/jpeg;base64,aGVsbg").ok).toBe(
      false,
    ); // bad padding
    expect(validateImageDataUri("").ok).toBe(false);
  });

  it("accepts a payload exactly at the cap and rejects one byte over", () => {
    expect(validateImageDataUri(jpeg(payloadAtCap))).toEqual({
      ok: true,
      bytes: MAX_PROOF_DATA_BYTES,
    });
    expect(validateImageDataUri(jpeg(payloadOneOver))).toEqual({
      ok: false,
      error: "TOO_LARGE",
    });
  });

  it("matches mime prefixes exactly, including case", () => {
    expect(validateImageDataUri("DATA:IMAGE/JPEG;BASE64,aGVsbG8=").ok).toBe(
      false,
    );
    expect(validateImageDataUri("data:image/jpe;base64,aGVsbG8=").ok).toBe(
      false,
    );
    expect(validateImageDataUri("data:image/jpeg;base64, aGVsbG8=").ok).toBe(
      false,
    );
  });
});
