"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
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
 * Customer product card (spec §4.4, §5.13).
 * - flashPrice + struck-through originalPrice
 * - quota bar claimed / sessionQuota
 * - sold-out overlay when claimed >= sessionQuota (or zero live stock)
 * - "+" quick-add at minOrder; disabled while sold out (Review Focus #6)
 */
function ProductCard({ product }: ProductCardProps) {
  const { add } = useCartContext();

  const claimed = product.claimed;
  const sessionQuota = product.sessionQuota;
  const quotaSoldOut = sessionQuota > 0 && claimed >= sessionQuota;
  const stockSoldOut =
    product.availableStock !== null && product.availableStock <= 0;
  const soldOut = quotaSoldOut || stockSoldOut;
  const soldOutReason = quotaSoldOut ? "Sold Out" : "Habis";

  const quotaPercent = sessionQuota > 0
    ? Math.min(100, Math.round((claimed / sessionQuota) * 100))
    : 0;

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
    <Card size="sm" className="relative flex h-full flex-col">
      {soldOut && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-4xl bg-background/70 backdrop-blur-[2px]">
          <span className="rounded-3xl border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
            {soldOutReason}
          </span>
        </div>
      )}

      {/* Image area — Jubelio thumbnail not available in the joined GET shape,
          so render a neutral placeholder tile. */}
      <div className="relative flex h-32 items-center justify-center overflow-hidden rounded-t-4xl bg-muted">
        <span className="text-2xl font-semibold tracking-tight text-muted-foreground/40">
          {product.itemGroupName?.slice(0, 1).toUpperCase() ?? "?"}
        </span>
      </div>

      <CardContent className="flex flex-1 flex-col gap-2 pt-4">
        <p className="line-clamp-2 min-h-10 font-medium leading-tight text-card-foreground">
          {product.itemGroupName ?? `SKU ${product.skuCode ?? product.itemId}`}
        </p>
        {product.skuCode ? (
          <p className="text-xs text-muted-foreground">{product.skuCode}</p>
        ) : null}

        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-foreground">
            {formatRupiah(product.flashPrice)}
          </span>
          {product.originalPrice > product.flashPrice && (
            <span className="text-sm text-muted-foreground line-through">
              {formatRupiah(product.originalPrice)}
            </span>
          )}
        </div>

        {/* Quota bar — claimed / sessionQuota (spec §4.4). */}
        <div className="mt-auto space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Terjual {claimed}
              {sessionQuota > 0 ? ` / ${sessionQuota}` : ""}
            </span>
            {quotaSoldOut && <span className="text-destructive">Habis</span>}
          </div>
          <Progress value={quotaPercent} aria-label={`Quota ${quotaPercent}% terjual`}>
            <ProgressTrack className="h-1.5">
              <ProgressIndicator
                className={quotaSoldOut ? "bg-destructive" : "bg-primary"}
                style={{ width: `${quotaPercent}%` }}
              />
            </ProgressTrack>
          </Progress>
        </div>
      </CardContent>

      <CardFooter className="pt-2">
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={soldOut}
          onClick={handleAdd}
        >
          <PlusIcon weight="bold" />
          {soldOut ? soldOutReason : `Tambah ${product.minOrder}`}
        </Button>
      </CardFooter>
    </Card>
  );
}

export { ProductCard };
