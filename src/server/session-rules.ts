import { ne } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { flashSessions } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";

export function hasOverlap(
  a: { startTime: Date; endTime: Date },
  b: { startTime: Date; endTime: Date },
): boolean {
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

export type ActivationResult =
  { ok: true } | { ok: false; reason: "OVERLAP" | "PAUSED_BLOCK" };

/** The block reason shared by `canActivate` and `activationPreview`. */
export type ActivationBlockReason = Extract<
  ActivationResult,
  { ok: false }
>["reason"];

/**
 * Human, actionable copy for each activation block. The API returns it in the
 * 409 `error` field and the admin list reuses it for the disabled-button
 * tooltip + inline hint, so one string explains every refusal.
 */
const ACTIVATION_BLOCK_MESSAGES: Record<ActivationBlockReason, string> = {
  OVERLAP: "Jam sesi ini bertabrakan dengan sesi lain. Ubah jam salah satunya dulu.",
  PAUSED_BLOCK:
    "Masih ada sesi yang dijeda. Lanjutkan atau akhiri sesi itu sebelum mengaktifkan sesi baru.",
};

export function activationBlockMessage(reason: ActivationBlockReason): string {
  return ACTIVATION_BLOCK_MESSAGES[reason];
}

type Candidate = { id: string; startTime: Date; endTime: Date };

/**
 * A row from an already-loaded session list — the minimum `activationPreview`
 * needs to re-run the `canActivate` rules without touching the DB. Structurally
 * satisfied by `flashSessions` select rows.
 */
export type ActivationPreviewRow = {
  id: string;
  status: string;
  startTime: Date | null;
  endTime: Date | null;
};

/**
 * Non-DB twin of `canActivate`: same rules, same priority (PAUSED_BLOCK first,
 * then OVERLAP), but evaluated against an already-loaded list so the admin
 * session list can pre-compute why Aktifkan would fail. Returns the block
 * reason, or `null` when activation would succeed.
 *
 * `sessions` must contain the candidate's own row (looked up by `candidateId`);
 * rows without both times never overlap — mirroring the DB check.
 */
export function activationPreview(
  sessions: readonly ActivationPreviewRow[],
  candidateId: string,
): ActivationBlockReason | null {
  const others = sessions.filter((row) => row.id !== candidateId);

  // A PAUSED session blocks activation regardless of date overlap (G4).
  if (others.some((row) => row.status === "PAUSED")) {
    return "PAUSED_BLOCK";
  }

  const candidate = sessions.find((row) => row.id === candidateId);
  const candidateStart = candidate?.startTime ?? null;
  const candidateEnd = candidate?.endTime ?? null;
  if (!candidateStart || !candidateEnd) {
    // No window to compare — `canActivate` rejects these earlier at the
    // route level; a preview can only say "nothing blocks it here".
    return null;
  }

  const overlap = others.some(
    (row) =>
      (row.status === "SCHEDULED" || row.status === "ACTIVE") &&
      row.startTime !== null &&
      row.endTime !== null &&
      hasOverlap(
        { startTime: row.startTime, endTime: row.endTime },
        { startTime: candidateStart, endTime: candidateEnd },
      ),
  );
  return overlap ? "OVERLAP" : null;
}

export async function canActivate(
  db: Pick<PostgresJsDatabase<typeof schema>, "select">,
  candidate: Candidate,
): Promise<ActivationResult> {
  // Fetch all sessions except the candidate's own row.
  const existing = await db
    .select()
    .from(flashSessions)
    .where(ne(flashSessions.id, candidate.id));

  // A PAUSED session blocks activation regardless of date overlap (G4).
  if (existing.some((row) => row.status === "PAUSED")) {
    return { ok: false, reason: "PAUSED_BLOCK" };
  }

  // SCHEDULED/ACTIVE sessions block activation when their windows overlap.
  const overlap = existing.some(
    (row) =>
      (row.status === "SCHEDULED" || row.status === "ACTIVE") &&
      row.startTime !== null &&
      row.endTime !== null &&
      hasOverlap(
        { startTime: row.startTime, endTime: row.endTime },
        { startTime: candidate.startTime, endTime: candidate.endTime },
      ),
  );
  if (overlap) return { ok: false, reason: "OVERLAP" };

  return { ok: true };
}
