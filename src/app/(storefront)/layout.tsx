import { CartDrawer } from "@/app/_components/cart-drawer";
import { StorefrontHeader } from "@/app/_components/storefront-header";
import { db } from "@/server/db";
import { getPrimaryActiveSession } from "@/server/session-query";

/**
 * Storefront shell — customer header + the ONE cart drawer.
 *
 * The drawer used to live inside `StorefrontView`, which meant it only
 * existed on `/` and vanished on `/orders`. Mounting it here (visibility
 * driven by `CartContext.drawerOpen`) keeps the cart reachable from every
 * storefront route on every breakpoint. The session id needed by checkout is
 * read once with `getPrimaryActiveSession` — the same earliest-created ACTIVE
 * row the storefront page serves — so drawer and grid always describe the
 * same sale. Header chrome itself fetches nothing and paints immediately.
 */
export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const activeSession = await getPrimaryActiveSession(db);

  return (
    <div className="flex min-h-svh flex-col">
      <StorefrontHeader />
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
        {children}
      </div>
      <CartDrawer sessionId={activeSession?.id} />
    </div>
  );
}
