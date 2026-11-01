# FlashStudio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FlashStudio — B2B flash-sale platform: admin runs time-limited sessions with Jubelio-sourced products; customers checkout via bank transfer + WhatsApp proof; admin confirms → paid Jubelio SO; daily cron syncs shipped/completed status.

**Architecture:** Next.js 15 App Router + Drizzle (Postgres) + better-auth. Two auth paths: admin (existing Jubelio email/password login, already built) and customer (Google OAuth + local `contacts` row). API routes in `src/app/api/**`; page routes in `src/app/**`. Business logic (booking IDs, conflict checks, oversell guard) lives in pure modules under `src/lib/` and `src/server/` so vitest can test them without a live Jubelio — the API routes stay thin.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, postgres, better-auth, vitest, shadcn/ui, Tailwind, Zod, sonner.

**Spec:** `docs/superpowers/specs/2026-10-23-flashstudio-design.md`

---

## Global Constraints

| # | Rule |
|---|---|
| G1 | Customer auth: Google OAuth → on first login, app checks `contact_id` for the Google email; missing → onboarding form → `POST /core-api/contacts/` |
| G2 | Roles: exactly two — Jubelio email/password login (`/api/auth/jubelio-login`) → OWNER (forced); Google OAuth → CUSTOMER. Reuse, do not rebuild |
| G3 | Jubelio API base `https://open.jubelio.com/core-api/`; server-side only; no static token — user routes use the login token, system routes log in with `JUBELIO_SYSTEM_EMAIL`/`JUBELIO_SYSTEM_PASSWORD`; user-route 401 → sign out |
| G4 | One active session at a time; PAUSED blocks creation of any new session (must END first); date overlap with SCHEDULED/ACTIVE rejected |
| G5 | Booking ID `FS-{YYYYMMDD}-{SEQ4}` (per-day sequence, e.g. `FS-20261023-0001`) |
| G6 | WhatsApp template (encoded into `wa.me/` URL): `Halo, saya sudah transfer untuk pesanan {booking_id} sejumlah Rp{grand_total} ke rekening {bank_name} {account_number} atas nama {account_name}. Bukti transfer terlampir.` |
| G7 | Booking flow: local order status `UNPAID` (no Jubelio SO yet) → admin confirms → Jubelio SO `is_paid: true` → local `CONFIRMED` → daily sync → `SHIPPED` → `Completed` |
| G8 | Oversell guard at checkout: check stored `session_products.jubelio_stock` (no live fetch — customers hold no Jubelio account); block if `jubelio_stock < requestedQty` ("Stock tidak mencukupi") or `claimed + qty > session_quota` ("Quota exceeded") |
| G9 | Transfer proof: local file storage `/public/uploads`, JPEG/PNG, 5MB max; URL stored in `orders.transfer_proof_url` |
| G10 | JSON casing: API JSON uses **camelCase** (`sessionQuota`, `jubelioContactId`, `bookingId`); Drizzle columns snake_case |
| G11 | Status enums — session: `SCHEDULED|ACTIVE|PAUSED|ENDED`; order: `UNPAID|CONFIRMED|SHIPPED|COMPLETED` |
| G12 | Migrations: run `pnpm db:generate` only — a human runs `db:migrate` / `db:push` |
| G13 | UI: reuse `src/components/ui/*` (shadcn base); every API-triggered button sets `isLoading`; success/failure → `sonner` toast; list pages use `flex-1 space-y-6 p-4 md:p-6` |
| G14 | No payment countdown — stock claimed at CO via `claimed += qty`, released only on admin cancel |

---

## Review Focus

Inputs the spec implies but never tests — each maps to a task-owned test:

1. **Oversell at quota, not stock**: many customers each below `minOrder` stock could exceed `session_quota`. Guard must check both stock AND quota (spec §4.4 step 2+3). → Task 6.
2. **Session overlap boundary**: `[10:00, 11:00]` vs `[11:00, 12:00]` — shared instant is NOT an overlap; `[10:30, 11:30]` IS. → Task 3.
3. **PAUSED is "in use"**: activating any session while one is PAUSED must fail even when dates don't overlap. → Task 3.
4. **Jubelio SO create failure after confirm**: local stays `CONFIRMED`, surfaces for retry, never silently reverts to UNPAID. → Task 9.
5. **Booking sequence collision**: two checkouts in the same second must not yield the same `booking_id`. Per-day sequence from `created_at` count read inside a transaction. → Task 2.
6. **Zero-stock product card**: a product with `jubelio_stock` 0 must render sold-out, not crash and not addable. → Task 5.

