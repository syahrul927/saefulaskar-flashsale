# Jubelio Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users sign in with their Jubelio account; session carries the Jubelio token; mobile-first shadcn login form; dummy success page after login.

**Architecture:** Custom server-side login route validates credentials against Jubelio `POST {JUBELIO_HOST}/login`, upserts a local Drizzle `user` row (role preserved, default STAFF), then issues a Better Auth session carrying the raw Jubelio token, role and currentCompany. JWT-oriented session (cookie cache enabled) so login survives DB downtime — no hard-block. A root-page guard redirects unauthenticated users to `/auth/login`.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Better Auth 1.7.11, Drizzle ORM 0.41 + Postgres, Tailwind v4, shadcn/ui base-nova (remixicon icons), zod.

**Spec:** `docs/superpowers/specs/2026-10-20-jubelio-login-design.md`

## Global Constraints

- Must use `yarn` — never npm/pnpm/bun. (Repo CLAUDE.md)
- **DB migrations: user runs them.** Only `db:generate` (drizzle-kit generate) creates migration SQL; `db:migrate`/`db:push` are for the human. Generate the migration, do NOT apply.
- Follow existing shadcn/tailwind v4 conventions in `src/components/ui/` and `src/styles/globals.css`. Reuse existing components.
- Use `@/` import alias, matching existing files.
- Keep Better Auth core: `config.ts`, `server.ts`, `client.ts` and the Drizzle schema tables (user, session, account, verification) — extend, don't rewrite.
- Session user must carry `{ id, email, name, image?, token, currentCompany, role, fullName }` (fullName = Jubelio fullName).
- `JUBELIO_HOST` env var. `SAFAR_COMPANY_ID` env var, required in prod, default `59325` locally.
- No `password` column on user. No react-hook-form — 2 fields, use native inputs + useState. No sonner — inline errors.
- Language: login UI text in Indonesian, matching reference vibe ("Masuk menggunakan akun Jubelio kamu!" etc).

## Review Focus

- **Missing/wrong Jubelio credentials**: form shows clear error ("Username atau Password salah!"), no session created, inputs re-enabled.
- **DB unavailable at login**: login still succeeds if Jubelio validates (JWT/cookie session), local upsert degrades gracefully (best-effort), login never hard-blocks.
- **Company mismatch (currentCompany ≠ SAFAR_COMPANY_ID)**: login rejected server-side, client shows "Company tidak valid" (matches reference copy).
- **Existing user role preservation**: repeated logins never reset role to STAFF (owner stays owner).
- **Logged-out access to protected page**: redirected to `/auth/login`, no crash.
- **Schéma migration**: `pnpm db:generate` succeeds; git diff contains only additive user-column changes.

---

### Task 1: Env vars + Drizzle schema

**Files:**
- Modify: `src/env.js` (server schema)
- Modify: `.env.example`
- Modify: `src/server/db/schema.ts`
- Generate: Drizzle migration SQL (via `pnpm db:generate`)

**Interfaces:**
- Produces: `env.JUBELIO_HOST: string`, `env.SAFAR_COMPANY_ID: number`. New `user` columns `role`, `currentCompany`, `nik` (fullName handled elsewhere — see Task 2; name column already exists).

- [ ] **Step 1: Add env vars to `src/env.js`**

```ts
server: {
  JUBELIO_HOST: z.string().url(),
  SAFAR_COMPANY_ID: z.coerce.number().default(59325),
}
```
Add both to `runtimeEnv` map.

- [ ] **Step 2: Update `.env.example`** — add `JUBELIO_HOST="https://api2.jubelio.com"` and `SAFAR_COMPANY_ID=59325` with comment (no secrets).

- [ ] **Step 3: Extend Drizzle `user` table in `src/server/db/schema.ts`**

- `role`: `pgEnum("user_role", ["STAFF", "OWNER"])`, column `.notNull().default("STAFF")`
- `currentCompany`: `integer("current_company").notNull().default(59325)`
- `nik`: `text("nik")` nullable

Export the enum. Do NOT add a `password` column.

- [ ] **Step 4: Generate migration**

Run: `yarn db:generate`
Expected: new SQL file in `drizzle/` with `ALTER TABLE "user" ADD COLUMN` for the three columns. **Do not run `db:migrate`/`db:push`** — human applies.

- [ ] **Step 5: Type-check**

Run: `yarn tsc --noEmit` (or `npx tsc --noEmit`)
Expected: passes with the new schema fields.

- [ ] **Step 6: Commit**

```bash
git add src/env.js .env.example src/server/db/schema.ts drizzle/
git commit -m "feat(auth): add jubelio env vars and user role/company schema"
```

---

### Task 2: Better Auth config — JWT-oriented session + type augmentation

**Files:**
- Modify: `src/server/better-auth/config.ts`
- Modify: `src/server/better-auth/client.ts` (if Session type needs client-side augmentation)
- Create: `src/lib/jubelio-path.ts` (constants: LOGIN_PATH, hosts)

