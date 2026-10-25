"use client";

import { useEffect, useState } from "react";
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
import type { RecipientDefaults } from "@/server/recipient";
import { useCartContext } from "./cart-context";
import {
  CheckoutDialog,
  type CheckoutResult,
} from "./checkout-dialog";
import { PaymentPanel } from "./payment-panel";

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Cart review drawer — mockup "CUSTOMER CART" transplant (design.html:883-980):
 * dot + "KERANJANG FLASH" + mono count header, letter-tile rows with mono
 * qty × price and a line subtotal, and a summary that shows the flash savings
 * ("Hemat Rp…") before the total. Bottom sheet on mobile, right slide-over
 * `max-w-md` from `md:` up. The drawer never mutates into the payment screen
 * on its own — the CTA opens `CheckoutDialog` (recipient step, Task 12).
 *
 * Visibility lives in `CartContext` (`drawerOpen` / `openDrawer` /
 * `closeDrawer`), not props — mounted exactly once by `(storefront)/layout`
 * so the header, the mobile bar and swipe-to-close all drive the same
 * instance on `/` and `/orders` alike. `sessionId` is optional: with no
 * ACTIVE session checkout is held (empty storefront), not silently broken.
 *
 * The payment surface is `PaymentPanel` (Task 13, mockup MODAL 3): the drawer
 * morphs into it after a successful checkout, fed from `checkoutResult`, and
 * the same close-resets-`checkoutResult` rule keeps it from surviving the
 * drawer it lives in.
 */
