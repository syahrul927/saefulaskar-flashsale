# Design — Jubelio Login

Date: 2026-10-20
Status: Draft

## 1. Intent & Why

Allow staff and owner (anyone with a Jubelio account) to sign in with their existing Jubelio credentials. Jubelio is the source of truth for authentication. The app creates a local mirror of the user so tRPC protected procedures can run and future per-user features (roles, NIK) have a home.

Reference: safar-operation uses NextAuth v4 + Credentials + `POST {JUBELIO_HOST}/login`. This app uses Better Auth + Drizzle, so we port the reference behavior rather than the reference library.

## 2. Goals / Non-Goals / Anti-Goals

### Goals
- Jubelio-credential login works end-to-end: validate against Jubelio, issue Better Auth session.
- Session carries raw Jubelio token, currentCompany, role.
- Mobile-first login UI built from existing shadcn components.
- After login: dummy page indicating success, with sign-out.

### Non-Goals (this iteration)
- No real dashboard.
- No role-specific behavior beyond storing role.
- No registration, password reset, email verification, 2FA.
- No service-level token cache (`jubelio-auth.ts` equivalent) — background jobs not built yet.

### Anti-Goals
- Hard-blocked login when local DB is down (must fall back like reference).
- Login page impossible to use on phone.
- Dummy page showing raw token / no sign-out — unacceptable.

## 3. Constraints

- Must use `yarn` (repo CLAUDE.md), not pnpm.
- Only `pnpm db:generate` — wait, repo uses Prisma? No — this app uses **Drizzle + `pnpm db:generate`**. Actually per server rules, DB migration ops done by human. `db:generate` is the only migration SQL file generator for this repo.
- Follow existing shadcn conventions, tailwind v4 (globals.css), base-nova style, remixicon icons.
- Existing login-related scaffold (`page.tsx` GitHub sign-in) gets replaced.
- Keep Better Auth core (`config.ts`, `server.ts`, `client.ts`, Drizzle schema tables) — work with it, not against it.
- Use `@/` alias matching existing imports (`@/components`, `@/server/better-auth`).
- Environment variables: add `JUBELIO_HOST`. Decide `.env` handling.
- Reuse `src/server/better-auth/server.ts` getSession pattern.

## 4. Decisions Made

### 4.1 Wiring — custom server-side flow (Option A)
Client login form does NOT use Better Auth's built-in email+password provider. Instead:

- Client calls a server action (or a custom auth endpoint) with `{ email, password }`.
- Server validates against Jubelio `POST {JUBELIO_HOST}/login`, upserts local user, then creates a Better Auth session via server-side API.
- Session ends up carrying Jubelio token + role + currentCompany on the user object.

Better Auth's built-in `emailAndPassword` email+password provider stays **disabled** (or removed from config) — local password is never verified. Local password column is placeholder.

TODO: confirm Better Auth's server-side session creation API (e.g. `auth.api.createSession` or custom session via `auth.$query`), fallback is a custom route handler.

### 4.2 Source of truth for credentials
Jubelio. **No `password` column on `user`** — Better Auth (and this design) don't need it. Reference's `password: 'N/A'` was a NextAuth-JWT artifact; we omit. Cleaner schema.

### 4.2a Session strategy — JWT
Better Auth configured for **JWT sessions** (`session.strategy = 'jwt'`), not DB-backed. Rationale: honor anti-goal (login never hard-blocked by DB downtime) — matches reference, which only worked because NextAuth JWT wrote nothing to DB. The Jubelio token + user profile ride inside the JWT. Side effects: revocation is TTL-bound, sign-out clears cookie. Builder decides exact config key placement. `getSession` in `server.ts` / `createTRPCContext` unchanged — they read the JWT.

### 4.4 Company gate (revised)
- `SAFAR_COMPANY_ID` env var, required in prod, default `59325` locally.
- Login route checks `currentCompany !== env.SAFAR_COMPANY_ID` → reject before issuing session. Client maps to "Company tidak valid".
- `verifyCompany` tRPC query dropped for this iteration (server enforces at login).

### 4.3 Role / owner
- Drizzle `role` enum (`STAFF` / `OWNER`), default `STAFF`.
- Upsert: **keep existing role, don't overwrite**. New users default `STAFF`.
- Owner flagged manually in DB (one-time UPDATE) — no Jubelio-side owner detection.

Security note: Better Auth session cookie is what protects dummy page + future API. No token in URL from client. Good.

### 4.5 Login form → server
`auth-form.tsx` client component. On submit: `fetch`/server action → success → redirect `/login/success` (dummy). Failure → error state + toast.

