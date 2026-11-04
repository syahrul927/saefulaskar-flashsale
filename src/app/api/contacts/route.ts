import { eq } from "drizzle-orm";
import { z } from "zod";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { contacts } from "@/server/db/schema";
import { withSystemClient } from "@/server/jubelio-token";

export const runtime = "nodejs";

const CreateContact = z.object({
  contactName: z.string().min(1),
  primaryContact: z.string().min(1),
  contactPosition: z.enum(["pemilik", "procurement"]),
  phone: z.string().min(1),
  sAddress: z.string().min(1),
});

function jsonError(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

/**
 * POST /api/contacts — register the signed-in customer in Jubelio (spec §4.1).
 * Body: { contactName, primaryContact, contactPosition, phone, sAddress }.
 * Calls Jubelio `POST /contacts/` (contact_type 0, is_reseller true), stores the
 * returned `contact_id` + fields on the `contacts` row keyed by user email.
 */
export async function POST(request: Request) {
  const auth = await getSession();
  if (!auth)
    return jsonError(401, "Anda belum masuk. Masuk dulu untuk melengkapi profil.");

  let body: z.infer<typeof CreateContact>;
  try {
    body = CreateContact.parse(await request.json());
  } catch {
    return jsonError(
      400,
      "Data yang dikirim tidak valid. Sertakan contactName, primaryContact, contactPosition (pemilik|procurement), phone, dan sAddress.",
    );
  }

  // Create the Jubelio contact first so a partial local row isn't left behind.
  // The customer holds no Jubelio login, so this runs as the system account.
  let data: unknown;
  try {
    data = await withSystemClient((client) =>
      client.createContact({
        contact_id: 0,
        contact_name: body.contactName,
        contact_type: 0,
        phone: body.phone,
        primary_contact: body.primaryContact,
        contact_position: body.contactPosition,
        s_address: body.sAddress,
        is_reseller: true,
      }),
    );
  } catch (e) {
    console.error("contacts: jubelio createContact failed", e);
    return jsonError(502, "Gagal mendaftar ke Jubelio, coba lagi");
  }

  const jubelioContactId = (data as { contact_id?: number } | null)?.contact_id;
  if (!jubelioContactId) {
    return jsonError(502, "Jubelio tidak mengembalikan contact_id");
  }

  const [row] = await db
    .insert(contacts)
    .values({
      email: auth.user.email,
      jubelioContactId,
      contactName: body.contactName,
      primaryContact: body.primaryContact,
      contactPosition: body.contactPosition,
      phone: body.phone,
      sAddress: body.sAddress,
    })
    .onConflictDoUpdate({
      target: contacts.email,
      set: {
        jubelioContactId,
        contactName: body.contactName,
        primaryContact: body.primaryContact,
        contactPosition: body.contactPosition,
        phone: body.phone,
        sAddress: body.sAddress,
      },
    })
    .returning();

  return Response.json({ ok: true, contact: row }, { status: 201 });
}

/** GET /api/contacts/me — the signed-in customer's contact row, or 404. */
export async function GET() {
  const auth = await getSession();
  if (!auth) return jsonError(401, "Anda belum masuk. Masuk dulu untuk melanjutkan.");

  const [row] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.email, auth.user.email));

  if (!row) return jsonError(404, "Belum terdaftar");
  return Response.json({ ok: true, contact: row });
}