import { and, eq } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import {
  flashSessions,
  PRODUCT_TYPES,
  sessionProducts,
} from "@/server/db/schema";
import { getStockMap } from "@/server/jubelio-catalog";
import {
  canEditProducts,
  quotaUpdateDecision,
} from "@/server/session-products-edit";
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
    // Mid-session removal is a flag, not a delete: `hidden` takes the product
    // off the storefront while the row (and its order-item FK) survives. It is
    // a normal single-field edit, so it also satisfies "at least one field".
    hidden: z.boolean().optional(),
  })
  .refine(
    (o) =>
      o.sessionQuota !== undefined ||
      o.minOrder !== undefined ||
      o.flashPrice !== undefined ||
      o.category !== undefined ||
      o.type !== undefined ||
      o.hidden !== undefined,
    {
      message: "minimal satu field harus diisi",
    },
  );

/**
 * GET /api/sessions/[id]/products/[itemId] — single session product with live
 * Jubelio `availableStock` read from the cached v2 stock map (raw ERP
 * `available`; `null` on a map miss or a non-auth upstream failure — unknown
 * is never shown as `0`). The row spreads in whole, so `hidden` is on the
 * payload here too. OWNER-only.
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
    return jsonError(400, "itemId tidak valid");

  const [row] = await db
    .select()
    .from(sessionProducts)
    .where(
      and(
        eq(sessionProducts.sessionId, id),
        eq(sessionProducts.itemId, itemId),
      ),
    );
  if (!row) return jsonError(404, "Produk tidak ditemukan di sesi ini");

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
 * flash price / category / type / visibility for a single product (spec §4.3,
 * G10 camelCase).
 * Body: { sessionQuota?, minOrder?, flashPrice?, category? (null = Umum),
 * type?, hidden? }.
 * Edit window (spec §5.9 relaxed): SCHEDULED, ACTIVE and PAUSED all accept
 * edits — placed orders snapshot their own price/sku/name, so a change only
 * affects future carts. ENDED stays frozen (409). Two extra rules come with a
 * live session: `sessionQuota` can never go below `claimed` (sold units are
 * history — 400 naming the floor), and a quota write refreshes the
 * `jubelio_stock` snapshot from the cached v2 map because checkout validates
 * against the snapshot, so a raised quota must not leave it behind. Neither
 * rule applies to a SCHEDULED session — its quota is written directly with no
 * stock-map read, so a pre-launch edit never depends on the ERP (an expired
 * token must not 401 a write that needs no live stock; the import path keeps
 * those snapshots fresh). OWNER-only.
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
    return jsonError(400, "itemId tidak valid");

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
        : "Body tidak valid: minimal salah satu dari sessionQuota, minOrder, flashPrice, category, type, hidden harus dikirim.",
    );
  }

  const [session] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!session) return jsonError(404, "Sesi tidak ditemukan");
  // The same pure window rule the POST and the admin UI apply: live sessions
  // accept edits, an ended one is a record. It is checked here, before any
  // write, so no status can slip through on a field-by-field path.
  if (!canEditProducts(session.status))
    return jsonError(409, "Sesi yang sudah berakhir tidak bisa diubah.");

  const [row] = await db
    .select()
    .from(sessionProducts)
    .where(
      and(
        eq(sessionProducts.sessionId, id),
        eq(sessionProducts.itemId, itemId),
      ),
    );
  if (!row) return jsonError(404, "Produk tidak ditemukan di sesi ini");

  // Quota is the one field a LIVE session cannot set freely, so its decision
  // runs before anything is written (`quotaUpdateDecision`, pure + tested):
  // the floor is what already sold, and the v2 refresh keeps `jubelio_stock`
  // from falling below the new quota (checkout validates against the snapshot).
  // Both rules exist for a running sale, so they are scoped to ACTIVE/PAUSED —
  // a SCHEDULED session has sold nothing (claimed = 0) and no checkout reads
  // it, and making its quota edit wait on the ERP would only let an expired
  // token 401 a pre-launch change (the import path keeps those snapshots
  // fresh). The stock map is read ONLY on a live quota write — hiding a
  // product never waits on the ERP, which is what keeps a live session operable
  // during an outage. Auth contract matches every sibling route on that path:
  // expired token → 401 SESSION_EXPIRED; any other failure is
  // `liveStock = undefined`, i.e. "unknown", which allows the edit and warns
  // instead of blocking it on an outage (and never zeroes the stored snapshot).
  let quotaPatch: { sessionQuota?: number; jubelioStock?: number } = {};
  let warning: "UNKNOWN_STOCK" | undefined;
  if (body.sessionQuota !== undefined) {
    if (session.status === "SCHEDULED") {
      quotaPatch = { sessionQuota: body.sessionQuota };
    } else {
      let liveStock: number | null | undefined;
      try {
        const map = await getStockMap(createJubelioClient(auth.user.token));
        liveStock = map.get(itemId)?.available ?? null;
      } catch (e) {
        if (isJubelioAuthError(e)) return jsonError(401, "SESSION_EXPIRED");
        liveStock = undefined;
        console.error(
          "session-product: getStockMap failed, quota saved with unknown stock",
          e,
        );
      }
      const decision = quotaUpdateDecision({
        claimed: row.claimed,
        requestedQuota: body.sessionQuota,
        liveStock,
      });
      if (!decision.ok)
        return jsonError(
          400,
          `Kuota minimal ${decision.floor} (sudah terjual ${decision.floor}).`,
        );
      quotaPatch = {
        sessionQuota: body.sessionQuota,
        // `null` means "don't overwrite" — the previous snapshot survives, so a
        // v2 outage can't blank a live ERP number (missing ≠ empty).
        ...(decision.jubelioStock !== null
          ? { jubelioStock: decision.jubelioStock }
          : {}),
      };
      if (decision.warnUnknownStock) warning = "UNKNOWN_STOCK";
    }
  }

  const [updated] = await db
    .update(sessionProducts)
    .set({
      ...quotaPatch,
      ...(body.minOrder !== undefined ? { minOrder: body.minOrder } : {}),
      ...(body.flashPrice !== undefined
        ? { flashPrice: body.flashPrice }
        : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
    })
    .where(
      and(
        eq(sessionProducts.sessionId, id),
        eq(sessionProducts.itemId, itemId),
      ),
    )
    .returning();

  // ADDITIVE: `warning` only appears when the stock number behind the quota
  // could not be read; the roster turns it into a toast, never an error.
  return Response.json({
    ok: true,
    product: updated,
    ...(warning ? { warning } : {}),
  });
}

/**
 * DELETE /api/sessions/[id]/products/[itemId] — hard-remove a product row,
 * SCHEDULED cleanup only. A session that has been activated never deletes:
 * `order_item` points at these rows, so mid-session removal is the `hidden`
 * flag on PUT (storefront-gone, history intact) — hence this guard deliberately
 * did NOT take the widened `canEditProducts` window. OWNER-only.
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
    return jsonError(400, "itemId tidak valid");

  const [session] = await db
    .select()
    .from(flashSessions)
    .where(eq(flashSessions.id, id));
  if (!session) return jsonError(404, "Sesi tidak ditemukan");
  // SCHEDULED-only on purpose (see the handler doc): once a session has been
  // activated, removal is the `hidden` flag on PUT — rows are referenced by
  // `order_item`, so a live sale must never lose one. The message says so,
  // because the operator's next move is the hide button, not a retry.
  if (session.status !== "SCHEDULED")
    return jsonError(
      409,
      "Hapus produk hanya untuk sesi yang belum diaktifkan. Sembunyikan produk untuk sesi yang sedang berjalan.",
    );

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
