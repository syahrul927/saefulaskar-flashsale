import { eq } from "drizzle-orm";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { orders } from "@/server/db/schema";
import { saveProof, validateProof } from "@/server/upload";

export const runtime = "nodejs";

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

/**
 * POST /api/orders/[id]/upload-proof — multipart upload of a transfer receipt.
 * Guards: signed-in owner of the order, image/jpeg|png ≤ 5 MB. Writes to
 * `public/uploads` with a randomized name and stores the URL on the order.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Unauthorized");

  const { id } = await params;

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id));
  if (!order) return jsonError(404, "Pesanan tidak ditemukan");
  if (order.customerId !== auth.user.id) return jsonError(403, "Forbidden");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Expected multipart/form-data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, "Field `file` required");
  }

  const validation = validateProof({ size: file.size, type: file.type });
  if (!validation.ok) {
    return validation.error === "TOO_LARGE"
      ? jsonError(413, "File terlalu besar (maks 5 MB)")
      : jsonError(415, "Format harus JPG atau PNG");
  }

  const { url } = await saveProof({
    buffer: Buffer.from(await file.arrayBuffer()),
    type: file.type,
  });

  await db
    .update(orders)
    .set({ transferProofUrl: url })
    .where(eq(orders.id, id));

  return Response.json({ ok: true, transferProofUrl: url });
}