---

## File Structure

New files, grouped by owning task:

```
drizzle/                 # 0002 migration (via db:generate, human applies)
src/server/db/schema.ts  # + related additions (flash sessions, session_products, orders, order_items, contacts)
src/lib/jubelio.ts       # Jubelio HTTP client (products, stock, contacts, sales orders)
src/server/booking-id.ts # FS-{date}-{seq} generator + day-counter query
src/server/session-rules.ts # conflict + activation rules (pure)
src/server/cart.ts       # session-agnostic cart helpers (claimed/quota math)
src/app/api/contacts/route.ts
src/app/api/jubelio/products/route.ts
src/app/api/sessions/route.ts            # GET admin all / POST create
src/app/api/sessions/[id]/route.ts       # PATCH (SCHEDULED only)
src/app/api/sessions/[id]/activate/route.ts
src/app/api/sessions/[id]/end/route.ts
src/app/api/sessions/[id]/products/route.ts # GET/POST/PUT session products
src/app/api/cart/route.ts                # GET current cart (localStorage-backed via POST? — see Task 5)
src/app/api/orders/route.ts              # POST checkout (create booking) / GET list
src/app/api/orders/[id]/confirm/route.ts
src/app/api/orders/[id]/upload-proof/route.ts
src/app/api/cron/daily-sync/route.ts
src/app/onboarding/page.tsx
src/app/orders/page.tsx
src/app/admin/page.tsx
src/app/admin/sessions/new/page.tsx
src/app/admin/sessions/[id]/edit/page.tsx
src/app/admin/sessions/[id]/products/page.tsx
src/app/admin/orders/page.tsx
src/app/_components/... (storefront cards, cart drawer, session form, product picker)
src/app/.../cart-context.tsx (client cart store)
```

---

## Task 1: Database schema

**Files:**
- Modify: `src/server/db/schema.ts`
- Migration: `pnpm db:generate` → `drizzle/0002_*.sql`

**Interfaces:** Produces Drizzle tables (snake_case columns) consumed by every later task:

```ts
contacts:       id (uuid pk) googleId text? email text unique, jubelioContactId int?,
                contactName text? primaryContact text? contactPosition text?
                phone text? sAddress text?, createdAt
flashSessions:  id (uuid pk) name text* sessionName*, startTime, endTime (tz timestamps),
                status enum SessionStatus (SCHEDULED|ACTIVE|PAUSED|ENDED), createdAt
sessionProducts:id (uuid pk) sessionId fk, itemId int, skuCode text, itemGroupName text,
                jubelioStock int default 0, originalPrice int, sessionQuota int,
                claimed int default 0, minOrder int default 1, flashPrice int, category text,
                unique(sessionId, itemId)
orders:         id (uuid pk) bookingId text unique, customerId fk→user.id, sessionId fk,
                status enum OrderStatus (UNPAID|CONFIRMED|SHIPPED|COMPLETED),
                grandTotal money-int, paymentMethod text, transferProofUrl text,
                jubelioSoId int? contactId int? createdAt, updatedAt
orderItems:     id (uuid pk) orderId fk, sessionProductId fk, itemId int, sku text,
                itemName text, qty int, price int, subtotal int
```

Money as integer rupiah. Index: `orders(bookingId)` unique, `orders(customerId)`, `sessionProducts(sessionId)`.

- [ ] **Step 1:** Add the five tables + enums in `src/server/db/schema.ts`, matching existing `createTable` / `pgEnum` style used for `user`/`session`.
- [ ] **Step 2:** Run `pnpm db:generate`, confirm `drizzle/0002_*.sql` created. Do NOT migrate — tell the human to run `pnpm db:migrate`.
- [ ] **Step 3:** Typecheck: `pnpm typecheck` passes. Commit: `feat(db): add flash sale schema`.

---

## Task 2: Jubelio client + booking ID

**Files:**
- Create: `src/lib/jubelio.ts`
- Create: `src/server/booking-id.ts`
- Test: `tests/booking-id.test.ts`

