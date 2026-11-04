// SSR entry: this logo renders inside server components (admin + storefront
// headers); the main icon entry relies on React Context, which RSC forbids.
import { cn } from "cn";

/**
 * Tile footprint per scale — unchanged from the bolt-tile version, so the
 * brand swap moves pixels inside the box and nothing around it (spec Ruling
 * 4: marks + name only, theme untouched).
 */
const SIZES = {
  /** Header rail scale — mockup's 32px tile, 36px from `sm` up. */
  sm: "size-8 sm:size-9",
  /** Hero / empty-state scale. */
  md: "size-9 sm:size-10",
} as const;

/**
 * Brand mark — the supplied Flash Sale Grosir app icon, square-cropped into
 * the same rounded tile the bolt used to fill. Decorative: the wordmark next
 * to it carries the name, so the tile is hidden from assistive tech.
 *
 * Plain `<img>`: `next.config.js` runs `images.unoptimized`, so `next/image`
 * buys nothing here, and the repo already renders raster marks this way
 * (`product-thumb.tsx`).
 */
function AdminLogo({
  size = "sm",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/logo-square.png"
      alt=""
      aria-hidden="true"
      className={cn(
        "shrink-0 rounded-xl object-cover shadow-sm",
        SIZES[size],
        className,
      )}
    />
  );
}

export { AdminLogo };
