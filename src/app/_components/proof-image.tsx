"use client";

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "cn";

/**
 * Client-side transfer-proof image. Fetches the stored base64 data URI from
 * `GET /api/orders/[id]/proof` (owner or the order's customer only) on mount
 * and re-fetches only when `orderId` changes.
 *
 * Variants: `thumb` — small square preview in order cards/lists; `full` —
 * large view (receipt/drawer) capped at half the viewport height.
 *
 * The caller gates on `hasProof`, so the endpoint's 404 "belum diunggah"
 * path is rare; any failure (401/403/404/network) collapses into the same
 * small muted error text.
 */
function ProofImage({
  orderId,
  variant,
  className,
}: {
  orderId: string;
  variant: "thumb" | "full";
  className?: string;
}) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImageData(null);
    setError(false);

    fetch(`/api/orders/${orderId}/proof`)
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; imageData?: string }
          | null;
        if (cancelled) return;
        if (!res.ok || !data?.ok || typeof data.imageData !== "string") {
          setError(true);
          return;
        }
        setImageData(data.imageData);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (error) {
    return (
      <p className="text-muted-foreground text-xs">Gagal memuat bukti transfer.</p>
    );
  }

  if (!imageData) {
    return (
      <Skeleton
        className={cn(
          variant === "thumb"
            ? "h-12 w-12 rounded object-cover"
            : "max-h-[50vh] w-auto rounded-lg",
          className,
        )}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- src is an in-memory base64 data URI, not a remote asset
    <img
      src={imageData}
      alt="Bukti transfer"
      className={cn(
        variant === "thumb"
          ? "h-12 w-12 rounded object-cover"
          : "max-h-[50vh] w-auto rounded-lg",
        className,
      )}
    />
  );
}

export { ProofImage };
