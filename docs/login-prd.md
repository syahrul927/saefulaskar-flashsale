# PRD — Jubelio Login (SSO-style)

> **Superseded (2026-10-26):** this PRD documents the original Jubelio-login feature, whose role model was `STAFF`/`OWNER` with role preserved across logins. The implementation has since moved to a two-role model — Jubelio login → `OWNER` (forced), Google OAuth → `CUSTOMER`; `STAFF` removed, and login redirects to `/admin`. See `docs/superpowers/specs/2026-10-23-flashstudio-design.md`.

## 1. Goal

Allow backoffice users to sign in with their existing Jubelio account credentials (username + password), the same way the reference safar-operation app does. The app calls Jubelio's login endpoint, treats it as the single source of truth for authentication, and creates/updates a local user record so tRPC protected procedures and role checks work.

Success = user submits form → system authenticates against Jubelio → verifies company access → local user upserted → session established → redirect to dashboard. Logged-out users cannot open any page except `/auth/login` and API routes.

## 2. Current State (Target Repo)

Create T3 App scaffold with Better Auth (email + password + GitHub OAuth), Drizzle ORM, tRPC v11, Next.js 15. Docs folder empty. The Better Auth scaffold is working but this PRD replaces its primary flow with the Jubelio sideless login style.

Keep for now:
- Better Auth core (session storage, CSRF, cookie handling)
- `user` / `session` / `account` / `verification` Drizzle tables
- tRPC `createTRPCContext` (already calls `auth.api.getSession`)
- `protectedProcedure` (already checks `ctx.session?.user`)

## 3. Scope

### In scope
- Login page + form (email/username + password, show/hide password, loading state)
- Custom auth handler that calls Jubelio `/login` and issues a session via Better Auth
- Local `user` record upsert keyed by Jubelio username (email), on every login
- `currentCompany` + `role` stored on the user row; company check after login
- Session carries the Jubelio bearer token (2h TTL) for downstream Jubelio API calls
- Server-side auth guard: unauthenticated access to app pages redirects to `/auth/login`
- Company validation (`currentCompany` must equal Saeful Askar) gated behind a protected tRPC query, mirroring reference app

### Out of scope
- Self-registration / signup
- Password reset, email verification, 2FA, MFA
- Local password verification (Jubelio is the source of truth; local `password` is a placeholder)
- GitHub OAuth (scaffold default flat becomes dormant/unused until decision in Open Questions)
- API token refresh when the 2h Jubelio token expires mid-session (login again = new token)
- Multi-company account switching

## 4. How the Reference App Works (safar-operation)

### 4.1 Stack
- **NextAuth v4** with `Credentials` provider + `PrismaAdapter`, `session.strategy: 'jwt'`, `maxAge: 3h` (auth.ts)
- Prisma `User` model with `role` (`STAFF` | `OWNER`), `currentCompany` (Int, default `59325`), `nik`, `payslipPin`
- Route handler `GET/POST /api/auth/[...nextauth]`
- Auth middleware (`withAuth`) guarding all pages except `api, auth, static, fonts, images`

### 4.2 Login flow (server)
`authorize(credentials)` in `src/server/auth.ts`:

1. **Validate** credentials with `loginSchema` (zod: `{ email, password }`).
2. **Jubelio login** — `POST {JUBELIO_HOST}/login` with `{ email, password }`.
   - `!ok` → throw `Error(message)` where message prefers error body `code`, then `message`. Surfaced as `CredentialsSignin` + server-side error string.
   - `ok` → parse `LoginResponse` (zod): `{ token, fullName, userName, currentCompany, nik? }`.
3. **Sync local user** — `db.user.upsert` keyed by `email = parsedJubelioData.userName`:
   - `create`: `{ email: userName, name: fullName, currentCompany, password: 'N/A', nik }`, default `role: 'STAFF'`.
   - `update`: name + nik only.
   - **DB-down fallback**: if upsert throws, try `findUnique` read-only. If found, use stale row. If not found (new user + DB down), login still proceeds with a synthesized user, `role: 'STAFF'`.
