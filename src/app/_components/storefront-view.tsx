"use client";

import { useMemo, useState } from "react";

import { CategoryPills } from "./category-pills";
import { CountdownTimer } from "./countdown-timer";
import { ProductCard, type StorefrontProduct } from "./product-card";
import { CartDrawer } from "./cart-drawer";
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
 * Interactive storefront body — category filter + product grid live on the
 * client, session/products are fetched (server components) and passed in.
 * G13: page container uses `flex-1 space-y-6 p-4 md:p-6`.
 */
function StorefrontView({ session, products }: StorefrontViewProps) {
  const [activeCategory, setActiveCategory] = useState("All");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((p) => p.category)
            .filter((c): c is string => !!c && c.trim() !== ""),
        ),
      ),
    [products],
  );

  const filtered = useMemo(
    () =>
      activeCategory === "All"
        ? products
        : products.filter((p) => p.category === activeCategory),
    [products, activeCategory],
  );

  const endTime = session.endTime;

  return (
    <main className="flex-1 space-y-6 p-4 pb-28 md:p-6 md:pb-10">
      {/* Hero — session name + countdown */}
      <section className="rounded-4xl border border-border bg-card p-6 shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Flash Sale Sedang Berlangsung
        </p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            {session.name || session.sessionName}
          </h1>
          {endTime && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Berakhir dalam</span>
              <CountdownTimer
                endTime={endTime}
                className="rounded-2xl bg-primary px-3 py-1.5 text-base font-bold text-primary-foreground"
              />
            </div>
          )}
        </div>
      </section>

      {/* Category pills + "All" */}
      <CategoryPills
        categories={categories}
        active={activeCategory}
        onSelect={setActiveCategory}
      />

      {/* Product grid */}
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Tidak ada produk di kategori ini.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      <MobileCartBar onViewCart={() => setDrawerOpen(true)} />

      <CartDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </main>
  );
}

export { StorefrontView };
