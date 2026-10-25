"use client";

import { Fragment, useEffect, useState } from "react";
import { cn } from "cn";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

/** Breaks a duration into clamped (never negative) hour/minute/second parts. */
function formatRemainingParts(totalMs: number): {
  h: number;
  m: number;
  s: number;
} {
  const totalSec = Math.max(0, Math.floor(totalMs / 1000));
  return {
    h: Math.floor(totalSec / 3600),
    m: Math.floor((totalSec % 3600) / 60),
    s: totalSec % 60,
  };
}

function formatRemaining(totalMs: number): string {
  const { h, m, s } = formatRemainingParts(totalMs);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const BOXED_UNITS = [
  { key: "h", label: "Jam" },
  { key: "m", label: "Menit" },
  { key: "s", label: "Detik" },
] as const;

function BoxedCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-[50px] rounded-lg border px-2 py-1 text-center shadow-xs",
        accent
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-neutral-200 bg-white text-neutral-950",
      )}
    >
      <div className="font-mono text-[18px] font-black leading-tight tabular-nums">
        {value}
      </div>
      <div className="font-mono text-[8px] font-bold uppercase text-neutral-500">
        {label}
      </div>
    </div>
  );
}

/**
 * Ticking countdown to `endTime` (ISO string).
 * `inline` — plain HH:MM:SS text; `boxed` — JAM/MENIT/DETIK cells.
 * Renders placeholder segment(s) while computing, so the page never flashes.
 */
function CountdownTimer({
  endTime,
  variant = "inline",
  className,
}: {
  endTime: string | Date;
  variant?: "inline" | "boxed";
  className?: string;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(endTime).getTime();
    const tick = () => setRemaining(target - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endTime]);

  if (variant === "boxed") {
    const parts = remaining != null ? formatRemainingParts(remaining) : null;
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        {BOXED_UNITS.map((unit, i) => (
          <Fragment key={unit.key}>
            {i > 0 && (
              <span className="font-mono text-sm font-bold text-neutral-400">
                :
              </span>
            )}
            <BoxedCell
              label={unit.label}
              value={parts ? pad(parts[unit.key]) : "--"}
              accent={unit.key === "s"}
            />
          </Fragment>
        ))}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "font-mono tabular-nums tracking-tight",
        remaining != null && remaining <= 0 && "text-destructive",
        className,
      )}
    >
      {remaining != null ? formatRemaining(remaining) : "--:--:--"}
    </span>
  );
}

export { CountdownTimer, formatRemainingParts };
