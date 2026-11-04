# Session Flexibility & Feedback Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock product-config editing while a flash-sale session is live (hide-not-delete, quota floors, single-Save roster), make every error Bahasa and actionable, finalize the customer "Selesai" vocabulary, and rebrand the app to Flash Sale Grosir.

**Architecture:** Session config (name/times) stays frozen after activation; only product rows unlock, with `hidden` as the mid-session removal mechanism. All decision logic lives in pure modules (`src/server/*.ts`, exported helpers in components) that vitest pins; routes and React surfaces stay thin wiring. Checkout (`evaluateCheckout`) remains the single server authority, extended with one new failure code.

**Tech Stack:** Next.js 15 (App Router), React 19, Drizzle + postgres, Zod v3, vitest 5, sonner, shadcn primitives in `src/app/_components/ui/` and `src/components/ui/`, Phosphor icons.

**Spec:** `docs/superpowers/specs/2026-11-04-session-flexibility-and-feedback-design.md`

## Global Constraints

- User-visible strings everywhere: **Bahasa Indonesia**. API error strings: Bahasa, name the problem + next action.
- Every API-triggered button: `isLoading` until resolve; success AND failure toast via sonner. Base `Button` (`src/app/_components/ui/button.tsx` → re-export of `src/components/ui/button.tsx`) handles the spinner.
- Package manager: **yarn only** (`COREPACK_ENABLE_STRICT=0 yarn run <script>`). Tests: `yarn vitest run <file>`. Gate: `yarn run check` (lint + typecheck).
- DB: only `yarn run db:generate` (creates migration SQL). **Never** `db:push`/`db:migrate` — ask the human to apply.
- New dashboard pages keep `flex-1 space-y-6 p-4 md:p-6` padding.
- Do NOT read PNGs into context. Brand assets live at `docs/assets/*.png`.
- Icon set: `@phosphor-icons/react` (codebase standard; overrides the spec's "lucide" wording — recorded as builder call).
- Commits on `main` need the per-plan human confirmation already covered by the standing rule ("ask once per plan, then commit").

---

### Task 1: Fix the dead session-delete route (prerequisite bug)

`session-actions.tsx:33` fetches `/api/sessions/{id}/delete`; no such route exists (DELETE is on `/api/sessions/[id]`), so every delete 404s into the generic toast.

**Files:**
- Modify: `src/app/_components/session-actions.tsx`
- Test: `tests/session-actions.test.ts` (create)

**Interfaces:**
- Produces: exported pure `sessionActionRequest(key: ActionKey, sessionId: string): { url: string; method: "POST" | "DELETE" }` from `session-actions.tsx`; `type ActionKey = "activate" | "pause" | "resume" | "end" | "delete"` (already exists, keep the name).

- [ ] **Step 1: Write failing test** — `tests/session-actions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sessionActionRequest } from "@/app/_components/session-actions";

describe("sessionActionRequest", () => {
  it("routes delete to the session itself, not /delete", () => {
    expect(sessionActionRequest("delete", "abc")).toEqual({
      url: "/api/sessions/abc",
      method: "DELETE",
    });
  });
  it.each(["activate", "pause", "resume", "end"] as const)(
    "routes %s to its subresource via POST",
    (key) => {
      expect(sessionActionRequest(key, "abc")).toEqual({
        url: `/api/sessions/abc/${key}`,
        method: "POST",
      });
    },
  );
});
```

- [ ] **Step 2: Run it, confirm FAIL** (`yarn vitest run tests/session-actions.test.ts` — `sessionActionRequest` not exported).
- [ ] **Step 3: Implement** `sessionActionRequest` in `session-actions.tsx` per the test, and replace the URL construction inside `run()` with it.
- [ ] **Step 4: Test PASS + gate** — `yarn vitest run tests/session-actions.test.ts && COREPACK_ENABLE_STRICT=0 yarn run check`.
- [ ] **Step 5: Commit** — `git commit -m "fix(admin): delete targeted a route that never existed" + attribution footer`.

---

### Task 2: `hidden` column on session products

**Files:**
- Modify: `src/server/db/schema.ts` (in `sessionProducts`, after `minOrder`)
- Generated: `drizzle/00xx_*.sql` + journal

**Interfaces:**
- Produces: `sessionProducts.hidden: boolean NOT NULL DEFAULT false` on every select/insert row; `SessionProduct` view types gain `hidden: boolean` (Task 4/7 consume).

- [ ] **Step 1: Add the column** — `hidden: t.boolean("hidden").default(false).notNull(),` with a one-line comment: mid-session removal hides from storefront, row kept (order-item FK).
- [ ] **Step 2: Generate** — `COREPACK_ENABLE_STRICT=0 yarn run db:generate`; verify a new SQL file adds the column with `DEFAULT false NOT NULL`.
- [ ] **Step 3: Ask the human to apply the migration** (hard stop until done — Tasks 4–7 need the column live).
- [ ] **Step 4: Gate** — `COREPACK_ENABLE_STRICT=0 yarn run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): session products can be hidden mid-session"`.

---

### Task 3: Pure edit-window rules

**Files:**
- Create: `src/server/session-products-edit.ts`
- Test: `tests/session-products-edit.test.ts` (create)

**Interfaces:**
- Consumes: nothing (pure).
- Produces (all from `@/server/session-products-edit`):
  - `canEditProducts(status: string): boolean` — true for `SCHEDULED | ACTIVE | PAUSED`, false for `ENDED`/unknown.
  - `reAddDecision(status: string, existing: unknown | undefined): "insert" | "upsert" | "unhide_only"` — existing row + ACTIVE/PAUSED → `"unhide_only"`; existing row + SCHEDULED → `"upsert"` (today's reset semantics); no existing row → `"insert"`.
  - `quotaUpdateDecision(input: { claimed: number; requestedQuota: number; liveStock: number | null | undefined }): { ok: true; jubelioStock: number | null; warnUnknownStock: boolean } | { ok: false; floor: number }` — `requestedQuota < claimed` → `{ ok:false, floor: claimed }`; ok-case sets `jubelioStock = liveStock ?? null`-means-keep: `liveStock` number → refresh to it; `liveStock` null/undefined (map miss) → keep prior snapshot semantics handled by the caller via `warnUnknownStock: true` and `jubelioStock: null` (null = "don't overwrite").

- [ ] **Step 1: Write failing tests** covering: ENDED frozen; SCHEDULED/ACTIVE/PAUSED editable; the three `reAddDecision` branches; `quotaUpdateDecision` floor reject names `claimed` as floor; live number refreshes; miss warns and returns `jubelioStock: null`.
- [ ] **Step 2: FAIL → implement the module → PASS.**
- [ ] **Step 3: Gate + commit** — `git commit -m "feat(server): product edit-window rules for live sessions"`.

---

### Task 4: Unlock and extend the product API routes

**Files:**
- Modify: `src/app/api/sessions/[id]/products/route.ts` (POST guard ~119, re-add branch ~175-193, GET payload ~66-78)
- Modify: `src/app/api/sessions/[id]/products/[itemId]/route.ts` (PUT guard ~138, DELETE guard ~199, `UpdateProduct` schema ~20-40)
- Test: `tests/session-products-post.test.ts` (extend only if it exercises shared pure logic — route wiring itself is verified by Task 3's tests + gate)

**Interfaces:**
- Consumes: Task 3 `canEditProducts`, `reAddDecision`, `quotaUpdateDecision`; existing `getStockMap`, `resolveImportRow`.
- Produces: PUT accepts `hidden?: boolean` in body (drives hide/show, Task 7); PUT quota response may carry `warning: "UNKNOWN_STOCK"`; GET product rows now include `hidden: boolean`; POST on an existing item during ACTIVE/PAUSED returns that row untouched except `hidden=false`.

- [ ] **Step 1: POST** — replace `session.status !== "SCHEDULED"` guard with `!canEditProducts(session.status)` + Bahasa 409 `"Sesi yang sudah berakhir tidak bisa diubah."`; when `reAddDecision(...) === "unhide_only"` skip insert/upsert/reset for that item — update `hidden=false` only and return the row (still reported in `products`; not in `skipped`). Fresh items during ACTIVE/PAUSED follow the existing insert path unchanged.
- [ ] **Step 2: PUT** — guard via `canEditProducts`; add `hidden: z.boolean().optional()` to `UpdateProduct` (and to the "at least one field" refine); when `sessionQuota` present: fetch `getStockMap` (auth-expired → 401 `SESSION_EXPIRED` as elsewhere; other failure → `liveStock = undefined`), run `quotaUpdateDecision`; `{ok:false}` → 400 Bahasa `` `Kuota minimal ${floor} (sudah terjual ${floor}).` ``; ok-case merges `sessionQuota` + `jubelioStock` (null → don't set) and attaches `warning: "UNKNOWN_STOCK"` when `warnUnknownStock`. Translate remaining English 4xx strings in this file to Bahasa.
- [ ] **Step 3: DELETE** — keep SCHEDULED-only, message becomes Bahasa (hide replaces it for live sessions).
- [ ] **Step 4: GET** — include `hidden: row.hidden` in the mapped payload.
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(api): live sessions accept product edits, quota floor, hide/show"`.

---

### Task 5: Hide-aware checkout and storefront

**Files:**
- Modify: `src/server/checkout.ts` (`ProductState`, `CheckoutErrorCode`, `evaluateCheckout`)
- Modify: `src/app/api/orders/route.ts` (products map select, `errorResponse`)
- Modify: `src/app/(storefront)/page.tsx` (~line 42 select)
- Test: `tests/checkout-guard.test.ts` (extend)

**Interfaces:**
- Consumes: `sessionProducts.hidden` (Task 2).
- Produces: `CheckoutErrorCode` includes `"PRODUCT_HIDDEN"`; `ProductState` has `hidden: boolean`; `evaluateCheckout` returns `{ code: "PRODUCT_HIDDEN", itemId, sessionProductId }` for hidden products, checked **before** the stock rule.

- [ ] **Step 1: Failing test** in `tests/checkout-guard.test.ts`: a cart line whose product has `hidden: true` → `expect(evaluateCheckout(deps)).toEqual({ ok:false, error:{ code:"PRODUCT_HIDDEN", itemId: 1, sessionProductId: "sp-1" } })`; add `hidden: false` to the existing fixture helper so the whole file keeps passing.
- [ ] **Step 2: FAIL → implement** the checkout.ts changes → **PASS** (`yarn vitest run tests/checkout-guard.test.ts`).
- [ ] **Step 3: Orders route** — select `hidden` into the products map; add the switch case: `jsonError(409, "Salah satu produk sudah tidak dijual. Buang dari keranjang, ya.", error.itemId)`.
- [ ] **Step 4: Storefront page** — `where(and(eq(sessionProducts.sessionId, active.id), eq(sessionProducts.hidden, false)))`.
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(storefront): hidden products leave the sale but stay auditable"`.

---

### Task 6: Activation messages + proactive controls

**Files:**
- Modify: `src/server/session-rules.ts` (new export)
- Modify: `src/app/api/sessions/[id]/activate/route.ts:48` and sibling session routes (`route.ts`, `end`, `pause`, `resume`) — translate leaky 4xx strings
- Modify: `src/app/admin/page.tsx` + `src/app/_components/session-actions.tsx` (disable Aktifkan with inline reason)
- Test: `tests/session-rules.test.ts` (extend)

**Interfaces:**
- Produces from `@/server/session-rules`:
  - `activationBlockMessage(reason: "OVERLAP" | "PAUSED_BLOCK"): string` — OVERLAP: `"Jam sesi ini bertabrakan dengan sesi lain. Ubah jam salah satunya dulu."`; PAUSED_BLOCK: `"Masih ada sesi yang dijeda. Lanjutkan atau akhiri sesi itu sebelum mengaktifkan sesi baru."`
  - `activationPreview(sessions: readonly Candidate[], candidateId: string): "OVERLAP" | "PAUSED_BLOCK" | null` — same rules as `canActivate` but from an already-loaded list (no DB), so the admin list can pre-compute it.

- [ ] **Step 1: Failing tests** for both functions (reuse `session-rules.test.ts` fixtures; `activationPreview` must agree with `canActivate` on the same lists — assert one parity case for PAUSED_BLOCK and one for OVERLAP).
- [ ] **Step 2: Implement; PASS.**
- [ ] **Step 3: Activate route** — `jsonError(409, activationBlockMessage(verdict.reason), { reason: verdict.reason })` (extend `jsonError` with an optional extra-fields object). Translate the route's other English strings; same sweep for `route.ts` (PATCH/DELETE), `end/pause/resume`.
- [ ] **Step 4: Admin list** — in `src/app/admin/page.tsx` load sessions with `startTime/endTime` (already selected for the list rows), call `activationPreview` per SCHEDULED row, pass `blockReason` into `SessionActions`; when set, the Aktifkan button renders `disabled` with `title={activationBlockMessage(blockReason)}` and a quiet inline hint under the row's actions.
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(admin): activation explains itself before it fails"`.

---

### Task 7: Roster single-Save with dirty-row flags

**Files:**
- Modify: `src/app/_components/product-picker.tsx` (row edit ~316-360, desktop row Simpan ~545-565, mobile card Simpan ~700, `ProductPicker` ~763-816 + roster header/footer)
- Modify: `src/app/admin/sessions/[id]/products/page.tsx:66-90` (editable flag + copy)
- Test: `tests/product-picker.test.ts` (extend)

**Interfaces:**
- Consumes: Task 4 PUT (`hidden`), Task 3 `canEditProducts`.
- Produces from `@/app/_components/product-picker`: `dirtyPatches(products: readonly SessionProduct[], drafts: ReadonlyMap<number, { quota: string; minOrder: string; flashPrice: string }>): Array<{ itemId: number; patch: { sessionQuota?: number; minOrder?: number; flashPrice?: number } }>` — only rows with a parseable field that differs from the saved value; untouched rows absent; invalid drafts skipped silently (Save stays blocked by `rowCanSave`). `SessionProduct` type gains `hidden: boolean`.

- [ ] **Step 1: Failing tests** for `dirtyPatches`: unchanged row → `[]`; quota-only change → one patch with just `sessionQuota`; empty cell ignored; string "50" equals number 50 → not dirty.
- [ ] **Step 2: FAIL → implement `dirtyPatches`, export it → PASS.**
- [ ] **Step 3: Draft plumbing** — `useRowEdit` reports draft changes up (`onDraftChange(itemId, {quota,minOrder,flashPrice})`); `ProductPicker` owns `drafts: Map<number, ...>`; per-row Simpan buttons removed (both desktop row and mobile card); dirty rows get `bg-amber-500/10` tint + a "belum disimpan" chip (amber, xs).
- [ ] **Step 4: Save bar** — bottom of the roster panel: one `<Button variant="ink" isLoading={savingAll} disabled={dirty.length === 0}>Simpan semua perubahan</Button>` plus count chip; `flush` runs `Promise.all` PUTs from `dirtyPatches`; per-row failure → keep that row dirty + `bg-red-500/10` + toast `"Gagal menyimpan N produk: <first server message>"`; all ok → clear drafts, toast `"Perubahan produk tersimpan."`, `router.refresh()`. A `warning: "UNKNOWN_STOCK"` response appends toast warning `"Stok belum tentu akurat untuk <SKU>."`
- [ ] **Step 5: Hide/show** — per-row ghost icon button `EyeSlashIcon`/`EyeIcon` (`aria-label="Sembunyikan"/"Tampilkan lagi"`), immediate PUT `{hidden}` with own `isLoading` (reuse `busyItem` single-flight); hidden rows render muted with the chip `Sembunyikan (tidak tampil di toko)`; trash button renders only when `sessionStatus === "SCHEDULED"`; picker modal `+ Tambah` on an already-rostered item while ACTIVE/PAUSED = unhide (POST handles it server-side, merge via existing `mergeProductsById`).
- [ ] **Step 6: Editable window** — `const canEdit = canEditProducts(sessionStatus)` in the picker; page: `editable = canEditProducts(session.status)`, copy line: live sessions get `"Perubahan tersimpan lewat tombol Simpan. Produk yang disembunyikan hilang dari toko, pesanan lama tetap aman."`
- [ ] **Step 7: Gate + commit** — `git commit -m "feat(admin): one Save for the whole roster, dirty rows flagged"`.

---

### Task 8: Stok-0 add guard (picker)

**Files:**
- Modify: `src/app/_components/product-picker.tsx` (~1076-1090 search rows)
- Test: `tests/product-picker.test.ts` (extend)

**Interfaces:**
- Produces from `@/app/_components/product-picker`: `canAddRow(stock: number | null): boolean` — `stock === 0 → false`, null (unknown) or >0 → true.

- [ ] **Step 1: Failing test** — three cases above.
- [ ] **Step 2: Implement; PASS.**
- [ ] **Step 3: Wire** — Tambah button gets `disabled={canAddRow(...) === false || busyItem !== null}` with `title="Stok 0"`; "Stok 0" cell turns red-600 so the disabled state reads as caused.
- [ ] **Step 4: Gate + commit** — `git commit -m "fix(admin): zero-stock products can no longer enter a session"`.

---

### Task 9: Customer "Selesai" vocabulary

**Files:**
- Modify: `src/server/order-status.ts:65-88`
- Modify: `src/server/status-steps.ts` (pending-step block ~128-140)
- Test: `tests/order-status.test.ts`, `tests/status-steps.test.ts` (extend/adjust)

**Interfaces:**
- Produces: `CUSTOMER_STATUS_LABEL` = UNPAID "Belum Bayar", CONFIRMED "Selesai", SHIPPED "Selesai", COMPLETED "Selesai", CANCEL "Dibatalkan"; `stepLabel(UNPAID→CONFIRMED)` = `"Selesai"` (drop "Dibayar — sales order dibuat"); `buildStatusSteps` emits the pending placeholder step **only when `status === "UNPAID"`** (CONFIRMED is now terminal for customers — no step after "Selesai"; CANCEL path untouched).

- [ ] **Step 1: Update failing tests** — assertions in `order-status.test.ts` and `status-steps.test.ts` for the mapping above, including: a CONFIRMED order's steps end at the paid "Selesai" step (no pending step); a CANCEL-after-paid order still reads Dibatalkan with cancel tone; SHIPPED legacy row reads "Selesai".
- [ ] **Step 2: FAIL → implement → PASS** (`yarn vitest run tests/order-status.test.ts tests/status-steps.test.ts`).
- [ ] **Step 3: Grep consumers** — `grep -rn "CUSTOMER_STATUS_LABEL\|Dikonfirmasi\|Diproses" src tests` and fix label-driven expectations (e.g. `tests/status-badge.test.ts` call sites in `orders-list.tsx`/receipt pass labels from the map, so verify, don't re-hardcode).
- [ ] **Step 4: Gate + commit** — `git commit -m "feat(storefront): paid means Selesai for customers"`.

---

### Task 10: Bahasa sweep

**Files (grep-driven, non-exhaustive map):**
- Modify: `src/app/_components/session-actions.tsx` ("Edit" → "Ubah"), `admin-nav.tsx`, `session-form.tsx`, `session-list-filter.tsx`, `orders-list.tsx`, `order-detail-dialog.tsx`, `receipt-dialog.tsx`, `payment-panel.tsx`, `checkout-dialog.tsx`, `cart-drawer.tsx`, `product-picker.tsx` leftovers, `kpi-tiles.tsx`, admin page headers + all `metadata.title` values ("Flash Studio Admin" → "Flash Sale Grosir Admin"), `src/app/api/**` any surviving English user strings.
- Test: run the whole suite; fix label-asserting tests (`admin-format`, `admin-nav-active`, `status-badge`) to the new copy.

**Interfaces:**
- Glossary (fixed, reuse everywhere): Simpan · Tambah · Sembunyikan · Tampilkan lagi · Ubah · Hapus · Aktifkan · Jeda · Lanjutkan · Akhiri · Sesi · Stok · Kuota · Produk · Pesanan · Gagal memuat …, coba lagi.

- [ ] **Step 1: Inventory** — `grep -rn '"[A-Z][a-z]+ [A-Za-z]' src/app | grep -v "//"` to list English user-facing literals; triage each (user string vs code/log).
- [ ] **Step 2: Translate per glossary**, string by string; no structural change.
- [ ] **Step 3: Full suite + gate** — `yarn vitest run && COREPACK_ENABLE_STRICT=0 yarn run check`.
- [ ] **Step 4: Commit** — `git commit -m "feat(copy): one language everywhere — Bahasa Indonesia"`.

---

### Task 11: Icons on action buttons

**Files:**
- Modify: `session-actions.tsx`, `session-form.tsx`, `product-picker.tsx` buttons, `cancel-order-button.tsx`, `confirm-order-button.tsx`, `proof-upload-button.tsx`, `sync-now-button.tsx`, `checkout-dialog.tsx`
- Test: none (visual) — gate + `yarn run dev` spot check per surface.

**Interfaces:**
- Mapping (Phosphor, `weight="regular"`, `className="size-4 shrink-0"`, before label): Aktifkan `PlayIcon` · Jeda `PauseIcon` · Lanjutkan `PlayIcon` · Akhiri `StopIcon` · Hapus `TrashIcon` · Ubah `PencilIcon` · Simpan/Simpan semua `FloppyDiskIcon` · Tambah `PlusIcon` · Sembunyikan/Tampilkan `EyeSlashIcon`/`EyeIcon` · Checkout `ShoppingBagIcon` · Batal `XIcon`. Reuse existing imports where a file already has the icon.

- [ ] **Step 1: Apply the mapping** to every action button in the listed files (icon as first child; `size="icon-xs"` buttons keep icon-only + `aria-label`).
- [ ] **Step 2: Gate + commit** — `git commit -m "feat(ui): action buttons carry icons"`.

---

### Task 12: Flash Sale Grosir brand

**Files:**
- Create: `public/brand/logo-square.png`, `public/brand/logo-lockup.png`, `public/brand/icon-variants.png` (copies of `docs/assets/*` — use shell `cp`, do not open the PNGs)
- Modify: `src/app/_components/admin-logo.tsx`, `src/app/_components/admin-nav.tsx`, `src/app/_components/storefront-header.tsx:166`, `src/app/layout.tsx:11-15` (+ `lang="en"` → `"id"`), `src/app/auth/login/page.tsx:5,39`, `src/app/login/success/page.tsx:14,33`, any surviving `metadata.title`.
- Test: grep assertion — no matches remain for `FlashStudio|Flash Studio|Saeful Askar` under `src/`.

**Interfaces:**
- Produces: `<AdminLogo>` renders the square icon image (same size props `sm|md`, `alt=""` decorative); wordmark text next to it becomes "Flash Sale Grosir"; `metadata.title` root = `"Flash Sale Grosir"`, icons = `/brand/logo-square.png` (keep `favicon.ico` link too; raster downscale accepted per spec ruling 5).

- [ ] **Step 1: Copy assets** into `public/brand/`.
- [ ] **Step 2: Swap marks & name** per the file list; lockup image (not text) for the login page hero; square icon in `AdminLogo` and favicon metadata.
- [ ] **Step 3: Verify transparency/dark-chrome fit** via `yarn run dev` + screenshot of admin (light) and storefront (dark) headers; if the supplied variant clashes on dark chrome, stop and ask the owner for the alternate export named in the color-variants sheet — do not improvise a new mark.
- [ ] **Step 4: Grep assertion + gate + commit** — `git commit -m "feat(brand): Flash Sale Grosir everywhere"`.

---

## Review Focus

Uncaught-but-likely behaviors the spec implies; each line is pinned by a named task's tests/steps:

1. **Cart holding a just-hidden product** — checkout must answer `PRODUCT_HIDDEN` with the Bahasa toast, never a 500 or a silent order (Task 5 Step 1).
2. **Re-add of a hidden product mid-session** must NOT reset price/quota/category (unhide-only) — live-sale data-loss trap (Task 3 `reAddDecision`, Task 4 Step 1).
3. **Quota raised while the stock map is down/misses** — edit is allowed with a warning, snapshot not blanked (Task 3 `quotaUpdateDecision`, Task 4 Step 2).
4. **Legacy rows (SHIPPED parked, CANCEL-after-paid)** under the new vocabulary — no duplicate "Selesai" step, cancel still red (Task 9 Step 1).
5. **ENDED sessions** — no edit controls anywhere, API still 409s in Bahasa (Task 3 `canEditProducts`, Task 4 Steps 1–3, Task 7 Step 6).
6. **Batch Save partial failure** — failed row keeps its draft + red tint while others save; nothing silently reverts (Task 7 Step 4).
