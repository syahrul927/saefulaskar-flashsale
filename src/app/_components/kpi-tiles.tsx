import Link from "next/link";

import { cn } from "cn";

import {
  formatClaimPercent,
  formatCompactRupiah,
} from "@/app/admin/format";
import { formatRupiah } from "@/lib/format";
import type { SessionKpis } from "@/server/session-query";

/**
 * KPI tile shell — design.html:235-253. Extracted verbatim from
 * `admin/page.tsx` so the console's global "Ringkasan" row (spec decision 5)
 * and the per-session "Metrik Sesi Aktif" row share one treatment.
 *
 * `href` turns the tile into a deep link (e.g. "Perlu Konfirmasi" →
 * `/admin/orders?status=UNPAID`): same card classes, rendered as a `Link`
 * with a focus ring. Without it the markup is the original `div`.
 */
function KpiTile({
  label,
  value,
  unit,
  hint,
  valueClassName,
  href,
}: {
  label: string;
  value: string;
  /** Suffix sitting on the value line, e.g. `SKU` / `unit`. */
  unit?: string;
  /** Small mono line under the value: quota share or compact rupiah. */
  hint?: string;
  /** Colour override for the value (reserved = brand, GMV = emerald). */
  valueClassName?: string;
  /** When set, the whole tile links — spec decision 4's KPI deep link. */
  href?: string;
}) {
  const tileClasses =
    "rounded-xl border border-neutral-100 bg-neutral-50 p-3 dark:border-border dark:bg-muted";

  const inner = (
    <>
      <span className="block text-[8px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <span
        title={value}
        className={cn(
          "mt-1 flex min-w-0 items-baseline gap-1 font-mono text-lg font-bold tabular-nums",
          // Default wins when the caller passes no colour, so exactly one
          // text-colour class lands on the value line.
          valueClassName ?? "text-neutral-950 dark:text-neutral-50",
        )}
      >
        <span className="min-w-0 truncate">{value}</span>
        {unit && (
          <span className="shrink-0 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
            {unit}
          </span>
        )}
      </span>
      {hint && (
        <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
          {hint}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          tileClasses,
          "block transition-colors hover:border-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:border-neutral-600",
        )}
      >
        {inner}
      </Link>
    );
  }

  return <div className={tileClasses}>{inner}</div>;
}

/**
 * KPI tiles for the live sale. Numbers come from `getSessionKpis`, which only
 * answers for the primary ACTIVE session — so the row is hidden entirely when
 * nothing is running, rather than showing a wall of zeros.
 */
function KpiRow({ kpis }: { kpis: SessionKpis }) {
  return (
    <section aria-label="KPI sesi aktif" className="space-y-2">
      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        Metrik Sesi Aktif
      </p>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <KpiTile
          label="PRODUK DIDAFTARKAN"
          value={String(kpis.productCount)}
          unit="SKU"
        />
        <KpiTile
          label="TOTAL KUOTA"
          value={String(kpis.totalQuota)}
          unit="unit"
        />
        <KpiTile
          label="TERKUNCI / TERJUAL"
          value={String(kpis.totalClaimed)}
          unit="unit"
          valueClassName="text-brand-secondary"
          hint={`${kpis.totalClaimed}/${kpis.totalQuota} (${formatClaimPercent(
            kpis.totalClaimed,
            kpis.totalQuota,
          )})`}
        />
        <KpiTile
          label="ESTIMASI GMV"
          value={formatRupiah(kpis.estimatedGmv)}
          valueClassName="text-emerald-600"
          hint={formatCompactRupiah(kpis.estimatedGmv)}
        />
      </div>
    </section>
  );
}

export { KpiRow, KpiTile };
