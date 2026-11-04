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
  if (!auth)
    return jsonError(401, "Anda belum masuk. Masuk dulu untuk mengubah sesi.");
  const user = auth.user;
  if (user.role !== "OWNER")
    return jsonError(403, "Hanya admin yang bisa mengubah sesi ini.");

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return jsonError(400, "ID sesi tidak valid.");

  const [target] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!target) return jsonError(404, "Sesi tidak ditemukan.");

  if (target.status === "ENDED")
    return jsonError(409, "Sesi ini sudah berakhir.");

  const [updated] = await db
    .update(flashSessions)
    .set({ status: "ENDED" })
    .where(eq(flashSessions.id, id))
    .returning();
  return Response.json({ ok: true, session: updated });
}
