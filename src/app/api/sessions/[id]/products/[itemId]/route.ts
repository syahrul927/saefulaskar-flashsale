import { and, eq } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import {
  flashSessions,
  PRODUCT_TYPES,
  sessionProducts,
} from "@/server/db/schema";
import { getStockMap } from "@/server/jubelio-catalog";
import { createJubelioClient, isJubelioAuthError } from "@/lib/jubelio";
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
    // `null` = "Umum" (uncategorised). Empty strings still fail here; the
    // roster picker normalises its "Umum" choice to null before sending.
    category: z.string().trim().min(1).nullable().optional(),
    type: z.enum(PRODUCT_TYPES).optional(),
  })
  .refine(
    (o) =>
      o.sessionQuota !== undefined ||
      o.minOrder !== undefined ||
      o.flashPrice !== undefined ||
      o.category !== undefined ||
      o.type !== undefined,
    {
      message: "At least one field to update is required",
    },
  );

/**
 * GET /api/sessions/[id]/products/[itemId] — single session product with live
 * Jubelio `availableStock` read from the cached v2 stock map (raw ERP
 * `available`; `null` on a map miss or a non-auth upstream failure — unknown
 * is never shown as `0`). OWNER-only.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

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

  // Same cached v2 map the picker and the list GET read, keyed on `itemId` —
  // one TTL'd fetch instead of a by-SKU call. Failure semantics are unchanged:
  // an expired token is 401 SESSION_EXPIRED, anything else degrades to
  // `availableStock: null` (a v2 outage never fails this route).
  let availableStock: number | null = null;
  try {
    const map = await getStockMap(createJubelioClient(auth.user.token));
    availableStock = map.get(itemId)?.available ?? null;
  } catch (e) {
    if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
    availableStock = null;
  }

  return Response.json({ ok: true, product: { ...row, availableStock } });
}

/**
 * PUT /api/sessions/[id]/products/[itemId] — admin override of quota / min /
 * flash price / category / type for a single product (spec §4.3, G10 camelCase).
 * Body: { sessionQuota?, minOrder?, flashPrice?, category? (null = Umum),
 * type? }.
 * Only SCHEDULED sessions accept edits (spec §5.9: config frozen once a
 * session leaves SCHEDULED). OWNER-only.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

  const { id, itemId: itemIdParam } = await params;
  const itemId = Number(itemIdParam);
  if (!Number.isInteger(itemId) || itemId <= 0)
    return jsonError(400, "Invalid itemId");

  let body: z.infer<typeof UpdateProduct>;
  try {
    body = UpdateProduct.parse(await request.json());
  } catch (err) {
    // Name the offending field(s) instead of guessing — a too-short string
    // and a missing field are different problems.
    const detail =
      err instanceof z.ZodError
        ? err.issues
            .map((issue) =>
              issue.path.length > 0
                ? `${issue.path.join(".")}: ${issue.message}`
                : issue.message,
            )
            .join("; ")
        : "";
    return jsonError(
      400,
      detail
        ? `Body tidak valid: ${detail}.`
        : "Body tidak valid: minimal salah satu dari sessionQuota, minOrder, flashPrice, category, type harus dikirim.",
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
      ...(body.type !== undefined ? { type: body.type } : {}),
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

/**
 * DELETE /api/sessions/[id]/products/[itemId] — remove a product from a session.
 * Only SCHEDULED sessions accept removal (spec §5.9: config frozen once a
 * session leaves SCHEDULED). OWNER-only.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");
  if (auth.user.role !== "OWNER") return jsonError(403, "Forbidden");

  const { id, itemId: itemIdParam } = await params;
  const itemId = Number(itemIdParam);
  if (!Number.isInteger(itemId) || itemId <= 0)
    return jsonError(400, "Invalid itemId");

  const [session] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!session) return jsonError(404, "Session not found");
  if (session.status !== "SCHEDULED")
    return jsonError(409, "Only SCHEDULED sessions can modify products");

  await db
    .delete(sessionProducts)
    .where(
      and(
        eq(sessionProducts.sessionId, id),
        eq(sessionProducts.itemId, itemId),
      ),
    );
  return Response.json({ ok: true });
}
