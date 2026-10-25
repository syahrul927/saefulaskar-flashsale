// SSR entry: this logo renders inside server components (admin + storefront
// headers); the main icon entry relies on React Context, which RSC forbids.
import { LightningIcon } from "@phosphor-icons/react/ssr";
import { cn } from "cn";

const SIZES = {
  /** Header rail scale — mockup's 32px tile, 36px from `sm` up. */
  sm: { tile: "size-8 sm:size-9", icon: "size-4 sm:size-5" },
  /** Hero / empty-state scale. */
  md: { tile: "size-9 sm:size-10", icon: "size-5 sm:size-6" },
} as const;

/**
 * Brand bolt tile — the yellow mark shared by the admin header (Task 5) and
 * the customer header (Task 10). Decorative: the wordmark next to it carries
 * the name, so the tile is hidden from assistive tech.
 */
function AdminLogo({
  size = "sm",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const scale = SIZES[size];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl border border-brand-primary/40 bg-brand-primary text-neutral-950 shadow-sm",
        scale.tile,
        className,
      )}
    >
      <LightningIcon
        weight="fill"
        className={cn("text-neutral-950", scale.icon)}
      />
    </span>
  );
}

export { AdminLogo };
