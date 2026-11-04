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
 * POST /api/sessions/[id]/resume — resume a PAUSED session back to ACTIVE
 * (spec §4.2: PAUSED → ACTIVE). Admin-only. Re-runs the conflict rules (a
 * resume can only succeed if no other SCHEDULED/ACTIVE session overlaps).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth)
    return jsonError(401, "Anda belum masuk. Masuk dulu untuk mengubah sesi.");
  if (auth.user.role !== "OWNER")
    return jsonError(403, "Hanya admin yang bisa mengubah sesi ini.");

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return jsonError(400, "ID sesi tidak valid.");

  const [target] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!target) return jsonError(404, "Sesi tidak ditemukan.");
  if (target.status !== "PAUSED")
    return jsonError(409, "Hanya sesi yang dijeda yang bisa dilanjutkan.");

  if (target.startTime === null || target.endTime === null)
    return jsonError(
      409,
      "Jam sesi belum dilengkapi. Isi jam mulai dan jam selesai dulu sebelum melanjutkan sesi.",
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