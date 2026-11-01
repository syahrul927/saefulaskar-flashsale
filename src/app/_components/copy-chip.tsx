"use client";

import { CopyIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Clipboard helpers shared by the payment panel and the receipt (lifted out of
 * `src/lib/format` — that module must stay dependency-free for RSC; these
 * import sonner/phosphor/ui and are client-only).
 */

/** Clipboard write + the verbatim "Disalin" toast. A missing/insecure
 * `navigator.clipboard` throws into the catch, which is the fallback path. */
export async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Disalin");
  } catch {
    toast.error("Gagal menyalin — salin manual dari layar ini.");
  }
}

/** Mono-value copy affordance used by the payment panel and the receipt.
 * `size` keeps each surface's original footprint (`icon-sm` panel rows,
 * `icon-xs` receipt lines). */
export function CopyChip({
  value,
  label,
  size = "icon-sm",
}: {
  value: string;
  label: string;
  size?: "icon-sm" | "icon-xs";
}) {
  return (
    <Button
      type="button"
      size={size}
      variant="ghost"
      aria-label={`Salin ${label}`}
      className="shrink-0 rounded-lg bg-neutral-100 text-neutral-800 hover:bg-neutral-200 hover:text-neutral-950 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      onClick={() => void copyToClipboard(value)}
    >
      <CopyIcon weight="bold" className="size-3.5" />
    </Button>
  );
}
