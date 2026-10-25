import { eq } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { flashSessions } from "@/server/db/schema";
import { canActivate } from "@/server/session-rules";
import { z } from "zod";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

/**
 * POST /api/sessions/[id]/resume — resume a PAUSED session back to ACTIVE
 * (spec §4.2: PAUSED → ACTIVE). Admin-only. Re-runs the conflict rules (a
 * resume can only succeed if no other SCHEDULED/ACTIVE session overlaps).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return jsonError(400, "Invalid session id");

  const [target] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!target) return jsonError(404, "Session not found");
  if (target.status !== "PAUSED")
    return jsonError(409, "Only PAUSED sessions can be resumed");

  if (target.startTime === null || target.endTime === null)
    return jsonError(409, "Session is missing times and cannot be resumed");

  const verdict = await canActivate(db, {
    id: target.id,
    startTime: target.startTime,
    endTime: target.endTime,
  });
  if (!verdict.ok) return jsonError(409, verdict.reason);

  const [updated] = await db
    .update(flashSessions)
    .set({ status: "ACTIVE" })
    .where(eq(flashSessions.id, id))
    .returning();
  return Response.json({ ok: true, session: updated });
}