"use client";

import { useState } from "react";
import { MinusIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Spinner } from "@/components/ui/spinner";
import { useCartContext } from "./cart-context";

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Cart review drawer (spec §5.13 — clean summary): per-item qty steppers
 * (MOQ floor via `decrement`), Subtotal + "Total Checkout" lines ONLY. No
 * express-delivery / flash-discount lines.
 *
 * The "Checkout" button is a marked stub: `POST /api/orders` is Task 6 and is
 * NOT built yet, so instead of calling a dead endpoint we surface a toast
 * saying checkout lands in the next milestone. Swap this handler for the real
 * POST (isLoading + toast) when Task 6 ships.
 */
function CartDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { items, increment, decrement, remove, subtotal, count } =
    useCartContext();
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleCheckout = () => {
    setCheckoutLoading(true);
    // TASK 6 STUB — checkout endpoint not built yet. Replace with:
    // const res = await fetch("/api/orders", { method: "POST", body: JSON.stringify(...) });
    // then toast.success / toast.error from the response. Keep `isLoading` +
    // spinner pattern exactly as-is so Task 6 only swaps the fetch body.
    setTimeout(() => {
      setCheckoutLoading(false);
      toast.info("Checkout akan tersedia di milestone berikutnya (Task 6).");
    }, 600);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <DrawerContent className="h-[80dvh]">
        <DrawerHeader className="flex-row items-center justify-between">
          <DrawerTitle>Keranjang Anda</DrawerTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Tutup keranjang"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon weight="bold" />
          </button>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {count === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Keranjang masih kosong. Pilih produk untuk memulai.
              </p>
            ) : (
              items.map((row) => (
                <div
                  key={row.sessionProductId}
                  className="flex items-center gap-3 rounded-2xl border border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {row.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatRupiah(row.price)} × {row.qty} ={" "}
                      <span className="font-medium text-foreground">
                        {formatRupiah(row.price * row.qty)}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[0.7rem] text-muted-foreground/70">
                      Min. pesan {row.minOrder}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="Kurangi"
                      className="flex size-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
                      disabled={row.qty <= row.minOrder}
                      onClick={() => decrement(row.sessionProductId)}
                    >
                      <MinusIcon weight="bold" />
                    </button>
                    <span className="w-7 text-center text-sm font-semibold tabular-nums">
                      {row.qty}
                    </span>
                    <button
                      type="button"
                      aria-label="Tambah"
                      className="flex size-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted"
                      onClick={() => increment(row.sessionProductId)}
                    >
                      <PlusIcon weight="bold" />
                    </button>
                    <button
                      type="button"
                      aria-label="Hapus item"
                      className="ml-1 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        remove(row.sessionProductId);
                        toast.success(`${row.name} dihapus dari keranjang`);
                      }}
                    >
                      <TrashIcon weight="bold" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {count > 0 && (
            <div className="shrink-0 space-y-1.5 border-t border-border px-4 py-3 text-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatRupiah(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-base font-semibold text-foreground">
                <span>Total Checkout</span>
                <span className="tabular-nums">{formatRupiah(subtotal)}</span>
              </div>
            </div>
          )}
        </div>

        <DrawerFooter>
          <Button
            size="lg"
            className="w-full"
            disabled={count === 0 || checkoutLoading}
            onClick={handleCheckout}
          >
            {checkoutLoading ? <Spinner /> : null}
            {checkoutLoading ? "Memproses..." : "Checkout"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export { CartDrawer };
