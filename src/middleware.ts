import { NextResponse, type NextRequest } from "next/server";

/** Both spellings of the session cookie name. better-auth prefixes
 *  `__Secure-` onto every cookie when the baseURL is https
 *  (`node_modules/better-auth/dist/cookies/index.mjs:279`), so PRODUCTION
 *  serves `__Secure-better-auth.session_token` while dev serves the bare
 *  name — checking only one of them logs every deployed user out at the
 *  gate (the Vercel /admin → /auth/login loop). */
const SESSION_COOKIE_NAMES = [
  "__Secure-better-auth.session_token",
  "better-auth.session_token",
];

/**
 * Presence-only read of the `Cookie` request header — exported pure so the
 * name-pairing above is testable without a NextRequest (`tests/
 * middleware-session-cookie.test.ts`). Exact `name=value` pairs only: a
 * sibling cookie (`session_data`) or a near-miss name is not a session.
 */
export function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader.split(";").some((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return false;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    return value !== "" && SESSION_COOKIE_NAMES.includes(name);
  });
}

/**
 * Which login door a logged-out visitor sees, decided on the REQUESTED PATH.
 * Middleware can only tell whether a session cookie EXISTS, never what role
 * the session belongs to (`hasSessionCookie` above), so the staff/customer
 * split cannot be made from the session — the path is all we have. `/admin`
 * and anything under it get the staff door (`/auth/staff`, email/password);
 * everything else gets the customer door (`/auth/login`, Google). Exported
 * pure for tests (`tests/middleware-staff-path.test.ts`).
 */
export function loginPathFor(pathname: string): string {
  // `=== "/admin"` or a `/`-boundary prefix — a bare `startsWith("/admin")`
  // would also catch `/administrator-guide` and lock its customer reader
  // behind the staff door.
  return pathname === "/admin" || pathname.startsWith("/admin/")
    ? "/auth/staff"
    : "/auth/login";
}

/**
 * Auth guard: redirects logged-out users hitting protected pages to the
 * login door for that page's audience — staff areas to /auth/staff,
 * everything else to /auth/login (see `loginPathFor`).
 *
 * This is a PRESENCE-ONLY check on the Better Auth session token cookie (see
 * `hasSessionCookie` — signed as `value.signature`, the raw value is fine, we
 * only care whether it exists, under EITHER the dev or the `__Secure-`
 * production name). No crypto verification, no DB access: middleware runs on
 * the edge runtime where neither is available.
 *
 * This is a fast-path UX redirect, NOT a security boundary. The real gate is
 * per-page `getSession()` (which verifies the JWT signature server-side and
 * falls back to the DB) plus tRPC `protectedProcedure` for API calls. A stale
 * or forged cookie passes this check and simply fails there, and those layers
 * already redirect/deny on their own.
 */
export function middleware(request: NextRequest) {
  if (hasSessionCookie(request.headers.get("cookie") ?? "")) {
    return NextResponse.next();
  }

  return NextResponse.redirect(
    new URL(loginPathFor(request.nextUrl.pathname), request.url)
  );
}

export const config = {
  // Protect everything except: API routes (Better Auth handler, jubelio-login,
  // sign-out), the login page itself (and anything under /auth/*), Next
  // internals, and static assets.
  matcher: [
    "/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
