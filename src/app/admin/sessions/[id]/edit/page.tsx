import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/server/db";
import { flashSessions } from "@/server/db/schema";
import { SessionForm } from "@/app/_components/session-form";

export const metadata: Metadata = {
  title: "Ubah Sesi — Flash Sale Grosir Admin",
};

export const dynamic = "force-dynamic";

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Edit a session (spec §4.2). Only SCHEDULED sessions are editable (config
 * frozen once ACTIVE/PAUSED/ENDED, spec §5.9) — anything else bounces back to
 * the session list.
 */
export default async function EditSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [session] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));

  if (!session) notFound();
  if (session.status !== "SCHEDULED") redirect("/admin");

  const initial =
    session.startTime && session.endTime
      ? {
          name: session.name,
          startTime: toLocalInput(session.startTime),
          endTime: toLocalInput(session.endTime),
        }
      : undefined;

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-heading text-lg font-black uppercase tracking-wider text-neutral-950 sm:text-xl dark:text-neutral-50">
          Edit Sesi
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Ubah nama atau jadwal sesi yang belum aktif.
        </p>
      </div>

      {/* Same panel as the create flow, seeded with the stored parameters. */}
      <div className="max-w-xl">
        <SessionForm mode="edit" sessionId={session.id} initial={initial} />
      </div>
    </main>
  );
}