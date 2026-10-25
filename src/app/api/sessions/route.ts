import { eq, ne } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { flashSessions } from "@/server/db/schema";
import { canActivate, hasOverlap } from "@/server/session-rules";
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
  if (!auth) return jsonError(401, "Unauthorized");
  const user = auth.user;
  if ((user.role as string) !== "OWNER") return jsonError(403, "Forbidden");

  let body: z.infer<typeof CreateSession>;
  try {
    body = CreateSession.parse(await request.json());
  } catch {
    return jsonError(
      400,
      "Invalid body: name, startTime (ISO), endTime (ISO) required",
    );
  }

  const startTime = new Date(body.startTime);
  const endTime = new Date(body.endTime);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()))
    return jsonError(400, "startTime/endTime must be valid ISO dates");
  if (endTime <= startTime)
    return jsonError(400, "endTime must be after startTime");

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
    return jsonError(409, result.reason);
  }

  return Response.json({ ok: true, session: result.created }, { status: 201 });
}