**Interfaces:**
- Consumes: `env.JUBELIO_SYSTEM_EMAIL`, `env.JUBELIO_SYSTEM_PASSWORD`, `env.JUBELIO_LOCATION_ID`, `env.JUBELIO_BASE_URL` (add to `src/env.js`)
- Produces:
  - `createJubelioClient(token)` factory — `listProducts(search?)`, `listStock()`, `getStockBySku(sku)`, `createContact(payload)`, `createSalesOrder(payload)`, `listSalesOrders()`, `listInvoices()`; each throws `JubelioError(status, code, message)`. Callers supply the token; system routes retry once on 401 via `withSystemClient` (`src/server/jubelio-token.ts`)
  - `nextBookingId(db, date)` → `FS-{YYYYMMDD}-{seq4}` where `seq = count of orders created that date + 1`

- [ ] **Step 1:** Write failing test `tests/booking-id.test.ts` — with `db.create` returning 2 orders dated today, `nextBookingId` returns `FS-{today}-0003`; with zero orders → `-0001`.
- [ ] **Step 2:** Run `pnpm vitest run tests/booking-id.test.ts` — fails (module missing).
- [ ] **Step 3:** Implement `nextBookingId` — one `SELECT count(*)` on `orders` where `createdAt >= startOfDay` inside a transaction (Task 10 reuses the counter).
- [ ] **Step 4:** Run test — passes.
- [ ] **Step 5:** Implement `src/lib/jubelio.ts` as a token-injected factory `createJubelioClient(token)`. Base URL from spec §6: `https://open.jubelio.com/core-api/`; header `Authorization: Bearer ${token}`. Fetch helpers for the five endpoints. **Do not hand-roll JSON destructuring** — endpoints return arrays; consume raw and let route handlers shape them (spec: docs unreliable, test per endpoint).
- [ ] **Step 6:** Add `JUBELIO_SYSTEM_EMAIL`, `JUBELIO_SYSTEM_PASSWORD`, `JUBELIO_LOCATION_ID`, `JUBELIO_BASE_URL`, `WHATSAPP_NUMBER`, `BANK_ACCOUNTS`, `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` to `src/env.js` (and `.env.example`) with Zod schemas from spec §6.
- [ ] **Step 7:** `pnpm typecheck` + test pass. Commit: `feat(lib): add jubelio client and booking id`.

---

## Task 3: Session rules + session API

**Files:**
- Create: `src/server/session-rules.ts`
- Create: `src/app/api/sessions/route.ts`, `src/app/api/sessions/[id]/route.ts`, `src/app/api/sessions/[id]/activate/route.ts`, `src/app/api/sessions/[id]/end/route.ts`
- Test: `tests/session-rules.test.ts`

**Interfaces:**
- Consumes: `flashSessions`, `sessionProducts` tables (Task 1); `getSession()` from `src/server/better-auth/server.ts`; admin check `session.user.role === "OWNER"` (existing field, present on `user`).
- Produces:
  - `hasOverlap(a: {start,end}, b: {start,end})` → boolean (`a.start < b.end && b.start < a.end`)
  - `canActivate(candidate: {start,end,id}, existing: Session[])` → `{ ok: boolean; reason?: "OVERLAP" | "PAUSED_BLOCK" }` — rejects if any existing (`id !== candidate.id`) session is PAUSED, or any SCHEDULED/ACTIVE overlaps.

- [ ] **Step 1:** Write failing tests `tests/session-rules.test.ts`:
  - boundary `[10:00,11:00]` vs `[11:00,12:00]` → no overlap (shared instant)
  - `[10:30,11:30]` inside `[10:00,12:00]` → overlap
  - candidate vs PAUSED existing (even non-overlapping dates) → `PAUSED_BLOCK`
  - candidate vs ACTIVE with overlap → `OVERLAP`
