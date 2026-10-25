import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/server/better-auth/server";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

/**
 * Admin shell — OWNER-only guard + nav. Non-owners bounce to the storefront,
 * unauthenticated visitors to login. (Spec §4.2 admin actions are owner-scoped.)
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/login");
  if (session.user.role !== "OWNER") redirect("/");

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-1">
            <Link
              href="/admin"
              className="font-heading text-lg font-semibold tracking-tight text-foreground"
            >
              Flash Studio Admin
            </Link>
            <nav className="ml-6 flex items-center gap-1 text-sm">
              <Link
                href="/admin"
                className="rounded-2xl px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Sesi
              </Link>
              <Link
                href="/admin/orders"
                className="rounded-2xl px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Pesanan
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <SignOutButton className="h-9 w-auto px-3" />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}