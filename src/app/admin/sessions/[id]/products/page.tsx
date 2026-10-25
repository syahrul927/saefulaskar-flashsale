import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { db } from "@/server/db";
import { flashSessions, sessionProducts } from "@/server/db/schema";
import {
  ProductPicker,
  type SessionProduct,
} from "@/app/_components/product-picker";

export const metadata: Metadata = {
  title: "Produk Sesi — Flash Studio Admin",
};

export const dynamic = "force-dynamic";

/**
 * Products for one session (spec §4.3). Editable while SCHEDULED, read-only
 * after activation (config frozen, spec §5.9). Reads the local rows directly
 * for a fast render; the picker performs live Jubelio lookups on add.
 */
export default async function SessionProductsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [session] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!session) notFound();

  const rows = await db
    .select()
    .from(sessionProducts)
    .where(eq(sessionProducts.sessionId, id));

  const products: SessionProduct[] = rows.map((row) => ({
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
    type: row.type,
    // Real Jubelio stock persisted on the row — was hardcoded `null`, which
    // blanked the roster's stock column (spec D: show actual stock).
    availableStock: row.jubelioStock,
  }));

  const editable = session.status === "SCHEDULED";

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              ← Sesi
            </Link>
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            {session.name}
            <Badge variant={session.status === "ACTIVE" ? "default" : "outline"}>
              {session.status}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {editable
              ? "Pilih dan atur produk untuk sesi ini."
              : "Konfigurasi produk terkunci setelah sesi aktif."}
          </p>
        </div>
      </div>

      <ProductPicker
        sessionId={session.id}
        sessionStatus={session.status}
        initialProducts={products}
      />
    </main>
  );
}