import { eq } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { flashSessions } from "@/server/db/schema";
import { activationBlockMessage, canActivate } from "@/server/session-rules";
import { z } from "zod";

export const runtime = "nodejs";

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
) {
  return Response.json({ ok: false, error, ...extra }, { status });
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
  if (target.status !== "SCHEDULED")
    return jsonError(
      409,
      "Hanya sesi berstatus SCHEDULED yang bisa diaktifkan.",
    );

  if (target.startTime === null || target.endTime === null)
    return jsonError(
      409,
      "Jam sesi belum dilengkapi. Isi jam mulai dan jam selesai dulu sebelum mengaktifkan sesi.",
    );

  const verdict = await canActivate(db, {
    id: target.id,
    startTime: target.startTime,
    endTime: target.endTime,
  });
  // `reason` stays machine-readable for the client; `error` is the copy.
  if (!verdict.ok)
    return jsonError(409, activationBlockMessage(verdict.reason), {
      reason: verdict.reason,
    });

  const [updated] = await db
    .update(flashSessions)
    .set({ status: "ACTIVE" })
    .where(eq(flashSessions.id, id))
    .returning();
  return Response.json({ ok: true, session: updated });
}
