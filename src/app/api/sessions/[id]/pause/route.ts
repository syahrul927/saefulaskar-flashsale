import { eq } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { flashSessions } from "@/server/db/schema";
import { z } from "zod";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

/**
 * POST /api/sessions/[id]/pause — pause an ACTIVE session (spec §4.2: ACTIVE →
 * PAUSED). Admin-only. A PAUSED session blocks creation of any new session
 * until it is ENDED (or resumed).
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
  if (target.status !== "ACTIVE")
    return jsonError(409, "Only ACTIVE sessions can be paused");

  const [updated] = await db
    .update(flashSessions)
    .set({ status: "PAUSED" })
    .where(eq(flashSessions.id, id))
    .returning();
  return Response.json({ ok: true, session: updated });
}