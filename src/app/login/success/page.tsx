import { redirect } from "next/navigation";

import { getSession } from "@/server/better-auth/server";

/**
 * Old OAuth landing, kept alive for stale bookmarks only. Nothing links here:
 * Google sign-in lands on `/onboarding` and Jubelio login on `/admin`, so the
 * two guards below are the whole page.
 *
 * A live session goes to the storefront; a visitor without one still gets the
 * customer door (`/auth/login`), which is customer-facing like this guard is.
 */
export default async function LoginSuccessPage() {
  const session = await getSession();

  if (!session) {
    redirect("/auth/login");
  }

  redirect("/");
}
