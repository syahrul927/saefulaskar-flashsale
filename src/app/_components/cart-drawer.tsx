"use client";

import { useState } from "react";
import { MinusIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useCartContext } from "./cart-context";

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

type BankAccount = {
  bank: string;
  account_number: string;
  account_name: string;
  waLink: string;
};

type CheckoutResult = {
  bookingId: string;
  grandTotal: number;
  bankAccounts: BankAccount[];
};

/**
 * Cart review drawer (spec §5.13 — clean summary): per-item qty steppers
 * (MOQ floor via `decrement`), Subtotal + "Total Checkout" lines ONLY.
 * "Checkout" posts to `POST /api/orders` (Task 6) and, on success, replaces
 * the cart body with the bank list + "Kirim Bukti Transfer" buttons.
 *
 * Visibility lives in `CartContext` (`drawerOpen` / `openDrawer` /
 * `closeDrawer`), not props — mounted exactly once by `(storefront)/layout`
 * so the header, the mobile bar and swipe-to-close all drive the same
 * instance on `/` and `/orders` alike. `sessionId` is optional: with no
 * ACTIVE session checkout is held (empty storefront), not silently broken.
 */
function CartDrawer({ sessionId }: { sessionId?: string }) {
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
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(
    null,
  );

  const handleCheckout = async () => {
    if (!sessionId) {
      toast.error("Belum ada flash sale aktif. Coba lagi saat sesi berjalan.");
      return;
    }
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          items: items.map((row) => ({
            sessionProductId: row.sessionProductId,
            qty: row.qty,
          })),
        }),
      });

      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        bookingId?: string;
        grandTotal?: number;
        bankAccounts?: BankAccount[];
      };

      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Checkout gagal, coba lagi.");
        return;
      }

      setCheckoutResult({
        bookingId: data.bookingId ?? "",
        grandTotal: data.grandTotal ?? 0,
        bankAccounts: data.bankAccounts ?? [],
      });
      clear();
      toast.success("Pesanan berhasil dibuat!");
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <Drawer
      open={drawerOpen}
      onOpenChange={(next) => (next ? openDrawer() : closeDrawer())}
      swipeDirection="down"
    >
      <DrawerContent className="h-[80dvh]">
        <DrawerHeader className="flex-row items-center justify-between">
          <DrawerTitle>
            {checkoutResult ? "Segera Transfer" : "Keranjang Anda"}
          </DrawerTitle>
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
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
              <div className="rounded-2xl border border-border bg-muted/50 p-4">
                <p className="text-xs text-muted-foreground">Booking ID</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {checkoutResult.bookingId}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Total yang harus ditransfer
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                  {formatRupiah(checkoutResult.grandTotal)}
                </p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-foreground">
                  Rekening Tujuan
                </p>
                {checkoutResult.bankAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Belum ada rekening yang diatur. Hubungi admin.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {checkoutResult.bankAccounts.map((bank) => (
                      <div
                        key={`${bank.bank}-${bank.account_number}`}
                        className="rounded-2xl border border-border p-3"
                      >
                        <p className="text-sm font-semibold text-foreground">
                          {bank.bank}
                        </p>
                        <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                          {bank.account_number}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          a.n. {bank.account_name}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DrawerFooter>
              {checkoutResult.bankAccounts.length > 0 && (
                <Button
                  size="lg"
                  className="w-full"
                  render={
                    <a
                      href={checkoutResult.bankAccounts[0]!.waLink}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  Kirim Bukti Transfer
                </Button>
              )}
              <Button
                size="lg"
                variant="outline"
                className="w-full"
                onClick={closeDrawer}
              >
                Selesai
              </Button>
            </DrawerFooter>
          </div>
        ) : (
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
        )}

        {!checkoutResult && (
          <DrawerFooter>
            {!sessionId && count > 0 && (
              <p className="text-center text-xs text-muted-foreground">
                Belum ada flash sale aktif — checkout tersedia saat sesi
                berjalan.
              </p>
            )}
            <Button
              size="lg"
              className="w-full"
              disabled={count === 0 || !sessionId || checkoutLoading}
              onClick={handleCheckout}
            >
              {checkoutLoading ? <Spinner /> : null}
              {checkoutLoading ? "Memproses..." : "Checkout"}
            </Button>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  );
}

export { CartDrawer };