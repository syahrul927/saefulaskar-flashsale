import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Proof-of-transfer constraints (spec §4.5, Task 7). */
export const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_PROOF_TYPES = ["image/jpeg", "image/png"] as const;

export type ValidateProofResult =
  | { ok: true }
  | { ok: false; error: "TOO_LARGE" | "INVALID_TYPE" };

/**
 * Validate an uploaded transfer-proof file before it touches disk.
 * Pure — testable without HTTP or the filesystem.
 */
export function validateProof(input: {
  size: number;
  type: string;
}): ValidateProofResult {
  if (input.size > MAX_PROOF_BYTES) return { ok: false, error: "TOO_LARGE" };
  if (!(ALLOWED_PROOF_TYPES as readonly string[]).includes(input.type)) {
    return { ok: false, error: "INVALID_TYPE" };
  }
  return { ok: true };
}

/** Write an upload buffer under `public/uploads` with a randomized name. */
export async function saveProof(file: {
  buffer: Buffer;
  type: string;
}): Promise<{ url: string }> {
  const ext = file.type === "image/png" ? "png" : "jpg";
  const name = `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), file.buffer);
  return { url: `/uploads/${name}` };
}