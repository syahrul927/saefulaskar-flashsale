import { eq } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { flashSessions, sessionProducts } from "@/server/db/schema";
import { jubelioClient, toAvailableStock } from "@/lib/jubelio";
import { z } from "zod";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

async function liveStock(sku: string | null): Promise<number | null> {
  if (!sku) return null;
  try {
    const raw = await jubelioClient.getStockBySku(sku);
    return toAvailableStock(raw) ?? null;
  } catch {
    return null;
  }
}

const ProductInput = z.object({
  itemId: z.number().int().positive(),
  skuCode: z.string().min(1).optional(),
  itemGroupName: z.string().min(1).optional(),
  originalPrice: z.number().int().nonnegative(),
});

/**
 * GET /api/sessions/[id]/products — all session products, each with a live
 * Jubelio `availableStock` (`null` when the lookup fails or there's no SKU).
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

  const products = await Promise.all(
    rows.map(async (row) => ({
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
      availableStock: await liveStock(row.skuCode),
    })),
  );

  return Response.json({ ok: true, products });
}

/**
 * POST /api/sessions/[id]/products — upsert picked products (spec §4.3).
 * Body: [{ itemId, skuCode, itemGroupName, originalPrice }].
 * For each item: live stock lookup (null on failure), then defaults
 * `sessionQuota = min(20, stock ?? 0)`, `flashPrice = originalPrice`,
 * `minOrder = 1`, `claimed = 0`, `category = ""`. Rows are keyed on the
 * unique `(sessionId, itemId)` pair — re-picking an existing item updates it
 * instead of duplicating. Only SCHEDULED sessions accept products (spec §5.9:
 * config frozen once a session leaves SCHEDULED). OWNER-only.
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

  const created = await Promise.all(
    items.map(async (input) => {
      const availableStock = await liveStock(input.skuCode ?? null);
      const sessionQuota = Math.min(20, availableStock ?? 0);
      const jubelioStock = availableStock ?? 0;
      return db
        .insert(sessionProducts)
        .values({
          sessionId: id,
          itemId: input.itemId,
          skuCode: input.skuCode ?? "",
          itemGroupName: input.itemGroupName ?? "",
          originalPrice: input.originalPrice,
          sessionQuota,
          jubelioStock,
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
            sessionQuota,
            jubelioStock,
            flashPrice: input.originalPrice,
            minOrder: 1,
            category: "",
          },
        })
        .returning();
    }),
  ).then((results) => results.flat());

  return Response.json({ ok: true, products: created }, { status: 201 });
}
