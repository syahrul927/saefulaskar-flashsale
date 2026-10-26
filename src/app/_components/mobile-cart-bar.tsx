"use client";

import { ShoppingCartIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/format";
import { useCartContext } from "./cart-context";

/**
 * Fixed bottom bar (mobile only) — ink pill with the running subtotal in mono
 * on the left and the "Lihat Keranjang (n)" chip on the right (mockup
 * design.html:779-793). Hidden while the cart is empty (spec §5.11). It opens
 * the layout-mounted drawer through the shared cart context; the header cart
 * button is the `md:` counterpart, so the drawer has an entry point at every
 * width — including `/orders`, where this bar never renders.
 */
function MobileCartBar() {
  const { subtotal, count, openDrawer } = useCartContext();

  if (count <= 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
      <Button
        variant="ink"
        size="lg"
        className="w-full justify-between gap-3"
        onClick={openDrawer}
      >
        <span className="flex items-center gap-2">
          <ShoppingCartIcon weight="bold" />
          <span className="font-mono text-sm font-bold tabular-nums">
            {formatRupiah(subtotal)}
          </span>
        </span>
        <span className="rounded-3xl bg-white/15 px-2.5 py-0.5 text-sm font-semibold dark:bg-neutral-950/10">
          Lihat Keranjang ({count})
        </span>
      </Button>
    </div>
  );
}

export { MobileCartBar };
