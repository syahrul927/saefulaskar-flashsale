"use client";

import { useState } from "react";

/**
 * Photo-over-tile thumb for customer surfaces (storefront card + cart
 * drawer). The brand-orange letter tile renders first and stays as the backdrop;
 * the v2 thumbnail (`session_products.image_url`, captured at import)
 * overlays it once present. A null URL — or a CDN 404, tracked with local
 * `failed` state — leaves the tile visible, so the degraded look is exactly
 * the pre-photo card. Mirrors the admin `RosterThumb` plain-`<img>` treatment
 * (no next/image remotePatterns config exists for the Jubelio CDN yet).
 */
function ProductThumb({
  src,
  alt,
  letter,
  letterClass = "text-5xl",
}: {
  /** v2 thumbnail URL stored at import; null → tile only. */
  src: string | null;
  /** Accessible name for the photo (product name). */
  alt: string;
  /** Tile letter — first character, uppercased by the caller. */
  letter: string;
  /** Tile type size class; the drawer passes `text-lg`. */
  letterClass?: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <>
      <span
        aria-hidden="true"
        className={`flex size-full items-center justify-center bg-gradient-to-br from-brand-primary/10 to-brand-secondary/15 ${letterClass} font-black text-brand-action`}
      >
        {letter}
      </span>
      {src !== null && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full bg-neutral-100 object-cover"
        />
      )}
    </>
  );
}

export { ProductThumb };
