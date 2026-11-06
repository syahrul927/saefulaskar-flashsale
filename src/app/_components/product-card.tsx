"use client";

import { PlusIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/format";
import { PRODUCT_TYPE_LABELS, type ProductType } from "@/server/db/schema";
import { capForProduct } from "./cart-rules";
import { pillIdFor } from "./category-pills";
import { ProductThumb } from "./product-thumb";
import { StatusBadge } from "./status-badge";
import { useCartContext } from "./cart-context";

export type StorefrontProduct = {
  id: string;
  itemId: number;
  skuCode: string | null;
  itemGroupName: string | null;
  originalPrice: number;
  sessionQuota: number;
  claimed: number;
  minOrder: number;
  flashPrice: number;
  category: string | null;
  availableStock: number | null;
  /** v2 thumbnail URL stored at import — null → letter tile. */
  image: string | null;
  type: ProductType;
};

type ProductCardProps = {
  product: StorefrontProduct;
};

/**
 * Customer product card — mockup transplant (design.html:519-598).
 * aspect-square amber letter-tile frame (Task 7 `RosterThumb` treatment sized
 * up) with floating category pill + MOQ badge, mono price block, a low-stock
 * "sisa N" callout, the brand-gradient quota bar and a whiteout sold-out
 * overlay. Quick-add at minOrder; cart logic unchanged, CTA disabled while
 * sold out.
 */
function ProductCard({ product }: ProductCardProps) {
  const { add } = useCartContext();

  const remaining = product.sessionQuota - product.claimed;
  // Same ceiling the cart enforces (`cart-rules`, mirroring the server
  // checkout guard): when no legal quantity fits — quota exhausted, stock
  // ≤ 0, or the remainder below `minOrder` — the card is sold out.
  const soldOut = capForProduct(product) < product.minOrder;
  // Urgency threshold — show the "sisa N" callout once stock is genuinely low.
  const lowStock = remaining <= Math.max(10, Math.ceil(product.sessionQuota * 0.15));
  const quotaPercent =
    product.sessionQuota > 0
      ? Math.min(100, Math.round((product.claimed / product.sessionQuota) * 100))
      : 0;

  const handleAdd = () => {
    // The cap travels with the line (`cart-rules` mirrors the server
    // checkout guard); the context owns the feedback toast so the stated
    // quantity is the one that actually landed after clamping.
    add(
      {
        sessionProductId: product.id,
        itemId: product.itemId,
        name: product.itemGroupName ?? `SKU ${product.skuCode ?? product.itemId}`,
        sku: product.skuCode ?? "",
        price: product.flashPrice,
        originalPrice: product.originalPrice,
        minOrder: product.minOrder,
        image: product.image,
        maxQty: capForProduct(product),
      },
      product.minOrder,
    );
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-3.5 transition hover:border-neutral-300 hover:shadow-md dark:border-border dark:bg-card">
      {/* Thumb frame — v2 photo over the letter tile (tile = null/broken
          fallback, mockup D6 resting state). */}
      <div className="relative mb-3 flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-neutral-200/80 bg-neutral-100">
        <ProductThumb
          src={product.image}
          alt={
            product.itemGroupName ?? `SKU ${product.skuCode ?? product.itemId}`
          }
          letter={product.itemGroupName?.slice(0, 1).toUpperCase() ?? "?"}
        />

        {/* Category pill overlay — top-left, floats over the tile. */}
        <span className="absolute left-2 top-2 rounded-md border border-neutral-200 bg-white/95 px-2 py-0.5 font-mono text-[10px] font-bold text-neutral-800 backdrop-blur">
          {pillIdFor(product.category)}
        </span>

        {/* MOQ badge — top-right. */}
        <span className="absolute right-2 top-2">
          <StatusBadge tone="orange">MIN: {product.minOrder}</StatusBadge>
        </span>

        {soldOut && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 backdrop-blur-[2px]">
            <StatusBadge tone="neutral">KUOTA HABIS</StatusBadge>
          </div>
        )}
      </div>

      <p className="line-clamp-2 min-h-10 text-[13px] font-semibold leading-tight text-neutral-950 dark:text-neutral-50">
        {product.itemGroupName ?? `SKU ${product.skuCode ?? product.itemId}`}
      </p>

      <div className="mt-1 flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-neutral-400">
          SKU:{" "}
          <span className="font-bold text-neutral-600 dark:text-neutral-300">
            {product.skuCode ?? "—"}
          </span>
        </span>
        {product.type !== "single" && (
          <span className="rounded-md border border-neutral-200 bg-neutral-100 px-1.5 font-mono text-[9px] font-bold uppercase text-neutral-600 dark:border-border dark:bg-neutral-900 dark:text-neutral-300">
            {PRODUCT_TYPE_LABELS[product.type]}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-base font-bold text-neutral-950 dark:text-neutral-50">
          {formatRupiah(product.flashPrice)}
        </span>
        {product.originalPrice > product.flashPrice && (
          <span className="font-mono text-[10px] text-neutral-400 line-through">
            {formatRupiah(product.originalPrice)}
          </span>
        )}
      </div>

      {lowStock && remaining > 0 && (
        <p className="mt-1 font-mono text-[10px] font-bold text-brand-action">
          sisa {remaining}
        </p>
      )}

      {/* Quota bar — brand-gradient fill on a thin neutral track
          (design.html:558-569). Hand-built divs: the shadcn `Progress`
          wrapper force-appends its own track after children, which would
          render a second bar next to a restyled one. */}
      <div className="mt-3">
        <div className="mb-1 flex justify-between font-mono text-[10px] text-neutral-500">
          <span>
            Terjual {product.claimed}
            {product.sessionQuota > 0 ? ` / ${product.sessionQuota}` : ""}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`Terjual ${quotaPercent}% dari kuota`}
          aria-valuenow={quotaPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 w-full overflow-hidden rounded-full border border-neutral-200/60 bg-neutral-100 dark:border-border dark:bg-neutral-800"
        >
          <div
            className="h-full bg-gradient-to-r from-brand-primary to-brand-secondary transition-all duration-300"
            style={{ width: `${quotaPercent}%` }}
          />
        </div>
      </div>

      <div className="mt-auto pt-3">
        <Button
          type="button"
          variant="ink"
          size="sm"
          className="w-full"
          disabled={soldOut}
          onClick={handleAdd}
        >
          <PlusIcon weight="bold" />
          {soldOut ? "KUOTA HABIS" : `Tambah ${product.minOrder}`}
        </Button>
      </div>
    </div>
  );
}

export { ProductCard };
