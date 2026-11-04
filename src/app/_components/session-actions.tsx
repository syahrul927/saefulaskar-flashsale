"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PauseIcon,
  PlayIcon,
  PencilIcon,
  StopIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";

import {
  activationBlockMessage,
  type ActivationBlockReason,
} from "@/server/session-rules";
import { Button } from "@/components/ui/button";

type ActionKey = "activate" | "pause" | "resume" | "end" | "delete";

/**
 * The request each status-transition button fires. Activate/pause/resume/end
 * are POSTs to their own subresource; delete has no subresource — DELETE is
 * handled on the session itself (`/api/sessions/[id]`), so there is no
 * `/delete` suffix to append.
 */
function sessionActionRequest(
  key: ActionKey,
  sessionId: string,
): { url: string; method: "POST" | "DELETE" } {
  if (key === "delete") {
    return { url: `/api/sessions/${sessionId}`, method: "DELETE" };
  }
  return { url: `/api/sessions/${sessionId}/${key}`, method: "POST" };
}

/**
 * Status-transition controls for a session row (spec §4.2):
 * - SCHEDULED → Activate / Edit / Delete
 * - ACTIVE    → Pause / End
 * - PAUSED    → Resume / End
 * - ENDED     → (none)
 * Every mutation sets `isLoading`, fires a sonner toast, then refreshes.
 *
 * `blockReason` is the admin list's pre-computed `activationPreview` verdict:
 * when set, Aktifkan is disabled up front (tooltip + quiet inline hint say
 * WHY) instead of letting the click bounce off the API's 409.
 */
function SessionActions({
  sessionId,
  status,
  blockReason = null,
}: {
  sessionId: string;
  status: string;
  blockReason?: ActivationBlockReason | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<ActionKey | null>(null);

  async function run(key: ActionKey) {
    setBusy(key);
    try {
      const { url, method } = sessionActionRequest(key, sessionId);
      const res = await fetch(url, { method });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Aksi gagal, coba lagi.");
        return;
      }
      toast.success(key === "delete" ? "Sesi dihapus." : "Status sesi diperbarui.");
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
    await run("delete");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {status === "SCHEDULED" && (
          <>
            <Button
              size="sm"
              disabled={busy !== null || blockReason !== null}
              title={
                blockReason ? activationBlockMessage(blockReason) : undefined
              }
              onClick={() => run("activate")}
            >
              <PlayIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
              {busy === "activate" ? "Mengaktifkan..." : "Aktifkan"}
            </Button>
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/admin/sessions/${sessionId}/edit`} />}>
              <PencilIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
              Ubah
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={handleDelete}>
              <TrashIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
              Hapus
            </Button>
          </>
        )}
        {status === "ACTIVE" && (
          <>
            <Button size="sm" disabled={busy !== null} onClick={() => run("pause")}>
              <PauseIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
              {busy === "pause" ? "Menjeda..." : "Jeda"}
            </Button>
            <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => run("end")}>
              <StopIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
              Akhiri
            </Button>
          </>
        )}
        {status === "PAUSED" && (
          <>
            <Button size="sm" disabled={busy !== null} onClick={() => run("resume")}>
              <PlayIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
              {busy === "resume" ? "Melanjutkan..." : "Lanjutkan"}
            </Button>
            <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => run("end")}>
              <StopIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
              Akhiri
            </Button>
          </>
        )}
      </div>
      {/* Quiet inline reason for the greyed-out Aktifkan — the disabled
          button's title is invisible to touch, so the copy lives here too. */}
      {status === "SCHEDULED" && blockReason && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {activationBlockMessage(blockReason)}
        </p>
      )}
    </div>
  );
}

export { SessionActions, sessionActionRequest };