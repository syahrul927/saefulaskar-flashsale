import { and, eq, inArray } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { flashSessions, sessionProducts } from "@/server/db/schema";
import { getStockMap, type StockMap } from "@/server/jubelio-catalog";
import { resolveImportRow } from "@/server/jubelio-import";
import { canEditProducts, reAddDecision } from "@/server/session-products-edit";
import { createJubelioClient, isJubelioAuthError } from "@/lib/jubelio";
import { z } from "zod";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

// `resolveImportRow` (the POST guard's pure decision, tested in
// `session-products-post.test.ts`) lives in `@/server/jubelio-import`: Next's
// route contract allows only HTTP handlers + config exports on `route.ts`.

const ProductInput = z.object({
  itemId: z.number().int().positive(),
  skuCode: z.string().min(1).optional(),
  itemGroupName: z.string().min(1).optional(),
  originalPrice: z.number().int().nonnegative(),
});

/**
 * GET /api/sessions/[id]/products — all session products, hidden rows included
 * (`hidden: boolean` rides on every row: this is the ADMIN list, so it must see
 * what the storefront no longer does), each with a live Jubelio `availableStock`
 * taken from the cached v2 stock map (raw ERP `available`; `null` on a map miss
 * — unknown is never shown as `0`).
 * OWNER-only, matches the admin guard of the sibling session routes.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth)
    return jsonError(401, "Anda belum masuk. Masuk dulu untuk mengubah sesi.");
  if (auth.user.role !== "OWNER")
    return jsonError(403, "Hanya admin yang bisa mengubah sesi ini.");

  const { id } = await params;
  const [session] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!session) return jsonError(404, "Sesi tidak ditemukan");

  const rows = await db
    .select()
    .from(sessionProducts)
    .where(eq(sessionProducts.sessionId, id));

  const client = createJubelioClient(auth.user.token);

  let products;
  try {
    // One cached v2 fetch replaces the old per-SKU fan-out and keys every row
    // by `itemId`, so the join below is synchronous. An expired token answers
    // 401 as before; because live stock IS this endpoint's purpose, any other
    // v2 failure now answers 502 (the old per-row `getStockBySku` path left
    // the list at 200 with the failed rows degraded to `null`) rather than
    // silently degrade the whole list.
    const map = await getStockMap(client);
    products = rows.map((row) => ({
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
      // Mid-session removal is a flag, not a delete: hidden rows are gone from
      // the storefront but stay on the roster (and keep their row for the
      // order-item FK), so the admin list has to be able to show them.
      hidden: row.hidden,
      availableStock: map.get(row.itemId)?.available ?? null,
    }));
  } catch (e) {
    if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
    return jsonError(502, "Gagal memuat stok, coba lagi");
  }

  return Response.json({ ok: true, products });
}

/**
 * POST /api/sessions/[id]/products — upsert picked products (spec §4.3),
 * guarded by the v2 import source. Body: [{ itemId, skuCode, itemGroupName,
 * originalPrice }].
 * Stock comes from the cached v2 map (`getStockMap`) instead of a per-SKU
 * `getStockBySku` fan-out: numbered rows import with raw `available`, a
 * floored quota and the v2 `thumbnail` (`resolveImportRow`) — a fresh URL
 * refreshes `image_url`, a silent v2 never blanks a stored photo; a no-number
 * re-add keeps the row's previous stock/quota/image; a no-number NEW row is
 * skipped and reported in `skipped` — never inserted with 0. A v2 outage skips all new rows but still
 * answers 201 `ok:true` (only an expired token is 401). Defaults unchanged:
 * `flashPrice = originalPrice`, `minOrder = 1`, `claimed = 0`, `category = ""`
 * — a re-add with a number resets quota to the derived value (one truth per
 * pipeline). Rows are keyed on the unique `(sessionId, itemId)` pair.
 * Edit window (spec §5.9 relaxed, design Ruling 1): SCHEDULED, ACTIVE and
 * PAUSED sessions all accept products; only an ENDED session is frozen (409).
 * Inside that window the write shape depends on the status — a SCHEDULED re-add
 * keeps today's full reset, while re-picking an item that already has a row in
 * a LIVE session only clears its `hidden` flag (the reset would silently
 * rewrite the running sale's price/minOrder/category and re-derive its quota).
 * A brand-new item in a live session takes the normal import path. OWNER-only.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth)
    return jsonError(401, "Anda belum masuk. Masuk dulu untuk mengubah sesi.");
  if (auth.user.role !== "OWNER")
    return jsonError(403, "Hanya admin yang bisa mengubah sesi ini.");

  const { id } = await params;

  const [session] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!session) return jsonError(404, "Sesi tidak ditemukan");
  // The edit window is the pure rule (`canEditProducts`) — a live session
  // (ACTIVE/PAUSED) can still be stocked; only a finished sale is a record.
  // This gate MUST come before `reAddDecision`, which has no ENDED branch and
  // would otherwise fall through to "upsert" and rewrite an ended session.
  if (!canEditProducts(session.status))
    return jsonError(409, "Sesi yang sudah berakhir tidak bisa diubah.");

  let items: z.infer<typeof ProductInput>[];
  try {
    items = ProductInput.array().parse(await request.json());
  } catch {
    return jsonError(
      400,
      "Data yang dikirim tidak valid. Kirim daftar produk: { itemId, skuCode, itemGroupName, originalPrice }.",
    );
  }
  if (items.length === 0)
    return jsonError(400, "Tambahkan minimal satu produk.");

  const client = createJubelioClient(auth.user.token);

  // One batched read of the rows already in this session: it drives the re-add
  // decision below, and gives the SCHEDULED update path (rule 2) its previous
  // stock/quota to fall back on.
  const existingRows = await db
    .select({
      itemId: sessionProducts.itemId,
      jubelioStock: sessionProducts.jubelioStock,
      sessionQuota: sessionProducts.sessionQuota,
      imageUrl: sessionProducts.imageUrl,
    })
    .from(sessionProducts)
    .where(
      and(
        eq(sessionProducts.sessionId, id),
        inArray(
          sessionProducts.itemId,
          items.map((input) => input.itemId),
        ),
      ),
    );
  const existingByItem = new Map(
    existingRows.map((row) => [row.itemId, row]),
  );

  // Design Ruling 1 — split the batch by what each row may still be written.
  // `"unhide_only"` (an item that already has a row in ACTIVE/PAUSED) bypasses
  // the stock map and the whole import path: re-picking a product of a running
  // sale must not reset its price/minOrder/category or re-derive its quota, it
  // only brings the row back into view. SCHEDULED re-adds keep today's reset
  // ("upsert") and brand-new items the normal import ("insert"), so the cached
  // v2 fetch — and its 401 / `map = null` contract — runs only when something
  // can actually import. An ENDED session never reaches this line: the
  // `canEditProducts` guard above rejects it first (`reAddDecision` has no
  // ENDED branch by design).
  const unhideItemIds: number[] = [];
  const importItems: z.infer<typeof ProductInput>[] = [];
  for (const input of items) {
    if (
      reAddDecision(session.status, existingByItem.get(input.itemId)) ===
      "unhide_only"
    ) {
      unhideItemIds.push(input.itemId);
    } else {
      importItems.push(input);
    }
  }

  // One cached v2 fetch replaces the old per-SKU `getStockBySku` fan-out. The
  // auth contract is unchanged (expired token → 401 SESSION_EXPIRED); any
  // other upstream failure degrades to `map = null` — NO 502 (partner
  // ruling): every lookup then misses, so new rows are skipped below and
  // existing rows keep their stored numbers (Review Focus 3). An all-`unhide`
  // batch skips the fetch itself: no importable row means no ERP dependency.
  let map: StockMap | null = null;
  if (importItems.length > 0) {
    try {
      map = await getStockMap(client);
    } catch (e) {
      if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
      map = null;
      // The 201 `ok:true` with everything skipped is the ruling, not a bug —
      // but the reason has to reach the server log, or the operator sees a
      // successful import that imported nothing.
      console.error(
        "session-products: getStockMap failed, skipping rows without a number",
        e,
      );
    }
  }

  const skipped: { itemId: number; skuCode: string; itemGroupName: string }[] =
    [];
  const pending = importItems.map((input) => {
    const resolved = resolveImportRow(
      map?.get(input.itemId),
      existingByItem.get(input.itemId),
    );
    if (resolved) return { input, resolved };
    skipped.push({
      itemId: input.itemId,
      skuCode: input.skuCode ?? "",
      itemGroupName: input.itemGroupName ?? "",
    });
    return null;
  });

  let created;
  try {
    const imported = await Promise.all(
      pending
        .filter((row) => row !== null)
        .map(({ input, resolved }) =>
          db
            .insert(sessionProducts)
            .values({
              sessionId: id,
              itemId: input.itemId,
              skuCode: input.skuCode ?? "",
              itemGroupName: input.itemGroupName ?? "",
              originalPrice: input.originalPrice,
              sessionQuota: resolved.sessionQuota,
              jubelioStock: resolved.jubelioStock,
              imageUrl: resolved.imageUrl,
              flashPrice: input.originalPrice,
              minOrder: 1,
              claimed: 0,
              category: "",
            })
            .onConflictDoUpdate({
              target: [sessionProducts.sessionId, sessionProducts.itemId],
              set: {
                skuCode: input.skuCode ?? "",
                itemGroupName: input.itemGroupName ?? "",
                originalPrice: input.originalPrice,
                sessionQuota: resolved.sessionQuota,
                jubelioStock: resolved.jubelioStock,
                imageUrl: resolved.imageUrl,
                flashPrice: input.originalPrice,
                minOrder: 1,
                category: "",
                // Deliberately NOT `hidden`: Ruling 1 pins SCHEDULED to today's
                // reset (price/minOrder/category/quota only). This IS reachable
                // — PUT accepts `hidden` while SCHEDULED, so re-adding that row
                // upserts it back still-hidden — and that is the spec's chosen
                // semantics, not a gap: Task 7's picker will not offer hide for
                // SCHEDULED rows (visibility stays PUT's field either way,
                // never something the reset writes here).
              },
            })
            .returning(),
        ),
    ).then((results) => results.flat());

    // `"unhide_only"` rows (design Ruling 1): one batched flag write and
    // nothing else — the live session's config stays exactly as the admin set
    // it. `.returning()` gives back the full rows, so these look identical to
    // imported rows in the response, and they are reported in `products`, NOT
    // in `skipped` (nothing blocked them; the ERP was simply not needed).
    const unhidden =
      unhideItemIds.length > 0
        ? await db
            .update(sessionProducts)
            .set({ hidden: false })
            .where(
              and(
                eq(sessionProducts.sessionId, id),
                inArray(sessionProducts.itemId, unhideItemIds),
              ),
            )
            .returning()
        : [];

    created = [...imported, ...unhidden];
  } catch (e) {
    // Genuine db failures only — stock is no longer fetched inside this loop,
    // so upstream trouble is fully handled by the `map`/skip path above. The
    // copy therefore says SAVE, not LOAD: reusing the GET branch's "Gagal memuat
    // stok" text told admins the stock read failed when their write is what
    // rolled back (the real cause only reached the console).
    console.error("session-products: db write failed", e);
    return jsonError(502, "Gagal menyimpan produk, coba lagi");
  }

  // ADDITIVE: `{ ok, products }` stays exactly as before for consumers;
  // `skipped` names the blocked rows (`[]` on the happy path). `products` is
  // import-rows-then-unhidden-rows rather than strict payload order — every
  // consumer keys rows by `itemId`, so the two groups never need to interleave.
  return Response.json(
    { ok: true, products: created, skipped },
    { status: 201 },
  );
}
