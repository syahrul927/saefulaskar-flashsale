import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "@/middleware";

/**
 * The seam between the two pure helpers and the response Next returns.
 * `middleware-staff-path.test.ts` pins `loginPathFor`,
 * `middleware-matcher.test.ts` pins `config.matcher`,
 * `middleware-session-cookie.test.ts` pins `hasSessionCookie` — and nothing
 * here called `middleware()` itself, so
 * replacing `loginPathFor(request.nextUrl.pathname)` at src/middleware.ts:71
 * with a hardcoded `"/auth/login"` kept the whole suite green while logged-out
 * `/admin` showed the Google-only customer door: the exact failure Review
 * Focus 1 exists to prevent, and the one this branch is named for.
 *
 * These are the three shapes the seam has — a staff bounce, a customer bounce
 * and a pass-through. They run under the `node` environment: Next's
 * `NextResponse.redirect` is pure (`headers.set('Location', validateURL(url))`,
 * default status 307), so no edge runtime is involved.
 */
describe("middleware wiring (the call site, not the helpers)", () => {
  it("bounces a logged-out /admin to the staff door", () => {
    const res = middleware(new NextRequest("http://localhost:3000/admin"));

    // Falsifies the hardcoded door above: `loginPathFor` stays correct on its
    // own, so only the call site going red proves the split is actually wired.
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/auth\/staff$/);
  });

  it("bounces a logged-out /orders to the customer door", () => {
    const res = middleware(new NextRequest("http://localhost:3000/orders"));

    // And its mirror: an `else → "/auth/staff"` default, or a staff-path list
    // that grows, lands a buyer on the email/password form.
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/auth\/login$/);
  });

  it("passes a request that carries a session cookie through", () => {
    const res = middleware(
      new NextRequest("http://localhost:3000/orders", {
        headers: { cookie: "better-auth.session_token=abc" },
      }),
    );

    // `NextResponse.next()` — status 200, no `Location`. Falsifies dropping the
    // `hasSessionCookie` read: every signed-in visitor gets bounced to their
    // door, which then bounces back to the page they just came from.
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
