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

type Candidate = { id: string; startTime: Date; endTime: Date };

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
