"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  FloppyDiskIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";

import { Panel } from "@/app/_components/panel";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Mockup field labels (`design.html:198-222`): uppercase micro, quiet ink. */
const FIELD_LABEL_CLASS =
  "text-[9px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400";

/** Shared input shell; `font-mono` is added only on the temporal fields. */
const INPUT_CLASS = "h-10 bg-neutral-50 text-sm dark:bg-input/30";

export type SessionFormInitial = {
  name: string;
  /** `datetime-local` string (YYYY-MM-DDTHH:mm), precomputed server-side. */
  startTime: string;
  endTime: string;
};

export type SessionFormProps = {
  mode: "create" | "edit";
  sessionId?: string;
  initial?: SessionFormInitial;
};

/**
 * Create / edit a flash-sale session (spec §4.2). Emits ISO datetime strings
 * (the session routes validate `z.string().datetime()`), shows overlap errors
 * from the API as toasts, and sets `isLoading` while in-flight (G13).
 *
 * Presentation follows the mockup's "Live Session Parameters" card
 * (`design.html:184-229`): the fields sit inside a `Panel` with the brand
 * gradient bar + dot title, labels are uppercase micro, and only the datetime
 * inputs are mono — the session name stays proportional.
 */
function SessionForm({ mode, sessionId, initial }: SessionFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const [name, setName] = useState(initial?.name ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const startIso = new Date(startTime).toISOString();
    const endIso = new Date(endTime).toISOString();
    if (Number.isNaN(Date.parse(startIso)) || Number.isNaN(Date.parse(endIso))) {
      toast.error("Waktu mulai/akhir tidak valid.");
      return;
    }

    setIsLoading(true);
    try {
      const url =
        mode === "create" ? "/api/sessions" : `/api/sessions/${sessionId}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          startTime: startIso,
          endTime: endIso,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Gagal menyimpan sesi, coba lagi.");
        return;
      }
      toast.success(
        mode === "create" ? "Sesi dibuat." : "Sesi diperbarui.",
      );
      router.push("/admin");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Panel title="Parameter Sesi Live" dot>
      <form onSubmit={handleSubmit} className="space-y-4 p-4 sm:p-6">
        <Field className="gap-1.5">
          <FieldLabel htmlFor="session-name" className={FIELD_LABEL_CLASS}>
            Nama sesi
          </FieldLabel>
          <Input
            id="session-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isLoading}
            className={`${INPUT_CLASS} font-semibold`}
            placeholder="Flash sale akhir bulan"
            required
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="gap-1.5">
            <FieldLabel htmlFor="session-start" className={FIELD_LABEL_CLASS}>
              Waktu mulai
            </FieldLabel>
            <Input
              id="session-start"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={isLoading}
              className={`${INPUT_CLASS} font-mono text-xs tabular-nums`}
              required
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="session-end" className={FIELD_LABEL_CLASS}>
              Waktu selesai
            </FieldLabel>
            <Input
              id="session-end"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={isLoading}
              className={`${INPUT_CLASS} font-mono text-xs tabular-nums`}
              required
            />
          </Field>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" variant="ink" isLoading={isLoading}>
            {/* One glyph per verb: creating a session is an add, editing it is
                a save — the label already switches on `mode`, so the icon does
                too rather than claiming "save" on a blank form. */}
            {mode === "create" ? (
              <PlusIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <FloppyDiskIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
            )}
            {isLoading
              ? "Menyimpan..."
              : mode === "create"
                ? "Buat sesi"
                : "Simpan perubahan"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
            onClick={() => router.push("/admin")}
          >
            <XIcon weight="regular" className="size-4 shrink-0" aria-hidden="true" />
            Batal
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export { SessionForm };