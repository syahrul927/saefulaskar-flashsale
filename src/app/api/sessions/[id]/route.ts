import { and, eq, ne } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { flashSessions } from "@/server/db/schema";
import { activationBlockMessage, hasOverlap } from "@/server/session-rules";
import { z } from "zod";

export const runtime = "nodejs";

const UpdateSession = z
  .object({
    name: z.string().min(1).optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
  })
  .refine(
    (o) =>
      o.name !== undefined ||
      o.startTime !== undefined ||
      o.endTime !== undefined,
    {
      message: "At least one field to update is required",
    },
  );

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
) {
  return Response.json({ ok: false, error, ...extra }, { status });
}

/**
 * PATCH /api/sessions/[id] — edit a SCHEDULED session. Admin-only.
 * Config is frozen once a session leaves SCHEDULED (spec §5.9), so a session
 * in ACTIVE/PAUSED/ENDED is rejected with 409.
 * Editable fields: name, startTime, endTime. Re-checking overlap against the
 * other SCHEDULED/ACTIVE sessions so a resize can't collide.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth)
    return jsonError(401, "Anda belum masuk. Masuk dulu untuk mengubah sesi.");
  const user = auth.user;
  if (user.role !== "OWNER")
    return jsonError(403, "Hanya admin yang bisa mengubah sesi ini.");

  const { id } = await params;

  let body: z.infer<typeof UpdateSession>;
  try {
    body = UpdateSession.parse(await request.json());
  } catch {
    return jsonError(
      400,
      "Data yang dikirim tidak valid. Sertakan name, startTime (ISO), atau endTime (ISO).",
    );
  }

  const [target] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!target) return jsonError(404, "Sesi tidak ditemukan.");

  // Config frozen after scheduling (spec §5.9): only SCHEDULED is editable.
  if (target.status !== "SCHEDULED") {
    return jsonError(
      409,
      "Hanya sesi berstatus SCHEDULED yang bisa diubah.",
    );
  }

  const nextStart = body.startTime
    ? new Date(body.startTime)
    : target.startTime;
  const nextEnd = body.endTime ? new Date(body.endTime) : target.endTime;

  if (nextStart === null || nextEnd === null)
    return jsonError(
      409,
      "Jam sesi belum dilengkapi. Isi jam mulai dan jam selesai dulu sebelum mengubah jadwal sesi.",
    );
  if (nextEnd <= nextStart)
    return jsonError(400, "Jam selesai harus setelah jam mulai.");

  // A reschedule must not create an overlap with another SCHEDULED/ACTIVE
  // session. Run the check + update in a transaction.
  const result = await db.transaction(async (tx) => {
    const others = await tx
      .select()
      .from(flashSessions)
      .where(and(ne(flashSessions.id, id)));

    const conflict = others.some(
      (row) =>
        (row.status === "SCHEDULED" || row.status === "ACTIVE") &&
        row.startTime !== null &&
        row.endTime !== null &&
        hasOverlap(
          { startTime: row.startTime, endTime: row.endTime },
          { startTime: nextStart, endTime: nextEnd },
        ),
    );
    if (conflict) return { ok: false as const, reason: "OVERLAP" as const };

    const [updated] = await tx
      .update(flashSessions)
      .set({
        ...(body.name !== undefined
          ? { name: body.name, sessionName: body.name }
          : {}),
        ...(body.startTime !== undefined ? { startTime: nextStart } : {}),
        ...(body.endTime !== undefined ? { endTime: nextEnd } : {}),
      })
      .where(eq(flashSessions.id, id))
      .returning();

    return { ok: true as const, updated };
  });

  // `reason` stays machine-readable for the client; `error` is the copy.
  if (!result.ok)
    return jsonError(409, activationBlockMessage(result.reason), {
      reason: result.reason,
    });

  return Response.json({ ok: true, session: result.updated });
}

/** DELETE /api/sessions/[id] — remove a SCHEDULED session. Admin-only. */
export async function DELETE(
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

  const [target] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!target) return jsonError(404, "Sesi tidak ditemukan.");
  if (target.status !== "SCHEDULED")
    return jsonError(
      409,
      "Hanya sesi berstatus SCHEDULED yang bisa dihapus.",
    );

  await db.delete(flashSessions).where(eq(flashSessions.id, id));
  return Response.json({ ok: true });
}
