import { and, eq } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { flashSessions, sessionProducts } from "@/server/db/schema";
import { jubelioClient, toAvailableStock } from "@/lib/jubelio";
import { z } from "zod";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

const UpdateProduct = z
  .object({
    sessionQuota: z.number().int().positive().optional(),
    minOrder: z.number().int().positive().optional(),
    flashPrice: z.number().int().nonnegative().optional(),
    category: z.string().min(1).optional(),
  })
  .refine(
    (o) =>
      o.sessionQuota !== undefined ||
      o.minOrder !== undefined ||
      o.flashPrice !== undefined ||
      o.category !== undefined,
    {
      message: "At least one field to update is required",
    },
  );

/**
 * GET /api/sessions/[id]/products/[itemId] — single session product with live
 * Jubelio `availableStock` (`null` on lookup failure or missing SKU). OWNER-only.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if ((auth.user.role as string) !== "OWNER")
    return jsonError(403, "Forbidden");

  const { id, itemId: itemIdParam } = await params;
  const itemId = Number(itemIdParam);
  if (!Number.isInteger(itemId) || itemId <= 0)
    return jsonError(400, "Invalid itemId");

  const [row] = await db
    .select()
    .from(sessionProducts)
    .where(
      and(
        eq(sessionProducts.sessionId, id),
        eq(sessionProducts.itemId, itemId),
      ),
    );
  if (!row) return jsonError(404, "Session product not found");

  let availableStock: number | null = null;
  if (row.skuCode) {
    try {
      const raw = await jubelioClient.getStockBySku(row.skuCode);
      availableStock = toAvailableStock(raw) ?? null;
    } catch {
      availableStock = null;
    }
  }

  return Response.json({ ok: true, product: { ...row, availableStock } });
}

/**
 * PUT /api/sessions/[id]/products/[itemId] — admin override of quota / min /
 * flash price / category for a single product (spec §4.3, G10 camelCase).
 * Body: { sessionQuota?, minOrder?, flashPrice?, category? }.
 * Only SCHEDULED sessions accept edits (spec §5.9: config frozen once a
 * session leaves SCHEDULED). OWNER-only.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if ((auth.user.role as string) !== "OWNER")
    return jsonError(403, "Forbidden");

  const { id, itemId: itemIdParam } = await params;
  const itemId = Number(itemIdParam);
  if (!Number.isInteger(itemId) || itemId <= 0)
    return jsonError(400, "Invalid itemId");

  let body: z.infer<typeof UpdateProduct>;
  try {
    body = UpdateProduct.parse(await request.json());
  } catch {
    return jsonError(
      400,
      "Invalid body: at least one of sessionQuota, minOrder, flashPrice, category",
    );
  }

  const [session] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!session) return jsonError(404, "Session not found");
  if (session.status !== "SCHEDULED")
    return jsonError(409, "Only SCHEDULED sessions can modify products");

  const [row] = await db
    .select()
    .from(sessionProducts)
    .where(
      and(
        eq(sessionProducts.sessionId, id),
        eq(sessionProducts.itemId, itemId),
      ),
    );
  if (!row) return jsonError(404, "Session product not found");

  const [updated] = await db
    .update(sessionProducts)
    .set({
      ...(body.sessionQuota !== undefined
        ? { sessionQuota: body.sessionQuota }
        : {}),
      ...(body.minOrder !== undefined ? { minOrder: body.minOrder } : {}),
      ...(body.flashPrice !== undefined
        ? { flashPrice: body.flashPrice }
        : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
    })
    .where(
      and(
        eq(sessionProducts.sessionId, id),
        eq(sessionProducts.itemId, itemId),
      ),
    )
    .returning();

  return Response.json({ ok: true, product: updated });
}