- [ ] **Step 2:** Run — fails (file missing).
- [ ] **Step 3:** Implement `session-rules.ts` (two pure functions).
- [ ] **Step 4:** Run — passes.
- [ ] **Step 5:** Implement the four route handlers:
  - `POST /api/sessions`: validate body (name, startTime, endTime, status default SCHEDULED); reject if another PAUSED exists (G4); reject on date overlap vs SCHEDULED/ACTIVE (spec §4.2). Wrap count+insert in a transaction.
  - `GET /api/sessions`: admin → all; public → only ACTIVE.
  - `PATCH /api/sessions/[id]`: only SCHEDULED allowed (spec §5.9 config frozen after ACTIVE); fields editable = name/start/end.
  - `POST .../activate`: runs `canActivate`, sets ACTIVE on ok.
  - `POST .../end`: sets ENDED (terminal, no confirm dialog — spec §4.2).
  - Guard every route: `getSession()` → 401 if unauthenticated for mutations; `role !== "OWNER"` → 403.
- [ ] **Step 6:** `pnpm typecheck`. Manual curl smoke test against dev server with a temp JWT is optional. Commit: `feat(api): session CRUD with conflict rules`.

---

## Task 4: Session products API

**Files:**
- Create: `src/app/api/sessions/[id]/products/route.ts`
- Create: `src/app/api/jubelio/products/route.ts`

**Interfaces:**
- Consumes: `jubelioClient.listProducts()` + `.listStock()` (Task 2); `flashSessions`, `sessionProducts` (Task 1).
- Produces:
  - `GET /api/jubelio/products?search=` → `[{ itemId, skuCode, itemGroupName, price }]` (live from Jubelio masters)
  - `GET /api/sessions/[id]/products` → session products joined with current `jubelioStock` (live lookup per product)
  - `POST /api/sessions/[id]/products` body `[{ itemId, skuCode, itemGroupName, originalPrice, sessionQuota, minOrder, flashPrice, category }]` → upsert rows (unique `(sessionId, itemId)`); `sessionQuota` default `min(20, liveStock)` (spec §5.3 default), `flashPrice` default `originalPrice`, `minOrder` default from Jubelio min (fallback 1)
  - `PUT /api/sessions/[id]/products/:itemId` → admin override of quota/min/flash/category (route pattern: `[id]/products/[itemId]/route.ts`)

- [ ] **Step 1:** Implement `src/app/api/jubelio/products/route.ts` — live proxy, shape per above.
- [ ] **Step 2:** Implement `POST` on `sessions/[id]/products` — for each item, fetch live stock, apply defaults (quota `min(20, stock)`), insert on conflict update. Only SCHEDULED/ACTIVE sessions accept changes (ACTIVE = quota/category editable? NO — spec §5.9: no fields editable once ACTIVE; only SCHEDULED may mutate products).
- [ ] **Step 3:** Implement `GET` + `PUT` on the same route.
- [ ] **Step 4:** `pnpm typecheck` + `git commit`: `feat(api): session product picker and listing`.

---

## Task 5: Customer cart (client) + storefront catalog

**Files:**
- Create: `src/app/_components/cart-context.tsx`
- Create: `src/app/_components/product-card.tsx`
- Create: `src/app/_components/category-pills.tsx`
- Create: `src/app/_components/countdown-timer.tsx`
- Modify: `src/app/page.tsx` (storefront)
- Modify: `src/app/layout.tsx` (wrap `CartProvider`)

**Interfaces:** Consumes `GET /api/sessions` (public active), `GET /api/sessions/[id]/products` (joined stock). Produces `CartProvider` exposing `{ items: CartItem[], add(itemId, qty), increment, decrement, remove, clear, subtotal, count }`; `CartItem = { sessionProductId, itemId, name, sku, price, minOrder, qty }`.

**Cart storage decision:** cart is client-side `localStorage` keyed `fs-cart` (no server round-trip per keystroke — snappy, spec perf rule). Checkout (Task 6) sends the cart snapshot; server enforces MOQ and quota at that point.

- [ ] **Step 1:** Build `cart-context.tsx` — localStorage-backed, wraps reads/writes in try/catch (private-mode safe), `useMemo` subtotal/count.
- [ ] **Step 2:** Wire `CartProvider` into `src/app/layout.tsx`.
- [ ] **Step 3:** Modify `src/app/page.tsx` — active session hero (name + countdown via `countdown-timer.tsx` ticking to `endTime`), category pills from distinct `category` values, "All" always first (spec §5.10), grid of `product-card.tsx`.
- [ ] **Step 4:** `product-card.tsx` — shows item image (Jubelio thumbnail if available, else placeholder), flashPrice + struck-through originalPrice (spec §5.13), quota bar `claimed / sessionQuota`, sold-out overlay when `claimed >= sessionQuota` (spec §4.4).
- [ ] **Step 5:** Quick-add at MOQ; category filter client-side; mobile bottom bar (cart subtotal + "View Cart (n)") fixed, hidden when empty (spec §5.11).
- [ ] **Step 6:** `pnpm typecheck` + `pnpm lint`. Commit: `feat(storefront): live catalog with cart`.