### 4.6 Dummy success page
`/login/success` — static server component, shadcn `Card`, shows "Login Berhasil" + user name, sign-out button. Mobile-first.

### 4.7 UI/UX
- shadcn `Input`, `Button` (isLoading), `Card`, `Label`, `Eye`/`EyeOff` toggle (remixicon `eye-line` / `eye-off-line`).
- Form validation: simplest zod + react-hook-form matching existing patterns (reference uses zodResolver). But — form-hook deps not yet in this app? Check: existing app has no form libs. Keep it lean: native form + client state, no react-hook-form needed for 2 fields. Shadcn form DO add weight — skip. Use `Input`, `Label`, local `useState`, manual validation.
- Submit: API-triggered button → `isLoading` true (Button supports per CLAUDE.md/global).
- Mobile: full-viewport centered card, `min-h-[100dvh]`, `px` gutters.
- Brand: static text "Saeful Askar Flash Sale" + tagline "Masuk menggunakan akun Jubelio kamu!" (match reference vibe, amber/amber accent).
- Errors: inline `p` (destructive text) + optional toast (sonner exists? check). Reference uses legacy use-toast. Prefer sonner if present.

### 4.8 Session shape
Augment Better Auth session user with:
```ts
{ id, email, name, image?, token: string, currentCompany: number, role: 'STAFF'|'OWNER', fullName: string }
```
`getSession` / `createTRPCContext` unchanged; `protectedProcedure` needs `ctx.session.user`.

## 5. Build Plan (high level)

1. Env: add `JUBELIO_HOST` to `src/env.js` + `.env.example`.
2. Schema: add `role`, `currentCompany`, `nik`, `fullName` to Drizzle `user`.
3. Server login route: `src/app/api/auth/jubelio-login/route.ts` or server action `src/server/actions/login.ts`.
4. Better Auth config: augment types + optional session token storage (DB session row has `token` field, or session metadata). Store Jubelio token in session.
5. User upsert helper `src/lib/upsert-user.ts` — shared.
6. `auth-form.tsx` + `/auth/login` page.
7. `/login/success` dummy page + guard: any non-auth page redirects if no session.
8. Guard: server-side check (`redirect('/auth/login')`) in layout or `src/middleware.ts` — prefer later, but session absence → redirect. Note Better Auth `/api/auth/*` route must remain public.

## 6. Open Builder Questions

1. How exactly does Better Auth v1.3 create a session server-side with custom fields, given disabled email+password provider? Wrong guess matters → decides route shape (custom route + `auth.api.signInEmail` vs custom session API). Target: leave to builder to verify against installed better-auth version.
2. Session token storage: does customized user object require `session.extraFields` config, or plain session metadata? — Builder decides after checking `better-auth` types.
3. Is sonner installed or should errors be inline only? — minor, builder picks.

## 7. Implementation Checklist (Tracking)

- [ ] Env: `JUBELIO_HOST` in `src/env.js` + `.env.example`
- [ ] Schema: `role` enum, `currentCompany`, `nik`, `fullName` on `user` (Drizzle)
- [ ] Server login route / action (Jubelio call + upsert + Better Auth session)
- [ ] `upsert-user.ts` logic incl. DB-down fallback (get-or-create)
- [ ] Better Auth config: type augmentation + session token
- [ ] `auth-form.tsx` client component (mobile-friendly)
- [ ] `/auth/login` page (mobile-first)
- [ ] `/login/success` dummy page (server component, sign-out)
- [ ] Guard: unauthenticated visit → redirect `/auth/login`
- [ ] `db:generate` — human applies migration
- [ ] Build & verify

## 8. Acceptance Criteria (from brainstorm + user flow)

1. Valid Jubelio creds → session created → redirect to `/login/success` showing user name.
2. Invalid creds → error message, form re-enabled, no session.
3. New user on first login → local row auto-created, `role` default `STAFF`.
4. Existing user role preserved on subsequent logins (owner stays owner).
5. `currentCompany !== 59325` → login rejected with clear message.
6. Mobile layout: no horizontal scroll, usable at 375px width.
7. Logged-in user → dummy page; logged-out user → redirect to login.
8. Sign-out button → session destroyed → back to login.
9. shadcn components used; no hand-rolled stying.

## 9. Reference Links
- Reference PRD: `docs/login-prd.md` (this repo)
- safar-operation stack notes in that PRD §7 mapping table
- Better Auth: `src/server/better-auth/` (config, server, client) current scaffold in this repo
