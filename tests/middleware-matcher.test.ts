import { describe, expect, it } from "vitest";

import { config } from "@/middleware";

/**
 * Which requests reach the auth guard at all — `config.matcher`, pinned here
 * because nothing else in the suite reads it. Which door a bounced visitor
 * gets is `loginPathFor`, pinned in `middleware-staff-path.test.ts`; whether a
 * cookie counts as a session is `hasSessionCookie`, pinned in
 * `middleware-session-cookie.test.ts`.
 *
 * `config.matcher` is a Next matcher string: a leading `/` followed by the
 * regex body — here one negative lookahead over the path WITHOUT its leading
 * slash. The harness strips the slash the same way Next does. Every row below
 * was also checked against the running dev server (logged-out `curl`):
 * /auth/login and /auth/staff 200, /api/auth/jubelio-login 405 (reaches the
 * route handler), /favicon.ico and /brand/logo-lockup.png 200, /orders,
 * /login/success and /admin/orders 307 to their door. So the harness agrees
 * with what Next actually does to these paths.
 */
const [matcherPattern = ""] = config.matcher;
const guardRe = new RegExp(`^${matcherPattern.slice(1)}$`);
const isGuarded = (pathname: string) => guardRe.test(pathname.slice(1));

describe("middleware matcher", () => {
  it("guards the app pages and leaves both doors, the API and assets alone", () => {
    // Both doors must stay OUT of the matcher. Falsifies: dropping `auth` from
    // the lookahead — a logged-out visitor on /auth/login then matches, gets
    // redirected to /auth/login, matches again: an infinite redirect loop, and
    // nobody in the app can sign in at all. HEAD's config comment named "the
    // login page itself" — singular — so nothing in it said BOTH doors ride on
    // this one alternative, which is how that edit gets waved through.
    expect(isGuarded("/auth/login")).toBe(false);
    expect(isGuarded("/auth/staff")).toBe(false);

    // The auth API must stay OUT. Falsifies: dropping `api` — the staff
    // credential POST (src/components/auth-form.tsx:35) comes from a browser
    // that has no session cookie YET, so the guard would bounce the exchange
    // that creates one. `/api/auth/sign-out` (use-session-expiry.ts:17) is
    // bounced the same way.
    expect(isGuarded("/api/auth/jubelio-login")).toBe(false);
    expect(isGuarded("/api/auth/sign-out")).toBe(false);

    // App pages must stay IN. Falsifies: widening the exclusion (a `(?!.*login)`
    // style "don't guard anything login-ish", or `|login|success` added to the
    // lookahead) — then a logged-out /orders renders the buyer's order shell
    // with no session behind it and the redirect never happens.
    expect(isGuarded("/orders")).toBe(true);
    expect(isGuarded("/login/success")).toBe(true);

    // Static assets must stay OUT. Falsifies: dropping the extension list or
    // `favicon.ico` — every image request runs the guard, so the white brand
    // lockup on the door itself 302s for a logged-out visitor and the page a
    // visitor needs in order to sign in renders with a broken image.
    expect(isGuarded("/favicon.ico")).toBe(false);
    expect(isGuarded("/brand/logo-lockup.png")).toBe(false);
  });
});