function CartDrawer({
  sessionId,
  recipientDefaults,
}: {
  sessionId?: string;
  recipientDefaults: RecipientDefaults;
}) {
  const {
    items,
    increment,
    decrement,
    remove,
    subtotal,
    count,
    clear,
    drawerOpen,
    openDrawer,
    closeDrawer,
  } = useCartContext();
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  // One drawer instance serves both form factors, so the swipe axis follows
  // the viewport: "down" bottom sheet on mobile, "right" slide-over ≥ md.
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // The group layout owns this drawer, so it never unmounts on navigation —
  // the old per-route unmount used to reset the post-checkout bank screen for
  // free. Reset it whenever the drawer closes instead, otherwise reopening
  // the cart later drops the user back into the previous booking's receipt
  // with the cart body and a second checkout unreachable.
  useEffect(() => {
    if (!drawerOpen) setCheckoutResult(null);
  }, [drawerOpen]);

  // Σ(originalPrice − flashPrice) × qty — items stored before `originalPrice`
  // existed contribute 0 rather than a negative "Hemat".
  const savings = items.reduce(
    (sum, row) =>
      sum + Math.max(0, (row.originalPrice ?? row.price) - row.price) * row.qty,
    0,
  );

  // Success flow (ruling: dialog closes, cart empties, `PaymentPanel` opens
  // in the drawer). The toast + clear that used to live in the drawer's own
  // fetch keep their exact behaviour here.
  const handleCheckoutSuccess = (result: CheckoutResult) => {
    setDialogOpen(false);
    setCheckoutResult(result);
    clear();
    toast.success("Pesanan berhasil dibuat!");
    openDrawer();
  };

  return (
    <>
      <Drawer
        open={drawerOpen}
        onOpenChange={(next) => (next ? openDrawer() : closeDrawer())}
        swipeDirection={isDesktop ? "right" : "down"}
      >
        <DrawerContent className="h-[80dvh] md:h-[calc(100dvh-1rem)] md:w-[28rem]!">
          <DrawerHeader className="flex-row items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50/70 px-4 py-3 dark:border-border dark:bg-neutral-900/40">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full bg-brand-primary ring-1 ring-neutral-950/20 dark:ring-brand-primary/40"
              />
              <DrawerTitle className="truncate text-sm font-bold uppercase tracking-wider text-neutral-950 dark:text-neutral-50">
                {checkoutResult ? "SEGERA TRANSFER" : "KERANJANG FLASH"}
              </DrawerTitle>
              {!checkoutResult && count > 0 && (
                <span className="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 font-mono text-xs font-bold text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                  {count}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Tutup keranjang"
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon weight="bold" />
            </button>
          </DrawerHeader>

          {checkoutResult ? (
            <PaymentPanel
              bookingId={checkoutResult.bookingId}
              grandTotal={checkoutResult.grandTotal}
              bankAccounts={checkoutResult.bankAccounts}
              waLink={checkoutResult.bankAccounts[0]?.waLink ?? ""}
              onDone={closeDrawer}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-3 overflow-y-auto bg-neutral-50/40 px-4 py-3 dark:bg-transparent">
                {count === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    Keranjang masih kosong. Pilih produk untuk memulai.
                  </p>
                ) : (
                  items.map((row) => (
                    <div
                      key={row.sessionProductId}
                      className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-border dark:bg-card"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          {/* Thumb frame — mirrors the product-card letter tile. */}
                          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200/80 bg-neutral-100">
                            <span
                              aria-hidden="true"
                              className="flex size-full items-center justify-center bg-gradient-to-br from-amber-50 to-amber-200 text-lg font-black text-amber-700"
                            >
                              {row.name.slice(0, 1).toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-neutral-950 dark:text-neutral-50">
                              {row.name}
                            </p>
                            <p className="mt-0.5 font-mono text-[10px] font-bold tabular-nums text-neutral-900 dark:text-neutral-200">
                              {formatRupiah(row.price)} × {row.qty}
                            </p>
                            <p className="font-mono text-[9px] font-semibold text-amber-900 dark:text-amber-500">
                              Min. pesan {row.minOrder}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label="Hapus item"
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => {
                            remove(row.sessionProductId);
                            toast.success(
                              `${row.name} dihapus dari keranjang`,
                            );
                          }}
                        >
                          <TrashIcon weight="bold" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-100 pt-2 dark:border-border">
                        <span className="font-mono text-[10px] text-neutral-500">
                          Subtotal:{" "}
                          <strong className="font-bold text-neutral-950 dark:text-neutral-50">
                            {formatRupiah(row.price * row.qty)}
                          </strong>
                        </span>
                        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
                          <button
                            type="button"
                            aria-label="Kurangi"
                            className="flex size-6 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-950 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-700"
                            disabled={row.qty <= row.minOrder}
                            onClick={() => decrement(row.sessionProductId)}
                          >
                            <MinusIcon weight="bold" className="size-3.5" />
                          </button>
                          <span className="w-7 text-center font-mono text-xs font-bold tabular-nums text-neutral-950 dark:text-neutral-50">
                            {row.qty}
                          </span>
                          <button
                            type="button"
                            aria-label="Tambah"
                            className="flex size-6 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-700"
                            onClick={() => increment(row.sessionProductId)}
                          >
                            <PlusIcon weight="bold" className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {count > 0 && (
                <div className="shrink-0 space-y-1.5 border-t border-neutral-200 px-4 pt-3 font-mono text-xs dark:border-border">
                  <div className="flex items-center justify-between text-neutral-500">
                    <span>Subtotal</span>
                    <span className="font-bold text-neutral-900 tabular-nums dark:text-neutral-100">
                      {formatRupiah(subtotal)}
                    </span>
                  </div>
                  {savings > 0 && (
                    <div className="flex items-center justify-between text-neutral-500">
                      <span>Diskon Flash</span>
                      <span className="font-mono font-bold text-brand-secondary tabular-nums">
                        Hemat {formatRupiah(savings)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-neutral-100 pt-2 text-sm font-bold text-neutral-950 dark:border-border dark:text-neutral-50">
                    <span>Total Checkout</span>
                    <span className="tabular-nums">{formatRupiah(subtotal)}</span>
                  </div>
                </div>
              )}

              <DrawerFooter className="pt-3">
                {!sessionId && count > 0 && (
                  <p className="text-center text-xs text-muted-foreground">
                    Belum ada flash sale aktif — checkout tersedia saat sesi
                    berjalan.
                  </p>
                )}
                <Button
                  variant="ink"
                  size="lg"
                  className="w-full"
                  disabled={count === 0 || !sessionId}
                  onClick={() => {
                    closeDrawer();
                    setDialogOpen(true);
                  }}
                >
                  Lanjut ke Checkout
                </Button>
              </DrawerFooter>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <CheckoutDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          // Returning to the cart keeps the flow continuous whether the user
          // cancels the form or the booking succeeded (success also opens the
          // drawer for the payment screen — idempotent).
          if (!next) openDrawer();
        }}
        sessionId={sessionId}
        recipientDefaults={recipientDefaults}
        onSuccess={handleCheckoutSuccess}
      />
    </>
  );
}

export { CartDrawer };