**Interfaces:**
- Consumes: `env.JUBELIO_HOST`, `env.SAFAR_COMPANY_ID` (Task 1)
- Produces: `auth` with `session.cookieCache` enabled (stateless-ish), `session.expiresIn` = 2h (7200s), type-augmented SessionUser. Exports `JUBELIO_LOGIN_PATH = "/login"`.

- [ ] **Step 1: Create `src/lib/jubelio-path.ts`**

```ts
export const JUBELIO_PATH = {
  LOGIN: "/login",
  USER_PROFILE: "/verify",
};
```
(No env import needed here; callers use `env.JUBELIO_HOST`.)

- [ ] **Step 2: Modify `src/server/better-auth/config.ts`**

- Add `session: { expiresIn: 7200, cookieCache: { enabled: true, strategy: "jwt", maxAge: 3600 } }` (JWT cookie so DB-less reads work; 2h session TTL matches reference).
- Add `session.extraFields` / `user.extraFields` to store `currentCompany`, `role`, `nik` as typed fields (follow Better Auth `additionalFields` option; exact key per installed v1.7 API).
- Keep `emailAndPassword` disabled (comment or remove) — Jubelio is source of truth; no local password check.
- Remove GitHub social provider from active flows (comment out; keep config minimal). Remove `redirectURI` references.

- [ ] **Step 3: Type-check**

Run: `yarn tsc --noEmit`
Expected: passes. Session user type includes new fields.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jubelio-path.ts src/server/better-auth/config.ts src/server/better-auth/client.ts
git commit -m "feat(auth): enable jwt session cache, augment session user fields"
```

---

### Task 3: Jubelio login route (server)

**Files:**
- Create: `src/app/api/auth/jubelio-login/route.ts` (route handler: POST)

**Interfaces:**
- Consumes: `JUBELIO_LOGIN_PATH`, `env.JUBELIO_HOST`, `env.SAFAR_COMPANY_ID`; `db` from `~/server/db`.
- Produces: 
  - `POST /api/auth/jubelio-login` body `{ email, password }`
  - 200 `{ ok: true, user: SessionUser }` on success (sets auth cookie via Better Auth)
  - 401 `{ ok: false, error: string }` on bad creds / company mismatch
  - 200 with cookie + session on DB-down degraded login

- [ ] **Step 1: Write the failing test**

Test a pure helper `authenticateWithJubelio(email, password)` (in `src/lib/jubelio-login.ts`) — unit-testable without HTTP:

```ts
// src/server/api/routers/__tests__/jubelio-login.test.ts
import { authenticateWithJubelio } from "@/lib/jubelio-login";

