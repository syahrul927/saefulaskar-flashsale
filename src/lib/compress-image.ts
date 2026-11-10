/**
 * Client-side proof-image compression module.
 *
 * Reads a picked image `File`, downscales it with an offscreen canvas so its
 * long edge is at most 1500 px, and encodes it as JPEG, walking scale factors
 * and quality settings down until the encoded blob fits the server validator's
 * data-URI cap (`MAX_PROOF_DATA_BYTES` from `@/lib/proof-image`, the single
 * source of truth for that limit). Resolves to a `data:image/jpeg;base64,...`
 * URI ready for the upload endpoint's `{ imageData }` JSON body.
 *
 * Browser-only: relies on `createImageBitmap`, canvas and `FileReader` — no
 * Node APIs. If nothing fits even at the smallest scale and floor quality, the
 * smallest attempt is resolved anyway; the server validator is the backstop.
 */

import { MAX_PROOF_DATA_BYTES } from "@/lib/proof-image";

/** Raw upload cap before compression. */
export const MAX_RAW_PROOF_BYTES = 25 * 1024 * 1024;

/** Thrown by `compressToDataUri` when the picked file exceeds the raw cap. */
export class ProofTooLargeError extends Error {
  constructor() {
    super("Proof image exceeds the raw size cap");
    this.name = "ProofTooLargeError";
  }
}

/** Long-edge cap for the compressed bitmap, in pixels. */
const MAX_EDGE = 1500;

/** Fractions of the capped dimensions tried in order, largest first. */
const SCALE_FACTORS = [1, 0.75, 0.5, 0.35];

/** Starting JPEG quality, per-attempt decrement, and lower bound. */
const QUALITY_START = 0.82;
const QUALITY_STEP = 0.12;
const QUALITY_FLOOR = 0.34;

/** `canvas.toBlob` callback wrapped as a promise (null blob → rejection). */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null")),
      type,
      quality,
    );
  });
}

/** `FileReader.readAsDataURL` wrapped as a promise. */
function readAsDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert a picked image file into a JPEG data URI small enough for the
 * server validator (≤ 500 KB decoded).
 *
 * Throws `ProofTooLargeError` when the raw file exceeds `MAX_RAW_PROOF_BYTES`.
 * Never rejects over size: if no scale/quality combination fits the cap, the
 * smallest encoded attempt is resolved and the server validator decides.
 */
export async function compressToDataUri(file: File): Promise<string> {
  if (file.size > MAX_RAW_PROOF_BYTES) {
    throw new ProofTooLargeError();
  }

  const bitmap = await createImageBitmap(file);
  try {
    // Scale so the long edge is at most MAX_EDGE, preserving aspect ratio.
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const cappedScale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;

    let smallest: { uri: string; bytes: number } | null = null;

    for (const factor of SCALE_FACTORS) {
      const scale = cappedScale * factor;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("canvas 2d context unavailable");
      }
      ctx.drawImage(bitmap, 0, 0, width, height);

      for (
        let q = QUALITY_START;
        q >= QUALITY_FLOOR - 1e-9;
        q -= QUALITY_STEP
      ) {
        const blob = await canvasToBlob(canvas, "image/jpeg", q);
        const attempt = { uri: await readAsDataUri(blob), bytes: blob.size };
        if (blob.size <= MAX_PROOF_DATA_BYTES) {
          return attempt.uri;
        }
        if (!smallest || blob.size < smallest.bytes) {
          smallest = attempt;
        }
      }
      // A fit at a smaller scale makes larger-scale encodings pointless, and
      // the inner loop already early-returns on the first fit.
    }

    // Nothing fit even at the smallest scale and floor quality — hand over the
    // smallest attempt; the server validator is the backstop.
    return smallest ? smallest.uri : await readAsDataUri(file);
  } finally {
    bitmap.close();
  }
}
