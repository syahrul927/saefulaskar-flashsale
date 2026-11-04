import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";

import { db } from "@/server/db";
import { sessionProducts } from "@/server/db/schema";
import { getPrimaryActiveSession } from "@/server/session-query";
import { StorefrontView } from "@/app/_components/storefront-view";
import type { StorefrontProduct } from "@/app/_components/product-card";

export const metadata: Metadata = {
  title: "Flash Studio — Flash Sale",
  description:
    "Belanja produk flash sale dengan harga spesial selagi stok dan kuota masih ada.",
};

export const revalidate = 0;
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Cached per request — the storefront layout asks the same question for the
  // cart drawer, so this row is read from the DB once even on a cold `/`.
  const active = await getPrimaryActiveSession(db);

  if (!active) {
    return (
      <main className="flex min-h-[70dvh] flex-1 items-center justify-center p-6">
        <div className="max-w-sm rounded-4xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold text-foreground">
            Belum ada Flash Sale aktif
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pantau terus — sesi berikutnya akan segera dibuka oleh tim kami.
          </p>
        </div>
      </main>
    );
  }

  // Hidden products (admin "remove from sale" on a live session) leave the
  // grid — the row stays in the DB for audit, and checkout refuses it too.
  const rows = await db
    .select()
    .from(sessionProducts)
    .where(
      and(
        eq(sessionProducts.sessionId, active.id),
        eq(sessionProducts.hidden, false),
      ),
    );

  const products: StorefrontProduct[] = rows.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    skuCode: row.skuCode,
    itemGroupName: row.itemGroupName,
    originalPrice: row.originalPrice,
    sessionQuota: row.sessionQuota,
    claimed: row.claimed,
    minOrder: row.minOrder,
    flashPrice: row.flashPrice,
    category: row.category,
    availableStock: row.jubelioStock,
    image: row.imageUrl,
    type: row.type,
  }));

  return (
    <StorefrontView
      session={{
        id: active.id,
        name: active.name,
        sessionName: active.sessionName,
        startTime: active.startTime?.toISOString() ?? null,
        endTime: active.endTime?.toISOString() ?? null,
        status: active.status,
      }}
      products={products}
    />
  );
}
