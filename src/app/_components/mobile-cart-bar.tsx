"use client";

import { ShoppingCartIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { useCartContext } from "./cart-context";

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Fixed bottom bar (mobile) — cart subtotal + "View Cart (n)".
 * Hidden when the cart is empty (spec §5.11). Desktop renders it too as a
 * convenience affordance outlined via `md:hidden`? No — the drawer is already
 * reachable from the header on desktop; this bar is mobile-only.
 */
function MobileCartBar({
  onViewCart,
}: {
  onViewCart: () => void;
}) {
  const { subtotal, count } = useCartContext();

  if (count <= 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
      <Button size="lg" className="w-full justify-between gap-3" onClick={onViewCart}>
        <span className="flex items-center gap-2">
          <ShoppingCartIcon weight="bold" />
          <span className="tabular-nums">{formatRupiah(subtotal)}</span>
        </span>
        <span className="rounded-3xl bg-primary-foreground/15 px-2.5 py-0.5 text-sm font-semibold">
          Lihat Keranjang ({count})
        </span>
      </Button>
    </div>
  );
}

export { MobileCartBar };
