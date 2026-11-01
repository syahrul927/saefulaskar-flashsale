"use client";

import { TruckIcon } from "@phosphor-icons/react";
import { cn } from "cn";

import { CopyChip } from "./copy-chip";

/**
 * Resi strip: courier + tracking number + copy affordance. Shared by the admin
 * order rows and the customer transaction cards so both surfaces read the same
 * way.
 *
 * Deliberately rendered ONLY when a resi exists — the empty state is the band's
 * absence, so a row without one reads as "hasn't shipped" with no placeholder
 * to scan past. It borrows the item list's frame (`rounded-xl` + neutral-50
 * tint) rather than introducing a new visual grammar, and the number keeps the
 * app's mono `tabular-nums` treatment because it is data people compare and
 * copy, not prose.
 *
 * No tracking URL: Jubelio's `shipper` is free text ("SiCepat HALU", "Grab Same
 * Day", "J&T Express Hemat") with no reliable carrier→site mapping, so copying
 * the resi is the honest affordance.
 */
export function ShipmentBand({
  trackingNumber,
  shipper,
  className,
}: {
  trackingNumber: string;
  shipper: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50/60 px-3 py-2 dark:border-border dark:bg-input/20",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <TruckIcon
          aria-hidden="true"
          weight="fill"
          className="size-4 shrink-0 text-neutral-500 dark:text-neutral-400"
        />
        {shipper ? (
          <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
            {shipper}
          </span>
        ) : null}
        <span className="font-mono text-xs font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
          <span className="sr-only">Nomor resi </span>
          {trackingNumber}
        </span>
      </div>
      <CopyChip value={trackingNumber} label="resi" size="icon-xs" />
    </div>
  );
}
