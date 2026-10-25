"use client";

import { useMemo, useState } from "react";
import { LightningIcon } from "@phosphor-icons/react";

import {
  ALL_PILL_ID,
  CategoryPills,
  derivePills,
  pillIdFor,
} from "./category-pills";
import { CountdownTimer } from "./countdown-timer";
import { ProductCard, type StorefrontProduct } from "./product-card";
import { MobileCartBar } from "./mobile-cart-bar";

type ActiveSession = {
  id: string;
  name: string;
  sessionName: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
};

type StorefrontViewProps = {
  session: ActiveSession;
  products: StorefrontProduct[];
};

/**
 * Interactive storefront body — urgency banner + category filter + product
 * grid live on the client, session/products are fetched (server components)
 * and passed in. G13: page container uses `flex-1 space-y-6 p-4 md:p-6`.
 * The cart drawer is NOT mounted here anymore — `(storefront)/layout` owns the
 * single instance so `/orders` keeps a cart entry point too.
 */
function StorefrontView({ session, products }: StorefrontViewProps) {
  const [activePill, setActivePill] = useState(ALL_PILL_ID);

  const pills = useMemo(() => derivePills(products), [products]);

  const filtered = useMemo(
    () =>
      activePill === ALL_PILL_ID
        ? products
        : products.filter((p) => pillIdFor(p.category) === activePill),
    [products, activePill],
  );

  const endTime = session.endTime;

  return (
    <main className="flex-1 space-y-6 p-4 pb-28 md:p-6 md:pb-10">
      {/* Urgency banner — Panel-style shell (brand gradient top bar,
          design.html:466-500). Its boxed countdown is the ONLY countdown in
          the app (D7: no payment timers anywhere); once it reaches zero the
          cells rest at 00/00/00. Sale-live status also lives in the header
          badge, so no duplicated eyebrow line here. */}
      <section className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-border dark:bg-card">
        <div className="h-1.5 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-primary" />
        <div className="flex flex-col justify-between gap-4 p-4 sm:gap-6 sm:p-6 md:flex-row md:items-center">
          <div className="flex min-w-0 items-center gap-2.5">
            <LightningIcon
              weight="fill"
              className="size-6 shrink-0 text-brand-secondary"
            />
            <h1 className="truncate text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl dark:text-neutral-50">
              {session.name || session.sessionName}
            </h1>
          </div>

          {endTime && (
            <div className="flex flex-col items-start gap-1.5 self-start md:items-end md:self-auto">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                SESI BERAKHIR DALAM
              </span>
              <CountdownTimer endTime={endTime} variant="boxed" />
            </div>
          )}
        </div>
      </section>

      {/* Category filter — one quiet snap-scroll row, "Semua" first. */}
      <CategoryPills pills={pills} active={activePill} onSelect={setActivePill} />

      {/* Product grid — mockup density (design.html:518). */}
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Tidak ada produk di kategori ini.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      <MobileCartBar />
    </main>
  );
}

export { StorefrontView };
