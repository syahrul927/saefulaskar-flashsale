import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminLogo } from "@/app/_components/admin-logo";
import { AdminNav } from "@/app/_components/admin-nav";
import { StatusBadge } from "@/app/_components/status-badge";
import { SignOutButton } from "@/components/sign-out-button";
import { db } from "@/server/db";
import { getSession } from "@/server/better-auth/server";
import { getPrimaryActiveSession } from "@/server/session-query";

export const dynamic = "force-dynamic";

/**
 * Admin shell — OWNER-only guard + mockup header chrome (design.html:50-142).
 * Non-owners bounce to the storefront, unauthenticated visitors to login.
 * (Spec §4.2 admin actions are owner-scoped.)
 *
 * The header also names the live sale: the same earliest-created ACTIVE row the
 * storefront serves (`getPrimaryActiveSession`), so owner and customer always
 * talk about the same session. Status chrome below `sm` gives way to the nav —
 * a phone rail can't carry brand, sync badge and session pill at once.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/login");
  if (session.user.role !== "OWNER") redirect("/");

  const activeSession = await getPrimaryActiveSession(db);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b border-neutral-200/90 bg-white/95 backdrop-blur dark:border-border dark:bg-card/95">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-2 px-3 sm:h-16 sm:px-6">
          {/* Brand + integration health (admin-only signal). The three-word
              wordmark is wider than the single word it replaces, so the brand
              cluster takes `min-w-0` + `truncate` (the storefront rail's
              idiom) instead of `shrink-0` — the rail never scrolls sideways on
              the narrowest phones. */}
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link
              href="/admin"
              className="flex min-w-0 items-center gap-2 sm:gap-3"
            >
              <AdminLogo />
              <span className="truncate font-heading text-sm font-extrabold uppercase tracking-tight text-neutral-950 sm:text-base dark:text-neutral-50">
                Flash Sale Grosir
              </span>
            </Link>
            <span className="hidden shrink-0 sm:inline-flex">
              <StatusBadge tone="orange" pulse>
                JUBELIO SYNC
              </StatusBadge>
            </span>
          </div>

          <AdminNav className="shrink-0" />

          {/* Live session + exit */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            {activeSession && (
              <span
                title={activeSession.name}
                className="hidden max-w-[200px] truncate rounded-full bg-brand-primary px-2.5 py-1 font-mono text-[10px] font-bold text-neutral-950 sm:inline-block"
              >
                AKTIF: {activeSession.name}
              </span>
            )}
            <SignOutButton className="h-9 w-auto px-3" />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
