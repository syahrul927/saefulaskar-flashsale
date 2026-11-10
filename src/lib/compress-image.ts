/**
 * Client-side proof-image compression module.
 *
 * Trivial placeholder — the real canvas compression lands in Task 4, which
 * replaces only the body of `compressToDataUri` (signature is final).
 */

/** Raw upload cap before compression. */
export const MAX_RAW_PROOF_BYTES = 25 * 1024 * 1024;

/** Thrown by `compressToDataUri` when the picked file exceeds the raw cap. */
export class ProofTooLargeError extends Error {
  constructor() {
    super("Proof image exceeds the raw size cap");
    this.name = "ProofTooLargeError";
  }
}

/**
 * Convert a picked image file into a JPEG data URI small enough for the
 * server validator (≤ 500 KB decoded).
 *
 * TODO(compress): replaced in Task 4 — for now the file is read to a data URI
 * as-is (no compression), so anything over the 500 KB server cap will fail
 * validation remotely.
 */
export async function compressToDataUri(file: File): Promise<string> {
  if (file.size > MAX_RAW_PROOF_BYTES) {
    throw new ProofTooLargeError();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
