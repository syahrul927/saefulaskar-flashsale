"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PRODUCT_TYPE_LABELS, type ProductType } from "@/server/db/schema";
import { pillIdFor } from "./category-pills";
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
  type: ProductType;
};

type ProductCardProps = {
  product: StorefrontProduct;
};

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Customer product card — mockup transplant (design.html:519-598).
 * aspect-square amber letter-tile frame (Task 7 `RosterThumb` treatment sized
 * up) with floating category pill + MOQ badge, mono price block, a low-stock
 * "sisa N" callout and a whiteout sold-out overlay. Quick-add at minOrder;
 * cart logic unchanged, CTA disabled while sold out.
 */
function ProductCard({ product }: ProductCardProps) {
  const { add } = useCartContext();

  const remaining = product.sessionQuota - product.claimed;
  const soldOut =
    remaining <= 0 ||
    (product.availableStock !== null && product.availableStock <= 0);
  // Urgency threshold — show the "sisa N" callout once stock is genuinely low.
  const lowStock = remaining <= Math.max(10, Math.ceil(product.sessionQuota * 0.15));

  const handleAdd = () => {
    add(
      {
        sessionProductId: product.id,
        itemId: product.itemId,
        name: product.itemGroupName ?? `SKU ${product.skuCode ?? product.itemId}`,
        sku: product.skuCode ?? "",
        price: product.flashPrice,
        minOrder: product.minOrder,
      },
      product.minOrder,
    );
    toast.success(
      `${product.minOrder} x ${product.itemGroupName ?? "Item"} ditambahkan ke keranjang`,
    );
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-3.5 transition hover:border-neutral-300 hover:shadow-md dark:border-border dark:bg-card">
      {/* Thumb frame — letter tile until real images land (mockup D6). */}
      <div className="relative mb-3 flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-neutral-200/80 bg-neutral-100">
        <span
          aria-hidden="true"
          className="flex size-full items-center justify-center bg-gradient-to-br from-amber-50 to-amber-200"
        >
          <span className="text-5xl font-black text-amber-700">
            {product.itemGroupName?.slice(0, 1).toUpperCase() ?? "?"}
          </span>
        </span>

        {/* Category pill overlay — top-left, floats over the tile. */}
        <span className="absolute left-2 top-2 rounded-md border border-neutral-200 bg-white/95 px-2 py-0.5 font-mono text-[10px] font-bold text-neutral-800 backdrop-blur">
          {pillIdFor(product.category)}
        </span>

        {/* MOQ badge — top-right. */}
        <span className="absolute right-2 top-2">
          <StatusBadge tone="amber">MIN: {product.minOrder}</StatusBadge>
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

      {lowStock && (
        <p className="mt-1 font-mono text-[10px] font-bold text-brand-secondary">
          sisa {remaining}
        </p>
      )}

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
