import type { Metadata } from "next";

import { SessionForm } from "@/app/_components/session-form";

export const metadata: Metadata = {
  title: "Sesi Baru — Flash Studio Admin",
};

export const dynamic = "force-dynamic";

/** New-session form (spec §4.2). The admin guard lives in `admin/layout.tsx`. */
export default function NewSessionPage() {
  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Sesi Baru
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Jadwalkan flash sale baru. Pastikan tidak bentrok dengan sesi lain.
        </p>
      </div>

      <div className="max-w-xl rounded-4xl border border-border bg-card p-6 shadow-sm">
        <SessionForm mode="create" />
      </div>
    </main>
  );
}