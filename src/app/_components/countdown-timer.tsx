"use client";

import { Fragment, useEffect, useState } from "react";
import { cn } from "cn";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

/** Breaks a duration into clamped (never negative) day/hour/minute/second
 * parts — `d` unbounded, `h` stays 0-23 so 90 061 s reads 1d 01:01:01. */
function formatRemainingParts(totalMs: number): {
  d: number;
  h: number;
  m: number;
  s: number;
} {
  const totalSec = Math.max(0, Math.floor(totalMs / 1000));
  return {
    d: Math.floor(totalSec / 86400),
    h: Math.floor((totalSec % 86400) / 3600),
    m: Math.floor((totalSec % 3600) / 60),
    s: totalSec % 60,
  };
}

function formatRemaining(totalMs: number): string {
  const { d, h, m, s } = formatRemainingParts(totalMs);
  return `${d > 0 ? `${d}d ` : ""}${pad(h)}:${pad(m)}:${pad(s)}`;
}

const BOXED_UNITS = [
  { key: "h", label: "Jam" },
  { key: "m", label: "Menit" },
  { key: "s", label: "Detik" },
] as const;

const BOXED_UNITS_DAYS = [{ key: "d", label: "Hari" }, ...BOXED_UNITS] as const;

/**
 * Cell palettes for the boxed countdown. `paper` is the storefront's light
 * banner; `ink` is the same device on the brand-dark login plate — same cells,
 * same labels, so owner and customer look at one countdown, not two dialects.
 */
const BOXED_TONES = {
  paper: {
    cell: "border-neutral-200 bg-white text-neutral-950",
    accent: "border-brand-mark/30 bg-brand-primary/10 text-brand-action",
    label: "text-neutral-500",
    colon: "text-neutral-400",
  },
  ink: {
    cell: "border-white/15 bg-white/[0.07] text-white",
    accent: "border-brand-mark/45 bg-brand-mark/20 text-[#FDBA74]",
    label: "text-white/55",
    colon: "text-white/55",
  },
} as const;

/**
 * Cell scale. `sm` is the storefront banner's compact ticker; `lg` is the login
 * plate, where the countdown is the panel's only content and has to carry the
 * width — so it steps up with the plate's own column (42% at `lg`, wider at
 * `xl`), never with the bare viewport. Base size stays inside a 320px rail even
 * with the fourth "Hari" cell present.
 */
const BOXED_SIZES = {
  sm: {
    group: "gap-1.5",
    cell: "min-w-[50px] px-2 py-1",
    digits: "text-[18px]",
    label: "text-[8px]",
    colon: "text-sm",
  },
  lg: {
    group: "gap-1.5 flex-wrap gap-y-2 xl:gap-2",
    cell: "min-w-[48px] px-2 py-1.5 lg:min-w-[60px] lg:px-2.5 lg:py-2 xl:min-w-[74px] xl:px-3 xl:py-2.5",
    digits: "text-[18px] lg:text-[24px] xl:text-[28px]",
    label: "text-[8px] xl:text-[9px]",
    colon: "text-base lg:text-xl xl:text-2xl",
  },
} as const;

type BoxedTone = keyof typeof BOXED_TONES;
type BoxedSize = keyof typeof BOXED_SIZES;

function BoxedCell({
  label,
  value,
  accent,
  tone,
  size,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone: BoxedTone;
  size: BoxedSize;
}) {
  const palette = BOXED_TONES[tone];
  const scale = BOXED_SIZES[size];

  return (
    <div
      className={cn(
        "rounded-lg border text-center shadow-xs",
        scale.cell,
        accent ? palette.accent : palette.cell,
      )}
    >
      <div
        className={cn(
          "font-mono font-black leading-tight tabular-nums",
          scale.digits,
        )}
      >
        {value}
      </div>
      <div
        className={cn(
          "font-mono font-bold uppercase",
          scale.label,
          palette.label,
        )}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * Ticking countdown to `endTime` (ISO string).
 * `inline` — plain HH:MM:SS text; `boxed` — JAM/MENIT/DETIK cells.
 * `tone` colours those cells for a light (`paper`, default) or brand-dark
 * (`ink`) surface, `size` sets their scale. Renders placeholder segment(s)
 * while computing, so the page never flashes.
 */
function CountdownTimer({
  endTime,
  variant = "inline",
  tone = "paper",
  size = "sm",
  className,
}: {
  endTime: string | Date;
  variant?: "inline" | "boxed";
  tone?: BoxedTone;
  size?: BoxedSize;
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
    // The "Hari" cell only appears once the session really is a day+ away —
    // a same-evening sale keeps the compact Jam/Menit/Detik three cells.
    const units = parts && parts.d > 0 ? BOXED_UNITS_DAYS : BOXED_UNITS;
    const scale = BOXED_SIZES[size];
    return (
      <span className={cn("inline-flex items-center", scale.group, className)}>
        {units.map((unit, i) => (
          <Fragment key={unit.key}>
            {i > 0 && (
              <span
                className={cn(
                  "font-mono font-bold",
                  scale.colon,
                  BOXED_TONES[tone].colon,
                )}
              >
                :
              </span>
            )}
            <BoxedCell
              label={unit.label}
              tone={tone}
              size={size}
              value={
                parts
                  ? unit.key === "d"
                    ? String(parts.d)
                    : pad(parts[unit.key])
                  : "--"
              }
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
