import { desc, eq } from "drizzle-orm";

import { CartDrawer } from "@/app/_components/cart-drawer";
import { StorefrontHeader } from "@/app/_components/storefront-header";
import { getSession } from "@/server/better-auth/server";
import { db } from "@/server/db";
import { contacts } from "@/server/db/schema";
import { resolveRecipient, type RecipientDefaults } from "@/server/recipient";
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
 *
 * Checkout prefill (Task 12): with an ACTIVE session and a signed-in
 * shopper, the drawer's `CheckoutDialog` starts from that user's LATEST
 * contact row (contacts are keyed to accounts by email). The query lives on
 * the layout — not `page.tsx` — because the layout owns the single drawer
 * instance, so `/orders` gets the same prefill without a second drawer.
 * Everything falls back to all-`null` defaults (empty fields, no hint); the
 * shopper can still edit freely — this is an SSR seed, not a lock.
 */
export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const activeSession = await getPrimaryActiveSession(db);

  let recipientDefaults: RecipientDefaults = {
    name: null,
    phone: null,
    address: null,
  };
  if (activeSession) {
    const auth = await getSession();
    if (auth) {
      const [contact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.email, auth.user.email))
        .orderBy(desc(contacts.createdAt))
        .limit(1);
      if (contact) {
        // No order snapshot exists at checkout time — resolve straight to
        // the contact fields.
        recipientDefaults = resolveRecipient({
          order: {
            recipientName: null,
            recipientPhone: null,
            recipientAddress: null,
          },
          contact,
        });
      }
    }
  }

  return (
    <div className="flex min-h-svh flex-col">
      <StorefrontHeader />
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
        {children}
      </div>
      <CartDrawer
        sessionId={activeSession?.id}
        recipientDefaults={recipientDefaults}
      />
    </div>
  );
}
