"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type ActionKey = "activate" | "pause" | "resume" | "end" | "delete";

/**
 * Status-transition controls for a session row (spec §4.2):
 * - SCHEDULED → Activate / Edit / Delete
 * - ACTIVE    → Pause / End
 * - PAUSED    → Resume / End
 * - ENDED     → (none)
 * Every mutation sets `isLoading`, fires a sonner toast, then refreshes.
 */
function SessionActions({
  sessionId,
  status,
}: {
  sessionId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<ActionKey | null>(null);

  async function run(key: ActionKey, method: "POST" | "DELETE") {
    setBusy(key);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/${key}`, { method });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Aksi gagal, coba lagi.");
        return;
      }
      toast.success("Status sesi diperbarui.");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (
      !window.confirm(
        "Hapus sesi ini? Sesi yang dijadwalkan akan dihapus permanen.",
      )
    )
      return;
    await run("delete", "DELETE");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "SCHEDULED" && (
        <>
          <Button size="sm" disabled={busy !== null} onClick={() => run("activate", "POST")}>
            {busy === "activate" ? "Mengaktifkan..." : "Aktifkan"}
          </Button>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/admin/sessions/${sessionId}/edit`} />}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={handleDelete}>
            Hapus
          </Button>
        </>
      )}
      {status === "ACTIVE" && (
        <>
          <Button size="sm" disabled={busy !== null} onClick={() => run("pause", "POST")}>
            {busy === "pause" ? "Menjeda..." : "Jeda"}
          </Button>
          <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => run("end", "POST")}>
            Akhiri
          </Button>
        </>
      )}
      {status === "PAUSED" && (
        <>
          <Button size="sm" disabled={busy !== null} onClick={() => run("resume", "POST")}>
            {busy === "resume" ? "Melanjutkan..." : "Lanjutkan"}
          </Button>
          <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => run("end", "POST")}>
            Akhiri
          </Button>
        </>
      )}
    </div>
  );
}

export { SessionActions };