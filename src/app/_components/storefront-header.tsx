"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ClipboardIcon,
  LightningIcon,
  ShoppingCartIcon,
} from "@phosphor-icons/react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { formatRupiah } from "@/lib/format";
import { AdminLogo } from "./admin-logo";
import { StatusBadge } from "./status-badge";
import { useCartContext } from "./cart-context";

type TabItem = {
  href: string;
  label: string;
  Icon: typeof LightningIcon;
  isActive: (pathname: string) => boolean;
};

const TAB_ITEMS: TabItem[] = [
  {
    href: "/",
    label: "Toko",
    Icon: LightningIcon,
    isActive: (pathname) => pathname === "/",
  },
  {
    href: "/orders",
    label: "Transaksi",
    Icon: ClipboardIcon,
    isActive: (pathname) => pathname.startsWith("/orders"),
  },
];

/**
 * Mockup sub-tabs (design.html:439-460) as route links: active underline is
 * the brand rail, driven by the live pathname so switching is a plain
 * client-side navigation — instant, never blocked on data.
 */
function StorefrontTabs({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Halaman"
      className={cn("flex items-center gap-4 text-[11px] sm:text-xs", className)}
    >
      {TAB_ITEMS.map(({ href, label, Icon, isActive }) => {
        const active = isActive(pathname);

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 border-b-2 pb-2.5 uppercase tracking-wider transition",
              active
                ? "border-brand-primary font-bold text-neutral-950 dark:text-neutral-50"
                : "border-transparent font-semibold text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-50",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                active
                  ? "text-brand-action"
                  : "text-neutral-600 dark:text-neutral-400",
              )}
              weight={active ? "fill" : "regular"}
              aria-hidden="true"
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Header quick jump to the transaction list (design.html:111-120). */
function OrdersIconButton({ className }: { className?: string }) {
  const router = useRouter();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(
        "text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50",
        className,
      )}
      aria-label="Lihat riwayat transaksi"
      onClick={() => router.push("/orders")}
    >
      <ClipboardIcon weight="bold" />
    </Button>
  );
}

/**
 * Cart trigger — the brand-navy rail button (`bg-primary` = #1E3351) carrying
 * the live item count as a mono chip and the subtotal in mono. Chip shows only
 * when the
 * cart has items, mirroring the mockup's `cartTotalCount > 0` guard; the
 * `Rp` figure drops below `sm` where the rail can't fit both clusters.
 * The chip keeps `bg-brand-secondary` as decoration and dropped its
 * `border-neutral-950` outline: that near-black ring separated a pale chip
 * from the old orange fill, and measures 1.55:1 against the navy — invisible
 * — while the chip itself already separates at 5.63:1, well over the 3:1
 * graphic bar.
 */
function CartButton({ className }: { className?: string }) {
  const { subtotal, count, openDrawer } = useCartContext();

  return (
    <Button
      variant="default"
      className={cn("gap-1.5 px-2.5 sm:gap-2 sm:px-3", className)}
      aria-label={
        count > 0
          ? `Buka keranjang, ${count} item, ${formatRupiah(subtotal)}`
          : "Buka keranjang"
      }
      onClick={openDrawer}
    >
      <span className="relative">
        <ShoppingCartIcon className="size-4" weight="bold" aria-hidden="true" />
        {count > 0 && (
          <span className="absolute -end-2 -top-2 min-w-4 rounded-full bg-brand-secondary px-1 text-center font-mono text-[9px] font-black tabular-nums text-neutral-950">
            {count}
          </span>
        )}
      </span>
      <span className="hidden font-mono text-xs font-bold tabular-nums sm:inline">
        {formatRupiah(subtotal)}
      </span>
    </Button>
  );
}

/**
 * Customer header — the storefront variant of the admin rail (Task 5).
 * Static brand cluster (logo + FLASH SALE GROSIR + emerald "SALE RESMI" verified
 * badge, no Jubelio mention per design.html:71-76) over the mockup sub-tabs;
 * right cluster is the clipboard jump + cart trigger. Mounts exactly once in
 * `(storefront)/layout.tsx`; renders no server data so the rail paints
 * immediately and never blocks on a fetch.
 */
function StorefrontHeader({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-neutral-200/90 bg-white/95 backdrop-blur dark:border-border dark:bg-card/95",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col px-3 sm:px-6">
        <div className="flex h-14 items-center justify-between gap-2 sm:h-16">
          {/* Brand + verified-sale trust badge (customer-safe, no ERP signal).
              The wordmark truncates on the narrowest phones so the rail never
              scrolls sideways; badge and actions keep their room. */}
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link
              href="/"
              className="flex min-w-0 items-center gap-2 sm:gap-3"
              aria-label="Flash Sale Grosir — Toko"
            >
              <AdminLogo />
              <span className="truncate font-heading text-sm font-extrabold uppercase tracking-tight text-neutral-950 sm:text-base dark:text-neutral-50">
                Flash Sale Grosir
              </span>
            </Link>
            <span className="flex shrink-0">
              <StatusBadge tone="emerald" pulse>
                SALE RESMI
              </StatusBadge>
            </span>
          </div>

          {/* Jump to transactions + cart drawer trigger + sign-out. Same
              "Keluar" as the admin rail (shared SignOutButton), landed on the
              customer door — the mirror of the admin header's own
              `redirectTo="/auth/staff"`. Visible at every width: the brand
              cluster truncates (`min-w-0`), so the rail never scrolls
              sideways to make room. */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <OrdersIconButton />
            <SignOutButton
              className="h-9 w-auto px-3"
              redirectTo="/auth/login"
            />
            <CartButton />
          </div>
        </div>

        <StorefrontTabs className="-mb-px" />
      </div>
    </header>
  );
}

export { CartButton, OrdersIconButton, StorefrontHeader, StorefrontTabs };
