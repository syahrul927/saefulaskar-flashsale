# Admin Console & Jubelio Import Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jubelio product search work (currently a guaranteed 502), unify the picker button, sort admin lists newest-first, add session filter tabs, and surface a global KPI row on the console.

**Architecture:** The Jubelio items endpoint rejects every query param (verified live 2026-10-26), so the route becomes a fetch-all + 60 s in-memory cache and the product picker filters the catalog client-side through the existing debounce. Server-side read helpers in `src/server/` compute console KPIs from the existing schema (no migrations anywhere); shared `KpiTile`/`KpiRow` and `FilterPill` components are reused, not re-styled.

**Tech Stack:** Next.js (App Router, RSC + `"use client"` islands), drizzle-orm (postgres-js), vitest (node env), shadcn-style base components, sonner toasts.

**Spec:** `docs/superpowers/specs/2026-10-26-admin-console-feedback-design.md` — read it with this plan; live API probe findings (573 items, no params accepted, stock sources dead) are in its "Current state" and "Pending partner answers" sections.

## Global Constraints

- UI copy in Indonesian, matching existing strings on each page.
- No new npm/yarn dependencies. No DB schema change → never run `db:generate`/`db:push`/`db:migrate`.
- Package manager is yarn only. Tests: `yarn vitest run tests/<file>.test.ts`. Static gate: `yarn check` (lint + tsc).
- Commits stage ONLY the task's files — the working tree already has unrelated modified files (`payment-panel.tsx`, `receipt-dialog.tsx`, `copy-chip.tsx`, `format.ts`…); leave them unstaged.
- Base `Button` shows a spinner when `isLoading` — API-triggered buttons must use it. All user-action failures surface a `sonner` toast.
- Commit message style follows history: `fix(jubelio): …`, `feat(admin): …`, `refactor(admin): …`. Work on a feature branch off `main` (creating/merging the branch on `main` needs the human partner's confirmation first).

## Review Focus

Failure modes the spec implies that task tests must pin explicitly:

1. Upstream returns a non-JSON error body (HTML 404/500 page) → `request()` keeps its fallback message and the route still answers with a real status, never a crash (Task 2, pins spec "error honesty").
2. Masters item payload with missing/garbage `variants` JSON string → `toPickerRows` yields a fallback row (`itemId 0`, empty strings, `stock null`), never throws (Task 1).
3. A hand-edited or stale deep link `?status=<garbage>` on /admin/orders → lands on "ALL", not a broken tab (Task 4).
4. Orders created around the WIB midnight seam (17:00 UTC) → counted in the correct "today"/"yesterday" bucket (Task 6).
5. Two picker fetches racing the cache TTL (double dialog open, concurrent requests) → exactly one upstream call per TTL window, and the second caller gets the same rows (Task 2).

---

### Task 1: Jubelio client — URL join fix, param-less listProducts, real masters mapping

**Files:**
- Modify: `src/lib/jubelio.ts` (request join ~L45, `listProducts` ~L193-197, `toPickerRows` ~L126-139, `PickerRow` doc comments)
- Modify: `tests/jubelio.test.ts` (listProducts cases ~L22-36)
- Rewrite: `tests/jubelio-products-route.test.ts` (its `toPickerRows` describe block)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `listProducts(): Promise<unknown>` (no arguments) on `JubelioClient`; `toPickerRows(raw: unknown): PickerRow[]` that accepts the real `{ data: [...] }` envelope; `type PickerRow = { itemId: number; skuCode: string; itemGroupName: string; price: number; minOrder: number; stock: number | null }` (field names unchanged — `product-picker.tsx` `SearchResult` and the roster POST contract keep compiling untouched).

- [ ] **Step 1: Rewrite `toPickerRows` tests to the verified masters shape (failing)**

In `tests/jubelio-products-route.test.ts`, replace the `toPickerRows` describe with fixtures copied from the live probe (spec §Decision 1 "Verified field mapping"):

```ts
// envelope + variants as the JSON-encoded string Jubelio actually returns
const mastersItem = {
  item_group_id: 1868,
  item_name: "Kuangyu Dream - SLA",
  sell_price: "3700000.0000",
  variants: JSON.stringify([
    { item_id: 2685, item_code: "[SLA]UA000044N", is_bundle: true, sell_price: 3700000 },
  ]),
};

toPickerRows({ data: [mastersItem] })
// expect [{ itemId: 2685, skuCode: "[SLA]UA000044N", itemGroupName: "Kuangyu Dream - SLA",
//          price: 3700000, minOrder: 1, stock: null }]
```

Assert cases: `{data:[…]}` envelope; bare array still tolerated; `sell_price` string → number; empty/absent/garbage-JSON `variants` → `{ itemId: 0, skuCode: "", …, minOrder: 1, stock: null }` fallback row, no throw; `toPickerRows(null)`/`toPickerRows({})` → `[]`; non-array `data` → `[]`; `stock` is `null` for every row (no upstream stock source).

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run tests/jubelio-products-route.test.ts`
Expected: FAIL (old mapper reads `item_id`/`sku_code`, can't see the envelope).

- [ ] **Step 3: Implement join fix + `listProducts()` + new `toPickerRows` in `src/lib/jubelio.ts`**

`request()`: build the URL by stripping slashes on both sides before joining —
```ts
const url = `${env.JUBELIO_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
```
`listProducts()`: no parameters, GET `/inventory/items/masters`, no query string. Keep the doc comment noting upstream rejects all params (cite spec probe).

`toPickerRows(raw)`: unwrap `Array.isArray(raw) ? raw : (raw as any)?.data ?? []`; per item parse `variants` via `JSON.parse` inside try/catch (string) or accept already-parsed array; first entry supplies `item_id`/`item_code`; label = `item_name`; price = `Number(item.sell_price)` falling back to variant `sell_price`, then `0`; `minOrder` constant `1` (masters has no `min`); `stock` constant `null`. Keep `num`/`str` helpers for the primitive guards. Update the `PickerRow.stock` doc comment: "always null this round — no upstream stock source (spec: pending partner/Jubelio-dev answer); column dropped from the picker UI."

- [ ] **Step 4: Update `tests/jubelio.test.ts` listProducts + add join test**

Replace the `?search=` URL assertion with:
```ts
await client.listProducts();
// url === "https://open.jubelio.com/core-api/inventory/items/masters" (single slash)
// init.method === "GET", Bearer + JSON headers unchanged
```
Add one test asserting no double slash even though `JUBELIO_BASE_URL` ends with `/` (the vitest-config env value — this pins the join fix).

- [ ] **Step 5: Run all Jubelio tests + static gate**

Run: `yarn vitest run tests/jubelio.test.ts tests/jubelio-products-route.test.ts && yarn check`
Expected: PASS, no lint/type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jubelio.ts tests/jubelio.test.ts tests/jubelio-products-route.test.ts
git commit -m "fix(jubelio): normalize URL join, drop rejected search param, map real masters shape"
```

---

### Task 2: Catalog cache + honest error propagation in the route

**Files:**
- Create: `src/server/jubelio-catalog.ts`
- Create: `tests/jubelio-catalog.test.ts`
- Modify: `src/app/api/jubelio/products/route.ts`

**Interfaces:**
- Consumes (Task 1): `createJubelioClient(token).listProducts(): Promise<unknown>` (no params), `toPickerRows(raw)`, `JubelioError { status, message }`, `isJubelioAuthError`.
- Produces: `getCatalogRows(client: JubelioClient): Promise<PickerRow[]>` — memoized full-catalog fetch (module-level TTL cache, single-flight). Task 3's picker consumes its HTTP shape: `GET /api/jubelio/products` → `PickerRow[]` JSON on success; `{ error: string }` with 401/403 or the propagated upstream status on failure.

- [ ] **Step 1: Write failing cache tests**

`tests/jubelio-catalog.test.ts` with a stubbed client (`{ listProducts: vi.fn() }`), `vi.useFakeTimers()` + `vi.setSystemTime()` to cross the TTL, and an exported reset (`__resetCatalogCache()` — test-only, documented):

```ts
it("fetches once and serves cache hits within the 60s TTL", …)
it("refetches after the TTL expires", …)
it("dedupes concurrent calls into one upstream fetch (two awaits, one call)", …)
it("keeps the upstream JubelioError when the fetch fails (status 400, message)", …)
it("survives a non-JSON upstream body path: fallback message kept, status forwarded", …)
```

Run: `yarn vitest run tests/jubelio-catalog.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `src/server/jubelio-catalog.ts`**

Module state: `{ expiresAt: number; promise: Promise<PickerRow[]> } | null`; TTL `const CATALOG_TTL_MS = 60_000`. `getCatalogRows(client)`: return cached promise when `Date.now() < expiresAt`; else start `client.listProducts().then(toPickerRows)` — on rejection clear the entry so the next caller retries (no poisoned cache) and rethrow. `__resetCatalogCache()` clears state. Node runtime only (used by a `runtime = "nodejs"` route). Comment cites spec: best-effort per-instance cache; cold instance pays one ~1.7 s fetch.

- [ ] **Step 3: Rewrite the route handler**

`GET /api/jubelio/products` keeps the `getSession()` OWNER guard. Drop the `search` param parsing entirely (ignore any query string). `try { rows = await getCatalogRows(createJubelioClient(auth.user.token)) }`:
- `isJubelioAuthError(e)` → `401 { error: "SESSION_EXPIRED" }` (unchanged contract).
- `e instanceof JubelioError` → `jsonError(e.status, e.message)` — upstream status/message propagated, never a blanket 502.
- other errors → `502 { error: "Gagal memuat produk, coba lagi" }` (network-level failure).
Success: `Response.json(rows)`.

- [ ] **Step 4: Run tests + gate**

Run: `yarn vitest run tests/jubelio-catalog.test.ts tests/jubelio.test.ts && yarn check`
Expected: PASS.

- [ ] **Step 5: Live sanity check (manual)**

Run `yarn dev`, then in a terminal `curl -s localhost:3000/api/jubelio/products -H 'Cookie: <dev admin session>' | jq 'length'` — expect ~573 (log in as OWNER at /admin first; an admin browser session cookie works too). If the app's dev session cookie is awkward, confirm via Task 3's manual step instead.

- [ ] **Step 6: Commit**

```bash
git add src/server/jubelio-catalog.ts tests/jubelio-catalog.test.ts src/app/api/jubelio/products/route.ts
git commit -m "feat(jubelio): cache full catalog server-side, propagate upstream errors honestly"
```

---

### Task 3: Picker — client-side filter, one button, fixed copy, stock column dropped

**Files:**
- Create: `src/app/_components/use-debounced-value.ts`
- Modify: `src/app/_components/product-picker.tsx` (search effect ~L684-727, `EmptyRoster` ~L613-639, dialog trigger ~L833-851, stock span ~L934-939, counter ~L866-869)
- Modify: `tests/product-picker.test.ts` (append describe block)

**Interfaces:**
- Consumes (Task 2): `GET /api/jubelio/products` (no params) → `PickerRow[]`; failure → `{ error }` with real status (401 contract unchanged).
- Produces: exported pure helper `filterCatalog(rows: SearchResult[], query: string, cap?: number): SearchResult[]` from `product-picker.tsx`; `useDebouncedValue(value: T, delayMs: number): T`. `SearchResult` type and roster POST body unchanged.

- [ ] **Step 1: Write failing `filterCatalog` tests**

Append to `tests/product-picker.test.ts` (reuse its file-local `rosterRow` style — build `SearchResult` literals inline):

```ts
it("matches name and SKU case-insensitively, substring", …)
// filterCatalog(rows, "sepeda") → only Kuangyu rows by name; filterCatalog(rows, "sla") hits SKU "[SLA]UA000044N"
it("empty/whitespace query returns the whole catalog", …)
it("caps results at the limit (default 100)", …)
it("never matches on stock/price numbers", …) // query "3700000" → [] when only price contains it
```

Run: `yarn vitest run tests/product-picker.test.ts` → FAIL (helper missing).

- [ ] **Step 2: Implement `filterCatalog` + `useDebouncedValue`**

`filterCatalog` in `product-picker.tsx` (exported): trim + lowercase query; `rows.filter(r => name.includes(q) || sku.includes(q))`; `.slice(0, cap)` with `cap = 100`.
`src/app/_components/use-debounced-value.ts`: `"use client"`; standard hook — `useState(value)`, `useEffect` `setTimeout(set, delayMs)` with cleanup; doc comment: "replaces product-picker's hand-rolled setTimeout debounce (spec: keep 300 ms, extract for clarity)."

- [ ] **Step 3: Rework the picker's data flow**

State: `const [catalog, setCatalog] = useState<SearchResult[] | null>(null)`, `loadingCatalog`, `loadErrored`. One `useEffect` keyed on `pickerOpen` (fires only while `catalog === null && !loadingCatalog`): fetch `/api/jubelio/products` (no params), on 401 → `signOutOnExpiry()` (keep), non-OK → parse `{ error }` body if possible, `toast.error` with that message, set `loadErrored`; success → `setCatalog`. This means catalog loads while the modal opens — the existing Skeleton plate shows during `loadingCatalog` (rename `searching` usage accordingly).

Search: `const debounced = useDebouncedValue(search, 300)`; `const results = useMemo(() => catalog ? filterCatalog(catalog, debounced) : [], [catalog, debounced])`. Delete the old fetch-in-timeout effect entirely. `searchErrored` plates: keep both plates but now driven by `loadErrored` (fetch failed) vs empty `results` (no match); copy stays.

- [ ] **Step 4: Unify buttons + copy + drop stock**

- Dialog trigger label → exactly `Pilih Produk Jubelio` (drop the `+`); `EmptyRoster` button → `<Button variant="ink" onClick={onImport}>Pilih Produk Jubelio</Button>` (was `brand`/"Import dari Jubelio").
- Dialog subtitle: replace "Cek stok real-time dari seluruh gudang yang terhubung." with "Katalog produk disinkron langsung dari Jubelio ERP."
- Remove the `stok {r.stock ?? "—"}` span from picker rows (keep SKU badge + struck price). `SearchResult.stock` field remains (mapper keeps emitting `null`) so the type and route stay untouched.
- Counter beside the input: show `{results.length}/{catalog.length} SKU` when catalog loaded (honest filtered total), `— SKU` when `loadErrored`, nothing during load.

- [ ] **Step 5: Run tests + gate, then manual check**

Run: `yarn vitest run tests/product-picker.test.ts && yarn check` → PASS.
Manual (`yarn dev` → an ACTIVE/SCHEDULED session's Produk page): open picker → rows appear within ~2 s on first open, instantly after; type "Sepeda" → list filters without network (DevTools Network shows one request per dialog open, not per keystroke); empty roster shows the single dark "Pilih Produk Jubelio" button in both places.

- [ ] **Step 6: Commit**

```bash
git add src/app/_components/use-debounced-value.ts src/app/_components/product-picker.tsx tests/product-picker.test.ts
git commit -m "fix(admin): client-side catalog filtering, one picker button, honest dialog copy"
```

---

### Task 4: Sort both admin lists newest-first + orders deep link

**Files:**
- Modify: `src/app/admin/page.tsx:135` (sessions query)
- Modify: `src/app/admin/orders/page.tsx:30-31` (query + searchParams)
- Modify: `src/app/_components/admin-orders-filter.tsx` (initial tab)
- Modify: `tests/order-filters.test.ts` (append `resolveInitialTab` cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `resolveInitialTab(raw: string | undefined): AdminTab` exported from `admin-orders-filter.tsx`; `AdminOrdersFilter` gains `initialTab?: AdminTab` prop (default `"ALL"`); the deep link `/admin/orders?status=UNPAID` lands on the Belum Bayar tab. Task 7's KPI tile links to that URL.

- [ ] **Step 1: Write failing `resolveInitialTab` tests**

Append to `tests/order-filters.test.ts`: `"UNPAID" → "UNPAID"`, `"COMPLETED" → "COMPLETED"`, `"DROP TABLE" → "ALL"`, `"" → "ALL"`, `undefined → "ALL"`. Run → FAIL.

- [ ] **Step 2: Implement helper + prop**

In `admin-orders-filter.tsx`: `const TAB_SET = new Set<string>(TABS); export function resolveInitialTab(raw) { return raw && TAB_SET.has(raw) ? (raw as AdminTab) : "ALL"; }`; component signature `{ rows, initialTab = "ALL" }` → `useState(initialTab)`.

- [ ] **Step 3: Orders page: ordering + param**

`const rows = await db.select().from(orders).orderBy(desc(orders.createdAt));` (import `desc` from drizzle-orm). Signature: `async function AdminOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> })`; `const raw = (await searchParams).status; resolveInitialTab(typeof raw === "string" ? raw : undefined)` → pass as `initialTab`. (Array/garbage values fall back to "ALL" — that IS the review-focus pin.)

- [ ] **Step 4: Sessions page: ordering**

`db.select().from(flashSessions).orderBy(desc(flashSessions.createdAt))` — newest-created first so the last session sits on top.

- [ ] **Step 5: Verify + commit**

Run: `yarn vitest run tests/order-filters.test.ts && yarn check` → PASS. Manual: /admin and /admin/orders list newest-first; `/admin/orders?status=UNPAID` opens with Belum Bayar active; `/admin/orders?status=nope` opens on Semua.

```bash
git add src/app/admin/page.tsx src/app/admin/orders/page.tsx src/app/_components/admin-orders-filter.tsx tests/order-filters.test.ts
git commit -m "feat(admin): newest-first session/order lists, URL-driven orders status tab"
```

---

### Task 5: Extract shared KPI tiles

**Files:**
- Create: `src/app/_components/kpi-tiles.tsx`
- Modify: `src/app/admin/page.tsx:35-124` (delete local defs, import shared)

**Interfaces:**
- Consumes: nothing.
- Produces: `KpiTile({ label, value, unit?, hint?, valueClassName?, href? })` and `KpiRow({ kpis }: { kpis: SessionKpis })` (same markup as the current file-local versions) exported from `@/app/_components/kpi-tiles`. `href` wraps the tile in `<Link>` (tile gets `block` + focus ring like existing cards). Task 7 imports both.

- [ ] **Step 1: Move code, add `href`**

Copy `KpiTile` + `KpiRow` verbatim from `src/app/admin/page.tsx` into `kpi-tiles.tsx` (imports: `cn`, `Link`, `SessionKpis` type, formatters from `@/app/admin/format` + `@/lib/format` — adjust import paths). Add `href?: string`: when present, the outer `div` becomes `nativeButton={false} render={<Link href/>}`-free — simplest: wrap tile content in a `<Link className="block …">` carrying the same classes, keep the `div` version byte-identical when no `href`.

- [ ] **Step 2: Repoint the console page**

Delete both local defs in `admin/page.tsx`, `import { KpiRow } from "@/app/_components/kpi-tiles";`. No render-site changes.

- [ ] **Step 3: Verify + commit**

Run: `yarn check` → PASS; manual: /admin "Metrik Sesi Aktif" row looks pixel-identical.

```bash
git add src/app/_components/kpi-tiles.tsx src/app/admin/page.tsx
git commit -m "refactor(admin): extract KpiTile/KpiRow to shared components"
```

---

### Task 6: Global KPI server helper

**Files:**
- Create: `src/server/console-kpi.ts`
- Create: `tests/console-kpi.test.ts`

**Interfaces:**
- Consumes: `SessionDbLike` (from `@/server/session-query`), tables `orders`/`flashSessions`/`sessionProducts`, `getPrimaryActiveSession`.
- Produces (Task 7 imports exactly these):

```ts
export type GlobalKpis = {
  unpaidWithProof: number;
  unpaidTotal: number;
  gmvToday: number;
  gmvYesterday: number;
  activeSession: { id: string; name: string } | null;
  nextScheduled: { id: string; name: string; startTime: Date | null } | null;
  totalQuota: number;
  totalClaimed: number;
};
export async function getGlobalKpis(db: SessionDbLike, now?: Date): Promise<GlobalKpis>;
export function wibDayBounds(now: Date): { start: Date; end: Date };
export function formatGmvDelta(today: number, yesterday: number): string;
```

- [ ] **Step 1: Write failing tests for the two pure helpers**

`tests/console-kpi.test.ts`:

```ts
wibDayBounds(new Date("2026-10-26T09:30:00Z")) // → start 2026-10-25T17:00:00Z, end 2026-10-26T17:00:00Z
wibDayBounds(new Date("2026-10-26T16:59:59Z")) // end of the PREVIOUS WIB day is now
wibDayBounds(new Date("2026-10-26T17:00:00Z")) // exactly at seam → new day starts at now
formatGmvDelta(1_120_000, 1_000_000) === "+12% vs kemarin"
formatGmvDelta(920_000, 1_000_000) === "-8% vs kemarin"
formatGmvDelta(500_000, 0) === "baru vs kemarin"
formatGmvDelta(0, 0) === "— vs kemarin"
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement `wibDayBounds` + `formatGmvDelta`**

`wibDayBounds`: WIB is UTC+7 fixed offset; compute the UTC instant of local midnight (`Date.UTC(y, m, d) - 7h` from the date parts rendered via `toISOString`-safe math: take `now.getTime()`, subtract the offset remainder of `(now.getTime() + 7*3600_000) % 86400_000`). Return `{ start, end: start + 24h }`. Comment: fixed offset, no DST (Asia/Jakarta has none).
`formatGmvDelta`: `Math.round(((today - yesterday) / yesterday) * 100)`, sign-prefixed, `% vs kemarin`; zero guards per tests above.

- [ ] **Step 3: Implement `getGlobalKpis` queries**

Use drizzle `count()`, `sum()`, `and`, `eq`, `inArray`, `gte`/`lt` with `wibDayBounds(now ?? new Date())`:
- unpaid: `count` on orders `status='UNPAID'`; withProof adds `isNotNull(orders.transferProofUrl)`.
- GMV: `sum(orders.grandTotal)` where `status in ('CONFIRMED','SHIPPED','COMPLETED')` and `createdAt` in today's bounds; same for yesterday's bounds.
- `activeSession` ← `getPrimaryActiveSession(db)` (select `id, name` only).
- `nextScheduled`: sessions where `status='SCHEDULED'`, order `asc(startTime)` (nulls last is fine), limit 1.
- quota/claimed: join-free two-step — session ids where `status in ('ACTIVE','SCHEDULED')`, then `sessionProducts` filtered by `inArray(sessionId, ids)` summing `claimed` and `sessionQuota`.

- [ ] **Step 4: Verify + commit**

Run: `yarn vitest run tests/console-kpi.test.ts && yarn check` → PASS. (Query glue stays untested at unit level like the rest of `session-query`'s callers; the pure helpers carry the pinned behavior. getGlobalKpis is exercised manually in Task 7.)

```bash
git add src/server/console-kpi.ts tests/console-kpi.test.ts
git commit -m "feat(admin): global console KPIs with WIB day bounds and GMV delta"
```

---

### Task 7: Console KPI row (four global tiles)

**Files:**
- Modify: `src/app/admin/page.tsx` (query block ~L133-137, render above existing `KpiRow` ~L157)

**Interfaces:**
- Consumes: `getGlobalKpis`, `formatGmvDelta` (Task 6); `KpiTile` with `href` (Task 5); deep link `/admin/orders?status=UNPAID` (Task 4); `formatRupiah`, `formatCompactRupiah`, `formatClaimPercent`, `formatRange` as already imported in the page.
- Produces: rendered "Ringkasan" section — no new exports.

- [ ] **Step 1: Fetch + render the row**

Add `getGlobalKpis(db)` to the existing `Promise.all`. New section above `{kpis && <KpiRow …/>}`:

- Tile 1 — `label="PERLU KONFIRMASI"`, `value=String(unpaidWithProof)`, `hint=` `${unpaidWithProof} dari ${unpaidTotal} belum bayar`, `valueClassName="text-brand-primary"` when > 0 (omit when 0 — default ink wins, matches KpiTile's single-color-class rule), `href="/admin/orders?status=UNPAID"`.
- Tile 2 — `label="GMV HARI INI"`, `value=formatRupiah(gmvToday)`, `hint=formatGmvDelta(gmvToday, gmvYesterday)`, `valueClassName="text-emerald-600"`.
- Tile 3 — `label="SESI AKTIF"`, value `activeSession?.name ?? "Tidak ada"` (tile truncates overflow already); hint: active → `sedang berlangsung`; none → `berikutnya: ${nextScheduled.name} · ${when}` where `when = nextScheduled.startTime ? nextScheduled.startTime.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—"`. NOTE: do NOT reuse the page's `formatRange` here — it returns "—" whenever either bound is null. When there is no `nextScheduled` either: `belum ada sesi terjadwal`. `href` → `/admin/sessions/${id}/products` for whichever session is named (omit when none). The `startTime ? … : "—"` guard is the review-focus pin: sessions with unset times must not crash the copy.
- Tile 4 — `label="KLAIM vs KUOTA"`, `value=` `${totalClaimed}/${totalQuota}`, `hint=formatClaimPercent(totalClaimed, totalQuota)`. (Percent hint instead of a progress bar: matches the RESERVED tile idiom — spec "thin progress bar" folded here deliberately, one styling language, no new component.)

Section heading mono line mirrors `KpiRow`'s ("Metrik Sesi Aktif" style): `Ringkasan`.

- [ ] **Step 2: Verify + commit**

Run: `yarn check && yarn vitest run` → PASS. Manual: /admin shows the four tiles with real DB numbers; tile 1 click → Belum Bayar tab active; tile values survive a zero-everything database (all four render dashes/zeros, no crash).

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): global KPI row on the console"
```

---

### Task 8: Session filter tabs (Semua / Terjadwal / Aktif / Dijeda / Selesai)

**Files:**
- Create: `src/app/_components/session-list-filter.tsx`
- Modify: `src/app/admin/page.tsx` (list section ~L166-209)

**Interfaces:**
- Consumes: `FilterPill` (`@/app/_components/filter-pill`), `SessionStatus` type (`@/server/db/schema`), ReactNode-as-prop island pattern (same as `AdminOrdersFilter`).
- Produces: `SessionListFilter({ rows, counts }: { rows: { id: string; status: SessionStatus; node: ReactNode }[]; counts: Record<"ALL" | SessionStatus, number> })`.

- [ ] **Step 1: Build the client island**

`"use client"`. Local `type Tab = "ALL" | SessionStatus`; `const TABS: [Tab, string][] = [["ALL","Semua"],["SCHEDULED","Terjadwal"],["ACTIVE","Aktif"],["PAUSED","Dijeda"],["ENDED","Selesai"]]`; `useState<Tab>("ALL")`; pill bar markup copied from `AdminOrdersFilter` (same container classes, `FilterPill` with `count={counts[t]}`, `active`, `onClick`; no `emphasis` — amber is the orders signal, sessions stay quiet). Body: `role="group" aria-label="Filter status sesi"`; render `{rows.filter(r => tab === "ALL" || r.status === tab).map(r => r.node)}` inside the same `<ul className="divide-y …">`, empty plate "Tidak ada sesi pada filter ini." when filtered length 0.

- [ ] **Step 2: Refactor the console list to feed it**

In `admin/page.tsx` extract the per-session `<li>` body into a server-side `SessionListItem({ s }: { s: typeof flashSessions.$inferSelect })` returning the existing markup unchanged. Render `<Panel title="Daftar Sesi" …><SessionListFilter rows={rows.map(s => ({ id: s.id, status: s.status, node: <SessionListItem key={s.id} s={s} /> }))} counts={{ ALL: rows.length, …per-status counts via reduce }} /></Panel>`. Keep the PAUSED lock note and empty-DB plate above as-is.

- [ ] **Step 3: Verify + commit**

Run: `yarn check` → PASS; manual: /admin tabs filter instantly with counts matching, "Terjadwal" shows SCHEDULED rows, list order (newest-first, Task 4) preserved within a tab.

```bash
git add src/app/_components/session-list-filter.tsx src/app/admin/page.tsx
git commit -m "feat(admin): status filter tabs on the session list"
```

---

### Task 9: Branch wrap-up

**Files:** none new.

- [ ] **Step 1: Full gate**

Run: `yarn vitest run && yarn check && yarn build` → all green (`build` catches RSC/client boundary mistakes the others miss).

- [ ] **Step 2: Partner preview checklist (manual, hand to human)**

502 gone in picker; one button; tabs; KPI tiles; deep link; newest-first. Stock question still parked with the Jubelio dev (spec's pending list) — nothing blocked on it.

- [ ] **Step 3: Whole-branch review per execution skill; merge to `main` only with partner confirmation.**
