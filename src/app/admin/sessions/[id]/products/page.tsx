import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { flashSessions, sessionProducts } from "@/server/db/schema";
import { getStockMap } from "@/server/jubelio-catalog";
import { rosterProducts } from "@/server/roster-products";
import { createJubelioClient } from "@/lib/jubelio";
import { ProductPicker } from "@/app/_components/product-picker";

export const metadata: Metadata = {
  title: "Produk Sesi — Flash Studio Admin",
};

export const dynamic = "force-dynamic";

/**
 * Products for one session (spec §4.3). Editable while SCHEDULED, read-only
 * after activation (config frozen, spec §5.9). Local rows carry the config;
 * stock and thumbnails come from the shared cached v2 map, so the roster can
 * never show a number the admin dashboard has already moved past (imports use
 * the same map, guarded by `resolveImportRow`).
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

  // Parity, not persistence: one shared 60 s-TTL v2 fetch feeds the roster the
  // same `available` + thumbnail the picker search rows and the products API
  // show, and it beats the `jubelio_stock` snapshot column on every row. A v2
  // failure degrades to `map = null` — the roster still renders with "—" and
  // letter tiles, never a stale or fabricated number.
  const auth = await getSession();
  const map = auth
    ? await getStockMap(createJubelioClient(auth.user.token)).catch((e) => {
        // Still render "—"/letter tiles, but leave a trace — otherwise a v2
        // outage is indistinguishable from a genuinely unstocked catalog.
        console.error(
          "roster: getStockMap failed, serving null stock/image",
          e,
        );
        return null;
      })
    : null;

  const products = rosterProducts(rows, map);

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