4. **Session user object** returned to NextAuth: `{ id, fullName, userName, email, token, currentCompany, role }` — **the raw Jubelio bearer `token` lives in the session JWT** and is used downstream for all Jubelio API calls.
5. JWT callback stores `user` wholesale on `token.user`; session callback copies `token.user` to `session.user`.

### 4.3 Company validation (client)
`auth-form.tsx` submit handler:

1. `signIn('credentials', { email, password, redirect: false })`.
   - `!resp?.ok` → login-failure toast with `resp.error`, defaulting to "Username atau Password salah!" for generic `CredentialsSignin`.
   - `ok` → call tRPC `jubelioAuth.verifyCompany.query`.
2. `verifyCompany` (protectedProcedure): throws unless `ctx.session.user.currentCompany === 59325`.
   - Success → welcome toast → `router.push('/')`.
   - Failure → modal "Company tidak valid" → "Pastikan akun Jubelio kamu memiliki akses ke perusahaan yang benar (Saeful Askar)." → Sign out button.
3. Login page also calls `useBarcodeScanner.handleStopScan()` / `handleClearData()` on mount (leaves any scan-mode state).

### 4.4 Service / machine-side token (separate mechanism)
`src/lib/jubelio-auth.ts` is **not** the user login. It logs in with service env creds (`JUBELIO_EMAIL`/`JUBELIO_PASSWORD`), caches the token in memory for a 2h TTL with single-flight dedupe (`pendingLogin` promise). Used for back-office integrations (scheduled syncs, webhooks) independent of user sessions. The new app may need an equivalent later, but out of scope here.

### 4.5 Jubelio endpoints / config
- Login: `POST {JUBELIO_HOST}/login` (`LOGIN_PATH` = `/login`), body `{ email, password }`, response `{ token, fullName, userName, currentCompany, nik? }`.
- All downstream calls: `Authorization: Bearer <token from session>`.
- Hosts: `JUBELIO_HOST=https://api2.jubelio.com` (v1), `JUBELIO_HOST_OPEN=https://open.jubelio.com` (v2/core).
- `USER_PROFILE` = `/verify` exists if profile fetch is ever needed.

## 5. Requirements for This App

### 5.1 Schema changes (Drizzle)

Extend `user` table; add custom columns to match reference:

| Column | Type | Notes |
|---|---|---|
| `currentCompany` | `Int, notNull, default 59325` | Saeful Askar company id |
| `nik` | `Text, nullable` | from Jubelio login response |
| `role` | `Enum('STAFF','OWNER'), notNull, default 'STAFF'` | Drizzle pgEnum |

