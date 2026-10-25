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
 * POST /api/sessions/[id]/activate — promote a session to ACTIVE. Admin-only.
 * Runs the conflict rules (PAUSED_BLOCK, OVERLAP); on failure returns 409.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  const user = auth.user;
  if ((user.role as string) !== "OWNER") return jsonError(403, "Forbidden");

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return jsonError(400, "Invalid session id");

  const [target] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!target) return jsonError(404, "Session not found");
  if (target.status !== "SCHEDULED")
    return jsonError(409, "Only SCHEDULED sessions can be activated");

  if (target.startTime === null || target.endTime === null)
    return jsonError(409, "Session is missing times and cannot be activated");

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
