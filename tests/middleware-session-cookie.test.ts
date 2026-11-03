import { describe, expect, it } from "vitest";

import { hasSessionCookie } from "@/middleware";

// The Vercel bug this pins: better-auth prefixes `__Secure-` onto every
// cookie name when the baseURL is https (node_modules/better-auth/dist/
// cookies/index.mjs:279), so production's session cookie is literally a
// DIFFERENT NAME than dev's. A middleware that checks only the dev name
// bounces a logged-in admin off /admin forever — login succeeds, the
// cookie exists, the guard just can't see it.

describe("hasSessionCookie", () => {
  it("sees the dev cookie name", () => {
    expect(hasSessionCookie("better-auth.session_token=abc.def")).toBe(true);
  });

  it("sees the production `__Secure-` name — the deployed-loop bug", () => {
    expect(hasSessionCookie("__Secure-better-auth.session_token=abc.def")).toBe(
      true,
    );
  });

  it("finds it among other cookies, in any order", () => {
    expect(
      hasSessionCookie(
        "other=1; __Secure-better-auth.session_token=abc.def; theme=dark",
      ),
    ).toBe(true);
    expect(
      hasSessionCookie("__Secure-better-auth.session_token=abc.def; other=1"),
    ).toBe(true);
  });

  it("no cookie header, no name, empty value — all unauthenticated", () => {
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie("theme=dark; other=1")).toBe(false);
    expect(hasSessionCookie("better-auth.session_token=")).toBe(false);
  });

  it("sibling better-auth cookies are NOT a session", () => {
    // Only session_token counts — the presence check's one job. A login-page
    // visitor can carry `better-auth.session_data` leftovers without having
    // passed the guard.
    expect(hasSessionCookie("better-auth.session_data=xyz")).toBe(false);
    expect(hasSessionCookie("better-auth.csrf_token=xyz")).toBe(false);
    // and the exact-name split must not let a longer name through
    expect(hasSessionCookie("better-auth.session_tokens=xyz")).toBe(false);
    expect(hasSessionCookie("xbetter-auth.session_token=xyz")).toBe(false);
  });

  it("a value containing `=` still reads as present", () => {
    // Cookie values are URL-encoded so `=` is escaped in practice, but the
    // split is first-`=`, so even a raw one cannot spoof a MISS into... well,
    // it stays a HIT, which is the only thing presence semantics promises.
    expect(hasSessionCookie("__Secure-better-auth.session_token=a=b=c")).toBe(
      true,
    );
  });
});
