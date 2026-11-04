"use client";

import { useState, type ReactNode } from "react";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react/ssr";
import { cn } from "cn";

import { CopyChip } from "@/app/_components/copy-chip";
import { Panel } from "@/app/_components/panel";

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

/**
 * The callback plate, inverted on purpose: it is the only thing on this page
 * you act on outside the app, so it reads as a plate, not as another row.
 */
function SinkPlate({
  sinkUrl,
  tokenConfigured,
}: {
  sinkUrl: string;
  tokenConfigured: boolean;
}) {
  return (
    <div className="rounded-xl bg-neutral-950 p-4 text-neutral-100 dark:bg-neutral-50 dark:text-neutral-900">
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
      {tokenConfigured ? null : (
        <p className="mt-1 font-mono text-[10px] text-neutral-500 dark:text-neutral-600">
          JUBELIO_WEBHOOK_SINK_TOKEN belum diset — sink menerima path apa pun.
          Setelah token diset, hanya token itu yang diterima dan URL ini
          berubah.
        </p>
      )}
    </div>
  );
}

/**
 * Jubelio bench (spec §4.7): the callback URL to paste into Jubelio, and the
 * log of everything that came back through it. Read-only — nothing here writes
 * an order.
 */
function AdminJubelioProbe({
  captures,
  sinkUrl,
  tokenConfigured,
}: {
  captures: ProbeCapture[];
  sinkUrl: string;
  tokenConfigured: boolean;
}) {
  return (
    <Panel title="WEBHOOK" count={`${captures.length} terbaru`} dot>
      <div className="p-4">
        <SinkPlate sinkUrl={sinkUrl} tokenConfigured={tokenConfigured} />
      </div>
      <div className="border-t border-neutral-200 dark:border-border">
        {captures.length === 0 ? (
          <p className="p-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Belum ada webhook masuk. Salin URL di atas ke Jubelio, tembakkan
            satu event, dan payload aslinya tampil di sini.
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
      </div>
    </Panel>
  );
}

export { AdminJubelioProbe };
