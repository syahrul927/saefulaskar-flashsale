"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatRemaining(totalMs: number): string {
  const totalSec = Math.max(0, Math.floor(totalMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Ticking countdown to `endTime` (ISO string), formatted HH:MM:SS.
 * Renders skeleton segment while computing, so the page never flashes.
 */
function CountdownTimer({
  endTime,
  className,
}: {
  endTime: string | Date;
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

export { CountdownTimer };