---

## Task 6: Checkout API (booking creation)

**Files:**
- Create: `src/app/api/orders/route.ts` (POST = checkout, GET = list)
- Test: `tests/checkout-guard.test.ts`
- Modify: `src/app/page.tsx` (checkout drawer/modal → POST /api/orders, bank list + WhatsApp button)

**Interfaces:**
- Consumes: `nextBookingId` (Task 2), tables (Task 1), `getSession()`.
- Produces: `POST /api/orders` body `{ sessionId, items: [{ sessionProductId, qty }] }` → checks (order matters, spec §4.4):
  1. session is ACTIVE (else 409 "Sesi telah berakhir")
  2. per item: stored `jubelioStock >= qty` else 409 `{ error: "Stock tidak mencukupi", itemId }` (no live Jubelio call)
  3. per item: `claimed + qty <= sessionQuota` else 409 `{ error: "Quota exceeded", itemId }`
  4. `qty >= minOrder` else 400
  5. on pass: transaction — `claimed += qty` on each sessionProduct, insert `orders` (status UNPAID, grandTotal = Σ qty×flashPrice) + `orderItems`, `bookingId = nextBookingId()`
  6. respond `{ bookingId, grandTotal, bankAccounts: BANK_ACCOUNTS, waLink }` where `waLink = wa.me/{WHATSAPP_NUMBER}?text=<encodeURIComponent(template)>` (template G6)

