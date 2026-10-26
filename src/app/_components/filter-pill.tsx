"use client";

import { cn } from "cn";

/**
 * One status-filter pill — mockup treatment (design.html:612-628): mono
 * `text-xs`, `rounded-lg`, ink fill when active (the mockup's
 * `bg-neutral-950 text-white font-bold`), grey hover fill when quiet, and the
 * amber-400 count chip (:625) showing the pill's live count.
 *
 * `emphasis` is the unpaid signal (brief Step 2): amber tint on the pill and
 * an `animate-ping` dot, both only while `count > 0`. Shared by the customer
 * transactions list and the admin chips (adjudication F) so one pill shape
 * serves both roles; dark-mode companions follow the `CategoryPills`
 * precedent.
 */
function FilterPill({
  label,
  count,
  active,
  emphasis = false,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  /** Amber unpaid signal (tint + ping dot) when this pill's count > 0. */
  emphasis?: boolean;
  onClick: () => void;
}) {
  const emphatic = emphasis && count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // Base carries a transparent border so switching to the emphasis
        // (unpaid) treatment never adds 2px and squashes the row (R6).
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-3 py-1.5 font-mono text-xs transition",
        active
          ? "bg-neutral-950 font-bold text-white dark:bg-neutral-50 dark:text-neutral-900"
          : emphatic
            ? "border border-amber-300 bg-amber-100/70 font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
            : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800/60 dark:text-neutral-300 dark:hover:bg-neutral-700/70",
      )}
    >
      {emphatic && (
        <span aria-hidden="true" className="relative flex w-1.5 h-1.5 shrink-0">
          <span className="absolute inline-flex w-full h-full animate-ping rounded-full bg-amber-400 opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-amber-500" />
        </span>
      )}
      <span>{label}</span>
      {count > 0 && (
        <span
          className={cn(
            // Mockup count chip (:625) — `w-4 h-4` widened to `min-w-4` so
            // two-digit counts aren't clipped.
            "flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[10px] font-black tabular-nums",
            emphatic
              ? "bg-amber-400 text-neutral-950"
              : active
                ? "bg-white/20 text-white dark:bg-neutral-900/20 dark:text-neutral-900"
                : "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export { FilterPill };
