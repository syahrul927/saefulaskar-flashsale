import { and, eq, inArray } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { flashSessions, sessionProducts } from "@/server/db/schema";
import { getStockMap, type StockMap } from "@/server/jubelio-catalog";
import {
  createJubelioClient,
  isJubelioAuthError,
  type StockEntry,
} from "@/lib/jubelio";
import { z } from "zod";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

/** What one import row persists for stock/quota (see `resolveImportRow`). */
export type ResolvedImport = { jubelioStock: number; sessionQuota: number };

/**
 * Pure import decision for one picked row — the testable seam of the POST
 * guard (exported for tests, same convention as `toPickerRows`).
 * 1. v2 `entry` present → raw `available` as stock; quota floors negatives at
 *    0 and caps at 20 (v2 has 4 negative-available SKUs, min −14 — a negative
 *    quota could never be repaired by PUT's `positive()` schema, while the
 *    raw negative stays true to the ERP: gate ≤0 already means sold out).
 * 2. no entry, `existing` row → keep BOTH previous values: a v2 outage must
 *    not zero a live number or clobber admin quota edits (missing ≠ empty).
 * 3. no entry, no existing → `null` = skip: a brand-new row with no ERP
 *    number is blocked from import (partner ruling).
 */
export function resolveImportRow(
  entry: StockEntry | undefined,
  existing: { jubelioStock: number; sessionQuota: number } | undefined,
): ResolvedImport | null {
  if (entry) {
    return {
      jubelioStock: entry.available,
      sessionQuota: Math.max(0, Math.min(20, entry.available)),
    };
  }
  if (existing) {
    return {
      jubelioStock: existing.jubelioStock,
      sessionQuota: existing.sessionQuota,
    };
  }
  return null;
}

const ProductInput = z.object({
  itemId: z.number().int().positive(),
  skuCode: z.string().min(1).optional(),
  itemGroupName: z.string().min(1).optional(),
  originalPrice: z.number().int().nonnegative(),
});

/**
 * GET /api/sessions/[id]/products — all session products, each with a live
 * Jubelio `availableStock` taken from the cached v2 stock map (raw ERP
 * `available`; `null` on a map miss — unknown is never shown as `0`).
 * OWNER-only, matches the admin guard of the sibling session routes.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER")
    return jsonError(403, "Forbidden");

  const { id } = await params;
  const [session] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!session) return jsonError(404, "Session not found");

  const rows = await db
    .select()
    .from(sessionProducts)
    .where(eq(sessionProducts.sessionId, id));

  const client = createJubelioClient(auth.user.token);

  let products;
  try {
    // One cached v2 fetch replaces the old per-SKU fan-out and keys every row
    // by `itemId`, so the join below is synchronous. Failure semantics stay as
    // before for an expired token (401); because live stock IS this endpoint's
    // purpose, any other v2 failure still answers 502 rather than degrade the
    // whole list to `null`.
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
 * `getStockBySku` fan-out: numbered rows import with raw `available` and a
 * floored quota (`resolveImportRow`); a no-number re-add keeps the row's
 * previous stock/quota; a no-number NEW row is skipped and reported in
 * `skipped` — never inserted with 0. A v2 outage skips all new rows but still
 * answers 201 `ok:true` (only an expired token is 401). Defaults unchanged:
 * `flashPrice = originalPrice`, `minOrder = 1`, `claimed = 0`, `category = ""`
 * — a re-add with a number resets quota to the derived value (one truth per
 * pipeline). Rows are keyed on the unique `(sessionId, itemId)` pair. Only
 * SCHEDULED sessions accept products (spec §5.9). OWNER-only.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER")
    return jsonError(403, "Forbidden");

  const { id } = await params;

  const [session] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!session) return jsonError(404, "Session not found");
  if (session.status !== "SCHEDULED")
    return jsonError(409, "Only SCHEDULED sessions can modify products");

  let items: z.infer<typeof ProductInput>[];
  try {
    items = ProductInput.array().parse(await request.json());
  } catch {
    return jsonError(
      400,
      "Invalid body: array of { itemId, skuCode, itemGroupName, originalPrice }",
    );
  }
  if (items.length === 0)
    return jsonError(400, "At least one product is required");

  const client = createJubelioClient(auth.user.token);

  // One cached v2 fetch replaces the old per-SKU `getStockBySku` fan-out. The
  // auth contract is unchanged (expired token → 401 SESSION_EXPIRED); any
  // other upstream failure degrades to `map = null` — NO 502 (partner
  // ruling): every lookup then misses, so new rows are skipped below and
  // existing rows keep their stored numbers (Review Focus 3).
  let map: StockMap | null;
  try {
    map = await getStockMap(client);
  } catch (e) {
    if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
    map = null;
  }

  // One batched read of the rows already in this session, so the update path
  // (rule 2) has its previous stock/quota to fall back on.
  const existingRows = await db
    .select({
      itemId: sessionProducts.itemId,
      jubelioStock: sessionProducts.jubelioStock,
      sessionQuota: sessionProducts.sessionQuota,
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

  const skipped: { itemId: number; skuCode: string; itemGroupName: string }[] =
    [];
  const pending = items.map((input) => {
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
    created = await Promise.all(
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
                flashPrice: input.originalPrice,
                minOrder: 1,
                category: "",
              },
            })
            .returning(),
        ),
    ).then((results) => results.flat());
  } catch {
    // Genuine db failures only — stock is no longer fetched inside this loop,
    // so upstream trouble is fully handled by the `map`/skip path above.
    return jsonError(502, "Gagal memuat stok, coba lagi");
  }

  // ADDITIVE: `{ ok, products }` stays exactly as before for consumers;
  // `skipped` names the blocked rows (`[]` on the happy path).
  return Response.json(
    { ok: true, products: created, skipped },
    { status: 201 },
  );
}
