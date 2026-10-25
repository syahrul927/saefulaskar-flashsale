import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { contacts } from "@/server/db/schema";
import { OnboardingForm } from "./onboarding-form";

export const metadata = {
  title: "Lengkapi Profil — Flash Studio",
};

export const dynamic = "force-dynamic";

/**
 * Customer onboarding gate (spec §4.1). Landed here after Google sign-in:
 * already-registered customers bounce to the storefront; the rest fill the
 * 5-field form that registers a Jubelio contact. Unauthenticated visitors are
 * sent to login.
 */
export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login");

  const [existing] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.email, session.user.email));
  if (existing) redirect("/");

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Lengkapi Data Anda
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Kami butuh beberapa data untuk mendaftarkan toko Anda sebagai
          pelanggan sebelum bisa mulai belanja.
        </p>
        <div className="mt-8">
          <OnboardingForm />
        </div>
      </div>
    </main>
  );
}