it("returns token + user on valid creds", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: "abc", fullName: "A", userName: "a@b.c", currentCompany: 59325, nik: null }),
  });
  const res = await authenticateWithJubelio("a@b.c", "pw");
  expect(res).toMatchObject({ token: "abc", email: "a@b.c", currentCompany: 59325 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/server/api/routers/__tests__/jubelio-login.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `authenticateWithJubelio(email, password)` in `src/lib/jubelio-login.ts`**

```ts
const LoginResponse = z.object({
  token: z.string(),
  fullName: z.string(),
  userName: z.string(),
  currentCompany: z.number(),
  nik: z.string().nullish(),
});

export async function authenticateWithJubelio(email: string, password: string) {
  const res = await fetch(`${env.JUBELIO_HOST}${JUBELIO_LOGIN_PATH}`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    let message = "Jubelio authentication failed";
    try { const d = await res.json() as {message?: string; code?: string}; message = d.code ?? d.message ?? message; } catch {}
    throw new Error(message);
  }
  const parsed = LoginResponse.parse(await res.json());
  if (parsed.currentCompany !== env.SAFAR_COMPANY_ID) throw new Error("Company tidak valid");
  return { token: parsed.token, fullName: parsed.fullName, email: parsed.userName, currentCompany: parsed.currentCompany, nik: parsed.nik ?? null };
}
```
(Move error mapping into this helper; route/action calls it.)

- [ ] **Step 4: Run test to verify it passes**

Run: same vitest command
Expected: PASS.

- [ ] **Step 5: Implement route handler `POST /api/auth/jubelio-login`**

Flow: validate body (zod `{email, password}`) → `authenticateWithJubelio` → best-effort upsert local user (`db.user.upsert` keyed by email; preserve existing role; on DB error swallow + log) → create Better Auth session with augmented fields via `auth.api.signInEmail` **or** custom session creation (builder verifies exact server-side API for v1.7) — the session must carry `token`, `currentCompany`, `role`, `fullName`. Set the auth cookie. Return `{ ok: true, user }` or `{ ok: false, error }` with proper status.

- [ ] **Step 6: Run next build / lint**

Run: `yarn lint && yarn build`
Expected: compile + lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/jubelio-login.ts src/app/api/auth/jubelio-login/route.ts src/server/api/routers/__tests__/jubelio-login.test.ts
git commit -m "feat(auth): add jubelio login route with local user upsert"
```

---

### Task 4: `auth-form` client component + login page

**Files:**
- Create: `src/app/auth/login/page.tsx` (server component)
- Create: `src/components/auth-form.tsx` (client component)

**Interfaces:**
- Consumes: `POST /api/auth/jubelio-login` (body `{email,password}`, returns `{ok, error?, user?}`)
- Produces: on success `router.push("/login/success")`; on failure inline error text; submit button `isLoading` while in flight.

- [ ] **Step 1: Create `src/components/auth-form.tsx`**

- Client component `"use client"`.
- shadcn `Input`, `Label`, `Button`.
- Fields: email/username input, password input with visibility toggle (remixicon `ri-eye-line` / `ri-eye-off-line`), submit `Button`.
- On submit: `fetch("/api/auth/jubelio-login", {method:"POST", body: JSON.stringify({email,password})})`.
  - `res.ok` → `router.push("/login/success")`.
  - else → read `error`, show inline destructive `<p>`; if error includes "Company tidak valid" show that copy verbatim; else "Username atau Password salah!".
- `Button` `isLoading` prop set during fetch; inputs disabled meanwhile.
- Mobile-first classes: `w-full`, `space-y-4`, min-tap targets via radius/px.

- [ ] **Step 2: Create `src/app/auth/login/page.tsx`**

- Server component, no auth check (public).
- Mobile-first centered layout: `min-h-[100dvh]`, container flex column, brand header ("Saeful Askar" + tagline "Masuk menggunakan akun Jubelio kamu!"), `<AuthForm />` inside a shadcn `Card`.
- Add to `matcher`/public routes: `/auth/login` must not be guarded (Task 6 owns the guard; this task just ensures no redirect-infinite-loop by leaving it public).

- [ ] **Step 3: Type-check + lint**

Run: `yarn tsc --noEmit && yarn lint`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/auth-form.tsx src/app/auth/login/page.tsx
git commit -m "feat(auth): add mobile login page and form"
```

---

### Task 5: Dummy success page + sign-out

**Files:**
- Create: `src/app/login/success/page.tsx` (server component)
- Modify: `src/app/layout.tsx` (if needed for metadata title)

**Interfaces:**
- Consumes: `getSession()` from `src/server/better-auth/server.ts`
- Produces: renders when session exists; sign-out uses Better Auth sign-out endpoint.

- [ ] **Step 1: Write a server component `src/app/login/success/page.tsx`**

- Calls `getSession()`.
- No session → `redirect("/auth/login")`.
- Rend a shadcn `Card`: "Login Berhasil", greeting with `session.user.name` / `fullName`, and a sign-out `Button`/form that POSTs to Better Auth sign-out (`/api/auth/sign-out`) then redirects to `/auth/login`.

- [ ] **Step 2: Verify build**

Run: `yarn tsc --noEmit && yarn build`
Expected: passes; route resolves.

- [ ] **Step 3: Commit**

```bash
git add src/app/login/success/page.tsx
git commit -m "feat(auth): add login success dummy page with sign-out"
```

---

### Task 6: Auth guard

**Files:**
- Create: `src/middleware.ts` (or `src/app/(protected)/layout.tsx` server-side check, matching an existing routing convention)

**Interfaces:**
- Consumes: `getSession()` (server) or Better Auth session cookie check (middleware).
- Produces: unauthenticated → `redirect("/auth/login")`; keeps `/api/*`, `/auth/*`, static assets public.

- [ ] **Step 1: Implement guard**

- Middleware matcher excludes: `/api/*`, `/auth/*`, `_next/*`, static, favicon.
- Logic: no session → `NextResponse.redirect(new URL("/auth/login", request.url))`.
- If middleware can't read Better Auth JWT cookie reliably, use a root `layout.tsx` server-side check (Better Auth `getSession`) instead — builder picks the working option, following repo conventions.

- [ ] **Step 2: Manual smoke test**

Run: `yarn dev`, visit `/` logged-out → redirected to `/auth/login`; visit `/auth/login` → renders form; after login → `/login/success` shows name; sign-out → back at login.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(auth): guard pages behind session, redirect to login"
```

---

### Task 7: Final verification

**Files:**
- None (verification only) — or fixes in any above file.

- [ ] **Step 1: Full test + lint + build**

Run: `yarn vitest && yarn lint && yarn build`
Expected: all green.

- [ ] **Step 2: Manual E2E (dev)**

- Valid Jubelio creds → success page.
- Invalid creds → error inline.
- Wrong company → "Company tidak valid".
- Logged-out `/` → login.
- Mobile 375px viewport: no horizontal scroll, tappable inputs.
- DB down (stop DB) → login still works if Jubelio reachable (degraded, no upsert) — verify no hard-block.

- [ ] **Step 3: Confirm migration file exists and is additive**

Run: `git status` — expect `drizzle/*.sql` staged/untracked with only the three `ADD COLUMN` statements. Do not apply.

