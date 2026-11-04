import type { Metadata } from "next";

import { SessionForm } from "@/app/_components/session-form";

export const metadata: Metadata = {
  title: "Sesi Baru — Flash Sale Grosir Admin",
};

export const dynamic = "force-dynamic";

/** New-session form (spec §4.2). The admin guard lives in `admin/layout.tsx`. */
export default function NewSessionPage() {
  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-heading text-lg font-black uppercase tracking-wider text-neutral-950 sm:text-xl dark:text-neutral-50">
          Sesi Baru
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Jadwalkan flash sale baru. Pastikan tidak bentrok dengan sesi lain.
        </p>
      </div>

      {/* `SessionForm` brings its own `Panel` — the card is the form. */}
      <div className="max-w-xl">
        <SessionForm mode="create" />
      </div>
    </main>
  );
}