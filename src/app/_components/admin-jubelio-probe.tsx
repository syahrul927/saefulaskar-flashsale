"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  TerminalIcon,
} from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyChip } from "@/app/_components/copy-chip";
import {
  isPulseStatus,
  orderStatusTone,
  StatusBadge,
  type OrderStatus,
} from "@/app/_components/status-badge";
import { Panel } from "@/app/_components/panel";
import { formatProbeValue, type ProbeDiffEntry } from "@/server/jubelio-probe";

export type ProbeOrder = {
  orderId: string;
  bookingId: string;
  status: OrderStatus;
  salesorderId: number;
};

export type ProbeSnapshot = {
  id: string;
  salesorderId: number;
  bookingId: string | null;
  label: string | null;
  capturedBy: string;
  capturedAt: string;
  internalStatus: string | null;
  channelStatus: string | null;
  wmsStatus: string | null;
  invoiceNo: string | null;
  trackingNumber: string | null;
  raw: unknown;
  /** Changes against this SO's previous read — empty when there was no previous. */
  diff: ProbeDiffEntry[];
  previousCapturedAt: string | null;
};

export type ProbeCapture = {
  id: string;
  source: string;
  receivedAt: string;
  method: string;
  contentType: string | null;
  headers: unknown;
  body: unknown;
  rawBody: string | null;
  truncated: boolean;
  byteLength: number;
  salesorderId: number | null;
  invoiceId: number | null;
  refNo: string | null;
};

