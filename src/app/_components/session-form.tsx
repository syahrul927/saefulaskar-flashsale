"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

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
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field>
        <FieldLabel htmlFor="session-name">Nama sesi</FieldLabel>
        <Input
          id="session-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isLoading}
          className="h-11"
          placeholder="Flash sale akhir bulan"
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="session-start">Waktu mulai</FieldLabel>
          <Input
            id="session-start"
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            disabled={isLoading}
            className="h-11"
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="session-end">Waktu selesai</FieldLabel>
          <Input
            id="session-end"
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            disabled={isLoading}
            className="h-11"
            required
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? <Spinner /> : null}
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
          Batal
        </Button>
      </div>
    </form>
  );
}

export { SessionForm };