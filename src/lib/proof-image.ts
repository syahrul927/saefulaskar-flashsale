/**
 * Pure, isomorphic validation for transfer-proof data URIs.
 *
 * No Buffer / atob / DOM — decoded size is computed from string-length
 * arithmetic so this is safe on both server and client.
 */

export const MAX_PROOF_DATA_BYTES = 500 * 1024;

export const PROOF_MIME_PREFIXES = [
  "data:image/jpeg;base64,",
  "data:image/png;base64,",
] as const;

const BASE64_PAYLOAD_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export type ImageDataUriResult =
  { ok: true; bytes: number } | { ok: false; error: "MALFORMED" | "TOO_LARGE" };

export function validateImageDataUri(dataUri: string): ImageDataUriResult {
  // Prefix must match exactly (case-sensitive), including the trailing comma.
  const prefix = PROOF_MIME_PREFIXES.find((p) => dataUri.startsWith(p));
  if (!prefix) {
    return { ok: false, error: "MALFORMED" };
  }
  const payload = dataUri.slice(prefix.length);

  // Non-empty, correct total length, only base64 alphabet, at most two
  // trailing '=' pads, and pads only at the very end.
  if (
    payload.length === 0 ||
    payload.length % 4 !== 0 ||
    !BASE64_PAYLOAD_RE.test(payload) ||
    payload.slice(0, -2).includes("=")
  ) {
    return { ok: false, error: "MALFORMED" };
  }

  // 4 base64 chars encode 3 bytes; each trailing '=' pad shortens the final
  // group by one byte (1 pad → 2 bytes, 2 pads → 1 byte).
  const padCount = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const bytes = (payload.length / 4) * 3 - padCount;
  if (bytes > MAX_PROOF_DATA_BYTES) {
    return { ok: false, error: "TOO_LARGE" };
  }
  return { ok: true, bytes };
}
