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
 * POST /api/sessions/[id]/end — mark a session ENDED. Admin-only.
 * ENDED is terminal: it keeps the historical record, and after it there is no
 * confirm dialog per spec §4.2.
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

  if (target.status === "ENDED")
    return jsonError(409, "Session is already ended");

  const [updated] = await db
    .update(flashSessions)
    .set({ status: "ENDED" })
    .where(eq(flashSessions.id, id))
    .returning();
  return Response.json({ ok: true, session: updated });
}