- [ ] **Step 1:** Write failing test `tests/checkout-guard.test.ts` — a product with `jubelioStock: 5` (fed via `EvaluateCheckoutDeps`); assert: qty 6 → `Stock tidak mencukupi`; quota 4 + qty 5 + claimed 0 → `Quota exceeded`; qty 2 vs minOrder 3 → 400; happy path → booking `FS-...-0001` and `claimed` incremented. (Extract the guard into a pure function `evaluateCheckout(deps, cart)` in `src/server/checkout.ts` so it's testable without HTTP or Jubelio.)
- [ ] **Step 2:** Run — fails (module missing).
- [ ] **Step 3:** Implement `src/server/checkout.ts` (`evaluateCheckout`) + route handler wrapping it (auth → db → jubelio → transaction).
- [ ] **Step 4:** Run test — passes.
- [ ] **Step 5:** Checkout UI: cart drawer — review items, "Checkout" button (`isLoading`), on success show bank account list (from `BANK_ACCOUNTS`), total, and a "Kirim Bukti Transfer" button linking `waLink` (opens WhatsApp with prefilled text, spec §4.5 Phase 1). Empty-state + error toasts.
- [ ] **Step 6:** Commit: `feat(checkout): booking creation with oversell guard`.

---

## Task 7: Customer order history + upload proof

**Files:**
- Create: `src/app/api/orders/[id]/upload-proof/route.ts`
- Create: `src/app/orders/page.tsx`
- Test: `tests/upload-proof.test.ts`

**Interfaces:**
- Consumes: `evaluateCheckout` result shape; tables.
- Produces: `POST /api/orders/[id]/upload-proof` — multipart; validates mime `image/jpeg|image/png`, size ≤ 5MB; writes to `public/uploads` with randomized name; updates `orders.transferProofUrl`; returns URL.

- [ ] **Step 1:** Write test for the validator (pure fn `validateProof(file: { size, type })` in `src/server/upload.ts`): 6MB png rejected, `application/pdf` rejected, 3MB jpeg accepted.
- [ ] **Step 2:** Run — fails. Implement `src/server/upload.ts`.
- [ ] **Step 3:** Run — passes.
- [ ] **Step 4:** Implement upload route + `src/app/orders/page.tsx` — guarded by `getSession()`, lists own orders via `GET /api/orders?customer=me` (status UNPAID/CONFIRMED/SHIPPED/COMPLETED; spec §4.1 D — session filter optional, skip for v1). Each UNPAID row: bank options + WhatsApp button + "Upload Bukti Transfer" file input (`isLoading` during upload; toast on done).
- [ ] **Step 5:** `pnpm typecheck`. Commit: `feat(orders): order history and proof upload`.

---

## Task 8: New customer onboarding

**Files:**
- Create: `src/app/api/contacts/route.ts`
- Create: `src/app/onboarding/page.tsx`
- Modify: Google OAuth callback flow (in `src/server/better-auth/config.ts`) to check `contacts.email` after sign-in

**Interfaces:**
- Consumes: `jubelioClient.createContact`, `user` + `contacts` tables, `getSession()`.
- Produces: `POST /api/contacts` body = the 5 fields (G1): `{ contactName, primaryContact, contactPosition, phone, sAddress }`, authed; calls Jubelio `POST /core-api/contacts/` with spec §4.1 payload (`contact_type: 0`, `is_reseller: true`), stores `jubelioContactId` + fields on `contacts` row keyed by authenticated user email.

- [ ] **Step 1:** Add Google OAuth to better-auth config: `socialProviders.google` (env `GOOGLE_CLIENT_ID/SECRET` — add to `src/env.js`), with `database` already wired. Set customer default role: add `customer` claim on sign-up.
- [ ] **Step 2:** Implement `POST /api/contacts` — on success redirect customer to storefront; on failure return parser error copy.
- [ ] **Step 3:** Build `src/app/onboarding/page.tsx` — form (Nama toko/perusahaan, Nama PIC, Jabatan dropdown pemilik/procurement, No. Telf, Alamat lengkap; G13: isLoading + toasts); POSTs `/api/contacts`.
- [ ] **Step 4:** Gate: after Google login, if no `contacts` row for email → redirect `/onboarding`; else `/`. Implement in middleware or layout-level check (match existing auth-guard pattern in `src/app/layout.tsx`).
- [ ] **Step 5:** `pnpm typecheck`. Commit: `feat(auth): google onboarding with jubelio contact`.

---

## Task 9: Admin order confirmation → Jubelio SO

**Files:**
- Create: `src/app/api/orders/[id]/confirm/route.ts`
- Create: `src/app/admin/orders/page.tsx`
- Test: `tests/confirm-order.test.ts`

**Interfaces:**
- Consumes: `jubelioClient.createSalesOrder`, `jubelioClient.listSalesOrders`, tables, `getSession()`.
- Produces: `POST /api/orders/[id]/confirm` — admin-only; loads order + items; SO payload per spec §4.5 (`salesorder_id: 0`, `contact_id` from order/contacts, `location_id: env.JUBELIO_LOCATION_ID`, `source: 1`, `is_paid: true`, `payment_method: "transfer"`, items mapped to `{ item_id, qty, price }` shape, `sub_total`/`grand_total` from order); on success set `orders.status = CONFIRMED`, `orders.jubelioSoId = result.salesorder_id`; on failure keep `CONFIRMED`-pending, store nothing, return 502 with retry flag.

- [ ] **Step 1:** Write failing test — mock `createSalesOrder` resolving `{ salesorder_id: 99123 }`; assert local status → CONFIRMED and `jubelioSoId = 99123`; mock rejection → status stays UNPAID-CONFIRMED boundary (spec §5.8: local stays CONFIRMED, retry allowed). Implementation of the transition as pure fn `markConfirmed(order, soResult)`.
- [ ] **Step 2:** Run — fails. Implement transition helper + route.
- [ ] **Step 3:** Run — passes.
- [ ] **Step 4:** Build `src/app/admin/orders/page.tsx` — admin guard; table of UNPAID bookings (`bookingId`, grandTotal, screenshot `transferProofUrl` thumbnail, WhatsApp number link, "Konfirmasi Bayar" button with isLoading + confirm dialog, toast success/failure).
- [ ] **Step 5:** Commit: `feat(admin): confirm payment creates jubelio sales order`.

---

## Task 10: Daily sync cron

> **Reworked 2026-10-29 — this task as written shipped a permanent no-op.** The
> list it planned to sweep (`listSalesOrders`) returns page 1 of 184 072 rows
> sorted oldest-first and rejects `page_size`/`sort`/`order`, so it never contains
> our orders; the `Ready to Ship` / `Shipped` / `Completed` labels it maps are not
> the field's vocabulary. What runs now reads each SO by id
> (`getSalesOrder(jubelioSoId)`), maps `internal_status` (`PAID → CONFIRMED`,
> `SHIPPED → SHIPPED`, `COMPLETED → COMPLETED`, forward-only, anything else left
> alone), backfills `tracking_number`/`shipper`, and is throttled by
> `ORDER_SYNC_INTERVAL_MS` on top of the cron. See `docs/PRD.md` §4.2-§4.3 and
> `src/server/order-sync.ts`.

**Files:**
- Create: `src/app/api/cron/daily-sync/route.ts`
- Test: `tests/daily-sync.test.ts`

**Interfaces:**
- Consumes: `jubelioClient.listSalesOrders`, `jubelioClient.listInvoices`, tables.
- Produces: `POST /api/cron/daily-sync` — guard: `x-cron-secret` header === `env.CRON_SECRET` else 401. For each local order with `jubelioSoId` set, look up matching SO in fetched list; map status (spec §4.6): `Ready to Ship` → CONFIRMED (no-op if already), `Shipped` → SHIPPED, `Completed` → COMPLETED. Update changed rows. Return `{ ok, synced, skipped }` JSON.

- [ ] **Step 1:** Write failing test — stub `listSalesOrders` returning 2 SOs (one `Shipped`, one `Completed`), have a local order for each; assert statuses updated; unlisted `jubelioSoId` left untouched.
- [ ] **Step 2:** Run — fails. Implement route (status mapping helper).
- [ ] **Step 3:** Run — passes.
- [ ] **Step 4:** Wire scheduling — add `vercel.json` with cron `0 0 * * *` (spec §5.5: midnight UTC). No-Vercel fallback: document `node-cron` in a comment; route remains callable/testable.
- [ ] **Step 5:** Commit: `feat(cron): daily order status sync`.

---

## Task 11: Admin session pages (portal)

**Files:**
- Create: `src/app/admin/page.tsx` — sessions list
- Create: `src/app/admin/sessions/new/page.tsx`
- Create: `src/app/admin/sessions/[id]/edit/page.tsx`
- Create: `src/app/admin/sessions/[id]/products/page.tsx`
- Create: `src/app/_components/session-form.tsx`, `src/app/_components/product-picker.tsx`
- Modify: `src/app/admin/layout.tsx` (admin guard + nav)

**Interfaces:** Consumes session routes (Task 3), product routes (Task 4). Produces UI for all admin session actions.

- [ ] **Step 1:** `admin/layout.tsx` — `getSession()` redirect to `/auth/login` if not OWNER; simple nav (Sessions / Orders).
- [ ] **Step 2:** `admin/page.tsx` — list all sessions (status badges, date range), actions: ACTIVATE/PAUSE/END/Edit (SCHEDULED only), "New Session" → `/admin/sessions/new`. PAUSED sessions show lock note: "End the current session to create a new one."
- [ ] **Step 3:** `session-form.tsx` + new/edit pages — name, start/end datetime-local; submit → POST/PATCH; validate overlap error from API shown in toast.
- [ ] **Step 4:** `product-picker.tsx` + `products/page.tsx` — live search via `/api/jubelio/products?search=`, multi-select add, per-product form (sessionQuota default `min(20,stock)`, minOrder, flashPrice, category); edit/remove rows; GET listing to prefill. (Spec §4.3.)
- [ ] **Step 5:** Wire all buttons with `isLoading` + toasts (G13). `pnpm typecheck`. Commit: `feat(admin): session management pages`.

---

## Self-Review Notes

- **Spec coverage:** every spec §4.x maps to a task: 4.1 onboarding → 8; 4.2 sessions → 3+11; 4.3 products → 4; 4.4 storefront → 5+6; 4.5 payment → 6+7(+9); 4.6 cron → 10. Non-goals (payment gateway, webhooks, multi-warehouse, guest checkout) untouched.
- **Type consistency:** `bookingId`, `sessionQuota`, `minOrder`, `flashPrice`, `jubelioSoId`, `transferProofUrl` spelled identically across tasks (G10/G12).
- **Review Focus lines:** each pinned test lives in its owning task (1→6, 2→3, 3→3, 4→9, 5→2, 6→5).
- **Proportion:** plan is a decision ledger, not a transcript — route bodies left to implementer where the signature + spec determine them.
