import { eq, ne } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { flashSessions } from "@/server/db/schema";
import {
  activationBlockMessage,
  canActivate,
  hasOverlap,
} from "@/server/session-rules";
import { z } from "zod";

export const runtime = "nodejs";

const CreateSession = z.object({
  name: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

/**
 * GET /api/sessions — list sessions.
 * Authenticated OWNER sees all; everyone else sees only ACTIVE sessions.
 */
export async function GET() {
  const auth = await getSession();
  const role = auth?.user.role;

  if (role === "OWNER") {
    const rows = await db.select().from(flashSessions);
    return Response.json({ ok: true, sessions: rows });
  }

  const rows = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.status, "ACTIVE"));
  return Response.json({ ok: true, sessions: rows });
}

/**
 * POST /api/sessions — create a session. Admin-only.
 * Body: { name, startTime, endTime }, status defaults to SCHEDULED.
 * The check + insert run inside a transaction so a concurrent create can't
 * slip past the conflict rules.
 */
export async function POST(request: Request) {
  const auth = await getSession();
  if (!auth)
    return jsonError(401, "Anda belum masuk. Masuk dulu untuk mengubah sesi.");
  const user = auth.user;
  if (user.role !== "OWNER")
    return jsonError(403, "Hanya admin yang bisa mengubah sesi ini.");

  let body: z.infer<typeof CreateSession>;
  try {
    body = CreateSession.parse(await request.json());
  } catch {
    return jsonError(
      400,
      "Data yang dikirim tidak valid. Sertakan name, startTime (ISO), dan endTime (ISO).",
    );
  }

  const startTime = new Date(body.startTime);
  const endTime = new Date(body.endTime);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()))
    return jsonError(400, "Format waktu tidak valid. Gunakan tanggal dan jam yang benar.");
  if (endTime <= startTime)
    return jsonError(400, "Jam selesai harus setelah jam mulai.");

  const candidateId = crypto.randomUUID();

  const result = await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(flashSessions)
      .where(ne(flashSessions.id, candidateId));

    // PAUSED session is a global block on any new SCHEDULED session (G4).
    if (existing.some((row) => row.status === "PAUSED")) {
      return { ok: false, reason: "PAUSED_BLOCK" as const };
    }

    // Reject when the new window overlaps a SCHEDULED/ACTIVE session.
    const conflict = existing.some(
      (row) =>
        (row.status === "SCHEDULED" || row.status === "ACTIVE") &&
        row.startTime !== null &&
        row.endTime !== null &&
        hasOverlap(
          { startTime: row.startTime, endTime: row.endTime },
          { startTime, endTime },
        ),
    );
    if (conflict) return { ok: false, reason: "OVERLAP" as const };

    const [created] = await tx
      .insert(flashSessions)
      .values({
        name: body.name,
        sessionName: body.name,
        startTime,
        endTime,
        status: "SCHEDULED",
      })
      .returning();

    return { ok: true as const, created };
  });

  if (!result.ok) {
    // The 409 `error` is user-facing toast copy (the create form shows it
    // verbatim), so it carries the same human message the session editor and
    // PATCH use; the machine `reason` enum stays in session-rules.
    return jsonError(409, activationBlockMessage(result.reason));
  }

  return Response.json({ ok: true, session: result.created }, { status: 201 });
}