/** `2026-10-31 09:14:22` — a bench timestamp wants seconds, not words. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function Disclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-xs font-semibold text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50"
      >
        {open ? (
          <CaretDownIcon aria-hidden="true" className="size-3.5 shrink-0" />
        ) : (
          <CaretRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        {title}
      </button>
      {open ? children : null}
    </div>
  );
}

/** Verbatim Jubelio JSON. Never reformatted — the formatting is the evidence. */
function JsonPre({ value }: { value: unknown }) {
  return (
    <pre className="mt-2 max-h-80 overflow-auto rounded-xl border border-neutral-200 bg-neutral-50 p-3 font-mono text-[11px] leading-relaxed text-neutral-800 dark:border-border dark:bg-input/20 dark:text-neutral-200">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

const KIND_LABEL: Record<ProbeDiffEntry["kind"], string> = {
  added: "baru",
  removed: "hilang",
  changed: "berubah",
};

const KIND_TONE: Record<ProbeDiffEntry["kind"], string> = {
  added: "bg-emerald-50 text-emerald-800 border-emerald-200",
  removed: "bg-rose-50 text-rose-800 border-rose-200",
  changed: "bg-amber-50 text-amber-900 border-amber-200",
};

function DiffTable({ diff }: { diff: ProbeDiffEntry[] }) {
  return (
    <ul className="mt-2 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 dark:divide-border dark:border-border">
      {diff.map((entry) => (
        <li
          key={entry.key}
          className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,11rem)_auto_minmax(0,1fr)] sm:items-baseline sm:gap-3"
        >
          <span className="font-mono text-[11px] font-bold text-neutral-950 dark:text-neutral-50">
            {entry.key}
          </span>
          <span
            className={cn(
              "justify-self-start rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-bold",
              KIND_TONE[entry.kind],
            )}
          >
            {KIND_LABEL[entry.kind]}
          </span>
          <span className="min-w-0 font-mono text-[11px] tabular-nums text-neutral-600 dark:text-neutral-300">
            <span className="break-words">{formatProbeValue(entry.before)}</span>
            <span className="mx-1.5 text-neutral-400">→</span>
            <span className="break-words font-bold text-neutral-900 dark:text-neutral-100">
              {formatProbeValue(entry.after)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The sink band: the one URL to paste into Jubelio's dashboard. Inverted on
 * purpose — it is the only thing on this page you act on outside the app, so it
 * reads as a plate, not as another row of the tool.
 */
function SinkBand({ sinkUrl }: { sinkUrl: string | null }) {
  if (!sinkUrl) {
    return (
      <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
        <p className="text-sm font-bold text-amber-950 dark:text-amber-100">
          Sink masih mati
        </p>
        <p className="mt-1 font-mono text-[11px] text-amber-900 dark:text-amber-200">
          Set JUBELIO_WEBHOOK_SINK_TOKEN=&quot;&lt;random string&gt;&quot; di .env,
          lalu reload halaman ini. Endpoint tanpa token menjawab 503 dan tidak
          menyimpan apa pun.
        </p>
      </div>
    );
  }
  return (
    <div className="m-4 rounded-xl bg-neutral-950 p-4 text-neutral-100 dark:bg-neutral-50 dark:text-neutral-900">
      <p className="text-[11px] font-bold text-neutral-400 dark:text-neutral-500">
        URL callback untuk Pengaturan → Developer → Webhook di Jubelio
      </p>
      <div className="mt-2 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed">
          {sinkUrl}
        </code>
        <CopyChip value={sinkUrl} label="URL callback" size="icon-sm" />
      </div>
      <p className="mt-2 font-mono text-[10px] text-neutral-500 dark:text-neutral-600">
        Tambah ?event=nama-event di ujung URL untuk menandai sumber capture.
      </p>
    </div>
  );
}

/**
 * Jubelio bench (spec §4.7): sink URL, per-SO snapshot fetch with a diff against
 * the previous read, and the webhook capture log. Snapshot buttons are the only
 * writes here, and they write to the probe tables only.
 */
function AdminJubelioProbe({
  orders,
  snapshots,
  captures,
  sinkUrl,
}: {
  orders: ProbeOrder[];
  snapshots: ProbeSnapshot[];
  captures: ProbeCapture[];
  sinkUrl: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(snapshots);
  const [busySo, setBusySo] = useState<number | null>(null);
  // Per-SO marker, so a bench run reads as "before faktur" / "setelah faktur"
  // without the operator having to remember which row was which.
  const [labels, setLabels] = useState<Record<number, string>>({});

  async function takeSnapshot(order: ProbeOrder) {
    setBusySo(order.salesorderId);
    const label = labels[order.salesorderId]?.trim() || undefined;
    try {
      const res = await fetch("/api/admin/jubelio/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          salesorderId: order.salesorderId,
          orderId: order.orderId,
          label,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        snapshot?: Omit<ProbeSnapshot, "bookingId">;
        diff?: ProbeDiffEntry[];
        previousCapturedAt?: string | null;
      };
      if (!res.ok || !data.ok || !data.snapshot) {
        toast.error(data.error ?? "Gagal mengambil snapshot dari Jubelio.");
        return;
      }
      const row: ProbeSnapshot = {
        ...data.snapshot,
        bookingId: order.bookingId,
        diff: data.diff ?? [],
        previousCapturedAt: data.previousCapturedAt ?? null,
      };
      setRows((prev) => [row, ...prev]);
      toast.success(
        row.diff.length > 0
          ? `SO #${order.salesorderId} · ${row.diff.length} perubahan`
          : row.previousCapturedAt
            ? `SO #${order.salesorderId} · tidak ada perubahan`
            : `SO #${order.salesorderId} · pembacaan pertama tersimpan`,
      );
      // Server rows now lag behind what was just written; refresh keeps the
      // counts honest without blocking the view.
      router.refresh();
    } catch {
      toast.error("Jaringan bermasalah — snapshot tidak tersimpan.");
    } finally {
      setBusySo(null);
    }
  }

  return (
    <div className="space-y-5">
      <Panel
        title="SINK WEBHOOK"
        /* The capture count lives on the capture panel; this pill answers the
           only question the plate itself raises — is the endpoint open or not. */
        count={sinkUrl ? "aktif" : "mati"}
        dot
      >
        <SinkBand sinkUrl={sinkUrl} />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="SALES ORDER TERPAUT" count={`${orders.length} order`}>
          {orders.length === 0 ? (
            <p className="p-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Belum ada order yang tertaut ke Jubelio. Konfirmasi satu pembayaran
              dulu, baru bandingkan pembacaannya di sini.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-border">
              {orders.map((order) => (
                <li key={order.orderId} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
                        {order.bookingId}
                      </span>
                      <StatusBadge
                        tone={orderStatusTone(order.status)}
                        pulse={isPulseStatus(order.status)}
                      >
                        {order.status}
                      </StatusBadge>
                      <span className="font-mono text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                        SO #{order.salesorderId}
                      </span>
                    </div>
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <Input
                        value={labels[order.salesorderId] ?? ""}
                        onChange={(e) =>
                          setLabels((prev) => ({
                            ...prev,
                            [order.salesorderId]: e.target.value,
                          }))
                        }
                        placeholder="catatan, mis. sebelum faktur"
                        maxLength={60}
                        aria-label={`Catatan snapshot untuk SO ${order.salesorderId}`}
                        className="h-8 flex-1 text-xs sm:w-52 sm:flex-none"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void takeSnapshot(order)}
                        isLoading={busySo === order.salesorderId}
                        className="shrink-0"
                      >
                        <ArrowsClockwiseIcon
                          aria-hidden="true"
                          className="size-3.5"
                        />
                        Snapshot
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="CAPTURE WEBHOOK MASUK" count={`${captures.length} terbaru`}>
          {captures.length === 0 ? (
            <p className="p-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Belum ada apa pun masuk. Salin URL callback di atas ke Jubelio,
              tembakkan satu event, dan payload aslinya akan tampil di sini.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-border">
              {captures.map((capture) => (
                <li key={capture.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                      {stamp(capture.receivedAt)}
                    </span>
                    <span className="rounded-full border border-neutral-200 px-1.5 py-0.5 font-mono text-[10px] font-bold text-neutral-700 dark:border-border dark:text-neutral-300">
                      {capture.source}
                    </span>
                    {capture.truncated ? (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                        terpotong
                      </span>
                    ) : null}
                  </div>
                  {/* The join question, answered at a glance: if a real event
                      carries none of these, a webhook cannot find our order. */}
                  <p
                    className={cn(
                      "mt-1.5 font-mono text-[11px] tabular-nums",
                      capture.salesorderId === null &&
                        capture.invoiceId === null &&
                        capture.refNo === null
                        ? "text-rose-700 dark:text-rose-300"
                        : "text-neutral-600 dark:text-neutral-300",
                    )}
                  >
                    {capture.salesorderId !== null
                      ? `salesorder_id ${capture.salesorderId} `
                      : ""}
                    {capture.invoiceId !== null
                      ? `· invoice_id ${capture.invoiceId} `
                      : ""}
                    {capture.refNo !== null ? `· ref_no ${capture.refNo} ` : ""}
                    {capture.salesorderId === null &&
                    capture.invoiceId === null &&
                    capture.refNo === null
                      ? "tidak terikat order — id apa pun yang dibawa?"
                      : ""}
                  </p>
                  <div className="mt-2">
                    <Disclosure
                      title={`${capture.method} · ${capture.byteLength} byte · ${
                        capture.contentType ?? "tanpa content-type"
                      }`}
                    >
                      <JsonPre value={capture.headers} />
                      <JsonPre
                        value={capture.body ?? capture.rawBody ?? "(kosong)"}
                      />
                    </Disclosure>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="SNAPSHOT SALES ORDER" count={`${rows.length} pembacaan`}>
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Belum ada snapshot. Klik Snapshot pada satu order di atas, buat faktur
            di Jubelio, lalu klik Snapshot lagi — selisihnya yang menjelaskan
            status.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-border">
            {rows.map((snap) => (
              <li key={snap.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
                    SO #{snap.salesorderId}
                  </span>
                  {snap.bookingId ? (
                    <span className="font-mono text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                      {snap.bookingId}
                    </span>
                  ) : null}
                  <span className="font-mono text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                    {stamp(snap.capturedAt)}
                  </span>
                  {snap.label ? (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      {snap.label}
                    </span>
                  ) : null}
                </div>

                {/* The triple, side by side — a faktur may move one and leave
                    the others, which is precisely what the enum guess got wrong. */}
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                  {[
                    { label: "internal", value: snap.internalStatus },
                    { label: "channel", value: snap.channelStatus },
                    { label: "wms", value: snap.wmsStatus },
                    { label: "faktur", value: snap.invoiceNo },
                  ].map((field) => (
                    <div key={field.label} className="min-w-0">
                      <dt className="text-[10px] text-neutral-500 dark:text-neutral-400">
                        {field.label}
                      </dt>
                      <dd
                        title={field.value ?? undefined}
                        className="truncate font-mono text-[11px] font-bold text-neutral-900 dark:text-neutral-100"
                      >
                        {field.value ?? "—"}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-2">
                  {snap.previousCapturedAt === null ? (
                    <p className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                      pembacaan pertama — belum ada pembanding
                    </p>
                  ) : (
                    <>
                      <p className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                        vs {stamp(snap.previousCapturedAt)} ·{" "}
                        {snap.diff.length === 0
                          ? "tidak ada perubahan"
                          : `${snap.diff.length} berubah`}
                      </p>
                      {snap.diff.length > 0 ? <DiffTable diff={snap.diff} /> : null}
                    </>
                  )}
                </div>

                <div className="mt-2">
                  <Disclosure
                    title={
                      <span className="inline-flex items-center gap-1.5">
                        <TerminalIcon aria-hidden="true" className="size-3.5" />
                        respons mentah · {snap.capturedBy}
                      </span>
                    }
                  >
                    <JsonPre value={snap.raw} />
                  </Disclosure>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export { AdminJubelioProbe };