Reference `Session` table stores `jubelioToken` per session in addition to the DB/JWT token — in this app the Jubelio token goes on the session, not the DB row (JWT-style session like reference, or Better Auth's session cookie; decide in §10).

### 5.2 Env vars

Add to `env.js` (server) + `.env.example`:

| Var | Required | Purpose |
|---|---|---|
| `JUBELIO_HOST` | yes | Jubelio API base (`https://api2.jubelio.com`) |
| `JUBELIO_HOST_OPEN` | yes | Jubelio open/core base (`https://open.jubelio.com`) — if any core endpoints used |
| `SAFAR_COMPANY_ID` | dev | Company id that must match `currentCompany` (default `59325`); keep the constant in config if not an env var |

Keep `BETTER_AUTH_SECRET` and existing scaffold vars. `BETTER_AUTH_GITHUB_*` become optional/orphaned (see §10).

### 5.3 Auth config

Adapt `src/server/better-auth/config.ts` (or add the custom flow) so the login path is:

1. Client calls Better Auth `/sign-in/email` (or a custom endpoint) with `{ email, password }` and a flag routing to the Jubelio plugin / custom server action.
2. Server action calls Jubelio `POST {JUBELIO_HOST}/login`.
   - Non-ok → map error body `code` (preferred) / `message` to a user-facing message; throw.
3. On success, upsert local `user` keyed by `email = userName` with `currentCompany`, `nik`, `name = fullName`, `role` kept if exists else `STAFF`.
4. Create the Better Auth session **carrying `token`, `currentCompany`, `role`, `nik`, `fullName`** on the session user (`auth.$Infer.Session` augments custom fields or the raw token stored in session metadata).
5. Return session cookie.

Reference detail to preserve: the DB-down fallback (upsert → find → synthesized user) so a fresh login is never hard-blocked by a local DB outage; at minimum log loudly.

### 5.4 Session shape / type augmentation

Augment Better Auth types with a custom session user:

```ts
{
  id, email, name, image?,
  token: string,        // Jubelio bearer token
  fullName: string,
  userName: string,     // = email
  currentCompany: number,
  nik: string | null,
  role: 'STAFF' | 'OWNER',
}
```

Any module reading the session (`getSession` in `src/server/better-auth/server.ts`, tRPC ctx) treats the Jubelio `token` as non-null for authenticated users. That token is the auth handshake for every Jubelio API call in the app (mirrors `ctx.session.user.token` usage in reference routers like `jubelio-auth.getUserProfile`).

### 5.5 Company validation

- `verifyCompany` equivalent as a `protectedProcedure` query:
  ```ts
  if (ctx.session?.user?.currentCompany !== SAFAR_COMPANY_ID) {
    throw new Error('Unauthorized: Company not allowed');
  }
  ```
- Client: after successful login, call it. Success → toast + push `/`. Failure → modal "Company tidak valid" + sign out. Match reference copy: "Pastikan akun Jubelio kamu memiliki akses ke perusahaan yang benar (Saeful Askar)."

### 5.6 Login page + form

Route: `/auth/login` (mirror reference). Server component fetches nothing sensitive — CSRF is handled by Better Auth automatically. `auth-form.tsx` client component:

- Fields: email/username, password with show/hide toggle (lucide `Eye`/`EyeOff`), submit `Button` with `isLoading` spinner, disabled while in flight.
- Submit → auth client sign-in → on failure toast with mapped error (fallback "Username atau Password salah!"), on success run `verifyCompany` then route to `/`.
- Vibe/layout per this app's design system (`DESIGN.md` or shadcn tokens; reference uses `bg-safarColor`, cream/amber accent on the Jubelio label, logo with `object-contain`, bottom white sheet card on mobile).

### 5.7 Auth guard (middleware)

Next.js `src/middleware.ts` (or route groups / layout redirect) — everything except:

- `/auth/login`, `/api/*` (incl. `/api/auth/*` for Better Auth), `_next/static`, `_next/image`, `/images`, `/favicon.ico`, other public assets

must be gated: unauthenticated → redirect to `/auth/login`; authenticated → pass. Better Auth exposes a middleware helper or use `getSession`/cookie check in server components; ensure the check covers the custom session token presence, not just a signed cookie.

### 5.8 tRPC context

`createTRPCContext` already resolves `auth.api.getSession({ headers })`. With the augmented session, `protectedProcedure` automatically guarantees `ctx.session.user.token` exists for protected routers — no change needed beyond session typing.

## 6. User Flow

1. User opens `/auth/login` while logged out (any protected route redirects here).
2. Enters Jubelio email/username + password, submits.
3. Client calls sign-in → server validates → Jubelio `POST /login` → local user upsert → session issued with embedded Jubelio token.
4. Client calls `verifyCompany` (protected query).
5. `currentCompany === 59325` → success toast (e.g. "Selamat Datang!") → redirect to `/`.
6. Else → "Company tidak valid" modal → sign out.
7. Wrong creds → error toast, `Email atau password salah`-style message; no session created.
8. All subsequent Jubelio API calls reuse `session.user.token`.

## 7. Error Handling

- **Jubelio login non-200**: surface the API error `code` (e.g. "email atau password salah") when present, else generic message. Reference shows `resp.error` verbatim (except `CredentialsSignin`).
- **Local DB down at login**: reference falls back to read-only find; new user without DB → login proceeds with synthesized `role: 'STAFF'` so they can still use the app; clearly log the degraded state.
- **Company mismatch**: blocking modal, forces sign-out; never allow the session to be used.
- **tRPC errors**: keep existing error formatter (zod flatten on client).
- **All API-triggered buttons** must set `isLoading`; disable form while in flight (per repo CLAUDE.md perceived-performance rules).

## 8. Acceptance Criteria

1. Valid Jubelio credentials → session created → user lands on `/` after welcome toast.
2. Invalid credentials → no session, error message shown, form re-enabled.
3. `currentCompany !== 59325` → "Company tidak valid" modal, sign out available; app unreachable.
4. Local `user` row upserted on first login (name, email, `currentCompany`, `nik`, `role` default `STAFF`), updated on subsequent logins.
5. Jubelio bearer token present in session and usable by a protected tRPC procedure for a downstream Jubelio API call.
6. Logged-in user visiting `/auth/login` is redirected away; logged-out user visiting `/` is redirected to `/auth/login`.
7. Session expiry/revocation → next protected access returns to login (no stale access).
8. Login page follows design tokens; submit shows spinner and disables inputs during auth.

## 9. Open Questions

- Replace Better Auth default email+password with the Jubelio custom provider, or keep it alongside (dormant) as fallback?
- Store Jubelio `token` in the session (JWT-style, like reference) vs. a `Session` DB row (`jubelioToken` column, like reference Prisma `Session` model allows)? Affects revoke semantics.
- Where does `SAFAR_COMPANY_ID` live — hardcoded constant (reference hardcodes `59325`) vs env var?
- What happens when the 2h Jubelio token expires mid-session? Auto re-login with stored password (bad), force re-login prompt, or rely on `USER_PROFILE = /verify` 401 to trigger re-auth?
- Is a service-level token cache (`jubelio-auth.ts` equivalent) needed for background jobs in this app? (Separate from user login; out of scope until required.)
- Keep GitHub OAuth from scaffold as the development escape-hatch, or strip it in the same PR?
```

## 10. Package / dependency notes

- Reference: NextAuth v4 + `@next-auth/prisma-adapter` + `bcryptjs` (bcrypt unused for login — Jubelio is SSO). New app: `better-auth` v1.x + Drizzle adapter (already scaffolded).
- Custom credential flow in Better Auth runs server-side only (Route Handler or server action); never ship the Jubelio password or token to the client except via the sealed session cookie.
- `NEXTAUTH_SECRET` equivalent is `BETTER_AUTH_SECRET`.

## 11. Mapping reference → this repo (implementation checklist)

| Reference (safar-operation) | This repo |
|---|---|
| `src/server/auth.ts` NextAuthOptions | `src/server/better-auth/config.ts` custom credential flow |
| `src/app/api/auth/[...nextauth]/route.ts` | Better Auth handler `/api/auth/*` (scaffold) |
| `src/app/auth/login/page.tsx` | `src/app/auth/login/page.tsx` (new) |
| `src/app/_components/auth-form.tsx` | `src/components/auth-form.tsx` (new, adapt show/hide, toast, verify-company modal) |
| `src/lib/jubelio-auth.ts` (service token, out of scope) | future `src/lib/jubelio-auth.ts` if needed |
| `src/lib/jubelio-path.ts` getPathApi/JUBELIO_PATH | new `src/lib/jubelio-path.ts` (LOGIN_PATH, USER_PROFILE, hosts) |
| `authRouter.verifyCompany` | `src/server/api/routers/auth.ts` (or `jubelio-auth.ts`) |
| Prisma `User` (`role`, `currentCompany`, `nik`) | Drizzle `user` (+ pgEnum `role`, cols) |
| `withAuth` middleware | `src/middleware.ts` or server-component session guard |
| `getServerAuthSession()` | `getSession()` in `src/server/better-auth/server.ts` |
