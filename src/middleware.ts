import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth guard: redirects logged-out users hitting protected pages to /auth/login.
 *
 * This is a PRESENCE-ONLY check on the Better Auth session token cookie
 * (`better-auth.session_token`, signed as `value.signature` — the raw value is
 * fine, we only care whether it exists). No crypto verification, no DB access:
 * middleware runs on the edge runtime where neither is available.
 *
 * This is a fast-path UX redirect, NOT a security boundary. The real gate is
 * per-page `getSession()` (which verifies the JWT signature server-side and
 * falls back to the DB) plus tRPC `protectedProcedure` for API calls. A stale
 * or forged cookie passes this check and simply fails there, and those layers
 * already redirect/deny on their own.
 */
export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get("better-auth.session_token");

  if (sessionCookie?.value) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/auth/login", request.url));
}

export const config = {
  // Protect everything except: API routes (Better Auth handler, jubelio-login,
  // sign-out), the login page itself (and anything under /auth/*), Next
  // internals, and static assets.
  matcher: [
    "/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
