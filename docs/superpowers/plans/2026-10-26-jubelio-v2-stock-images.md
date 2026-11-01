# Jubelio v2 Stock + Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin picker and roster show Jubelio v2's real `available` stock and thumbnails (dashboard parity ≤ 60 s); import writes truthful `jubelio_stock` snapshots and blocks rows with no number.

**Architecture:** A second 60 s module-level cache entry (v2 `/inventory/v2/`) joins the existing masters catalog by `item_id` server-side; `/api/jubelio/products` returns merged rows, the admin roster page joins the same cache live, and the POST import writer becomes the sole `jubelio_stock` writer switching from the per-SKU `by-sku` fan-out to the v2 map. Storefront copy and gates are untouched.

**Tech Stack:** Next.js 16 App Router (server components + route handlers), TypeScript, Drizzle (no schema change), Zod, Vitest, shadcn/ui + sonner.

**Spec:** `docs/superpowers/specs/2026-10-26-jubelio-v2-stock-images-design.md`

## Global Constraints

- A customer must NEVER see a Jubelio number — storefront files (`src/app/(storefront)/**`, `src/server/checkout.ts`, orders routes) get zero copy/logic changes.
- No DB migrations, no schema change; `session_products.jubelio_stock` stays `integer notNull default 0`. NEVER run `pnpm db:push`/`db:migrate`.
- No query params on `/inventory/items/masters` (upstream 400). v2 is fetched at `/inventory/v2/?page=1&page_size=2000` with `Bearer ${coreToken}` via the existing `request()` helper.
- v2-only failure NEVER fails the catalog route or the picker: every row merges `stock: null, image: null` (plate honesty). Masters failure keeps today's route error contract verbatim.
- `jubelioStock` writer rule: a missing v2 number NEVER overwrites a stored number with 0 (update path keeps previous; new-row path skips the row — partner ruling).
- Derived quota floor: `Math.max(0, Math.min(20, available))` — never negative.
- Negative `available` (live data has 4, min −14) is shown RAW on admin surfaces.
- Plain `<img>` + `eslint-disable-next-line @next/next/no-img-element` for CDN thumbs; letter tile is the null-image fallback.
- Toast copy is Indonesian, matching existing picker strings.
- Full suite: `node_modules/.bin/vitest run --exclude ".claude/**"`. Types: `node_modules/.bin/tsc --noEmit`. Lint changed files: `node_modules/.bin/next lint --file <path>`.
- Use `yarn` (never npm/pnpm/bun) for any package command.

## Review Focus

(Each line is pinned by a named test in the owning task.)

1. v2 payload rows with missing `item_id`, non-numeric `item_id`, absent `total_stocks`, or non-numeric `available` — must be skipped silently by the mapper, never crash or poison the map with `NaN` keys (Task 1, "skips junk rows").
2. Re-adding an existing roster row while v2 is down must keep BOTH previous `jubelio_stock` and previous `session_quota` (admin edits survive an ERP outage) (Task 5, "keeps previous values").
3. Whole-v2 outage during POST → `{ ok: true, products: [], skipped: […all…] }` with 201, not 502; the client shows the skip toast and the row stays "+ Tambah" (Task 5, "all-rows-skipped").
4. Roster page with v2 down or `item_id` absent → every stock cell renders `—` and tiles stay letters; no page crash, no stale-column values shown (Task 7, "null map").
5. The v2 merge must never drop catalog rows: itemIds absent from the v2 map survive with `stock: null, image: null` (Task 2, "absent SKU").

---

### Task 1: v2 client method + `toStockMap` mapper + `PickerRow.image`

**Files:**
- Modify: `src/lib/jubelio.ts` (types block ~line 95-108, `toPickerRows` ~172+, `createJubelioClient` ~256-281)
- Test: `tests/jubelio.test.ts` (extend)

**Interfaces:**
- Consumes: existing `request()`, `numberValue()`, `toPickerRows`.
- Produces:
  - `export type StockEntry = { available: number; image: string | null }`
  - `export function toStockMap(raw: unknown): Map<number, StockEntry>`
  - `client.listStockV2(): Promise<unknown>` (GET `/inventory/v2/?page=1&page_size=2000`)
  - `PickerRow` gains required `image: string | null`; `toPickerRows` emits `image: null` (merge fills it in Task 3).

- [ ] **Step 1: Failing tests in `tests/jubelio.test.ts`** — `describe("toStockMap")`:

```ts
it("maps the {data:[…]} envelope keyed by item_id", () => {
  const map = toStockMap({ data: [v2Row({ item_id: 2685, total_stocks: { available: 12 }, thumbnail: "https://cdn/thumb.jpg" })] });
  expect(map.get(2685)).toEqual({ available: 12, image: "https://cdn/thumb.jpg" });
});
it("tolerates a bare array payload", () => { /* expect(map.size).toBe(1) */ });
it("passes negative available through raw", () => { /* −14 → available: -14 */ });
it("keeps rows with absent/null thumbnail as image: null", () => {});
it("skips junk rows: missing/non-numeric item_id, absent total_stocks, non-numeric available", () => {
  const map = toStockMap({ data: [
    { item_id: "abc", total_stocks: { available: 5 } },
    { total_stocks: { available: 5 } },
    { item_id: 7 },
    { item_id: 8, total_stocks: { available: "lots" } },
    null, "string",
  ] });
  expect([...map.keys()]).toEqual([]);
});
it("accepts a numeric-string available (decimal-string tolerance like prices)", () => { /* "14.0000" → 14 */ });
```

Plus a `describe("listStockV2")` pin inside the existing `createJubelioClient` describe:

```ts
it("GETs /inventory/v2/ with pagination params and Bearer header", async () => {
  // stub fetch as siblings do; assert url === `${API}/inventory/v2/?page=1&page_size=2000`
  // and Authorization: `Bearer ${TOKEN}`.
});
```

- [ ] **Step 2: Run** `node_modules/.bin/vitest run tests/jubelio.test.ts` — Expected: FAIL, `toStockMap`/`listStockV2` not exported.
- [ ] **Step 3: Implement** in `src/lib/jubelio.ts`: `StockEntry`; `toStockMap` (envelope-tolerant like `toPickerRows`: bare array or `{data}`; row fields `item_id`, `thumbnail`, `total_stocks.available`; `available` accepted via the existing finite-number/decimal-string coercion, reject `NaN`/non-finite; absent `thumbnail` or non-string → `image: null`); `listStockV2` on the client; add `image: string | null` to `PickerRow` with doc comment ("v2 `thumbnail`, merged server-side; null → letter tile") and `image: null` in `toPickerRows` output (both the per-variant rows and the `itemId 0` fallback row). Update the stale `stock` doc comments on `PickerRow`/`toPickerRows`: the source is v2 `total_stocks.available`, merged by the route; `toPickerRows` alone still emits `stock: null`.
- [ ] **Step 4: Run** `node_modules/.bin/vitest run tests/jubelio.test.ts` — Expected: PASS.
- [ ] **Step 5: Typecheck** `node_modules/.bin/tsc --noEmit` — Expected: errors ONLY in files that construct `PickerRow`/mirror rows and are owned by later tasks (`tests/jubelio-products-route.test.ts` object-equality pins, `product-picker.tsx` if it constructs PickerRow — check; roster page constructs `SessionProduct`, not PickerRow). If `tests/jubelio-products-route.test.ts` fails the `toEqual` row pins (missing `image`), update those literals NOW (add `image: null`) — they are Task 3's fixtures moving forward; note it in the commit.
- [ ] **Step 6: Commit** `feat(jubelio): add v2 stock client method and toStockMap mapper` (+ `Co-Authored-By: Claude Code <noreply@anthropic.com>`).

### Task 2: Catalog module — second cache entry + merge helper

**Files:**
- Modify: `src/server/jubelio-catalog.ts` (whole file, 41 lines today)
- Test: `tests/jubelio-catalog.test.ts` (extend; keep existing cases green)

**Interfaces:**
- Consumes: `client.listStockV2`, `toStockMap`, `StockEntry`, `PickerRow` (Task 1).
- Produces:
  - `export type StockMap = Map<number, StockEntry>`
  - `export async function getStockMap(client: JubelioClient): Promise<StockMap>` — 60 s TTL entry with the SAME semantics as the masters entry: promise-dedupe within TTL, failure unpoisons immediately, `__resetCatalogCache()` clears both.
  - `export function mergeStockIntoRows(rows: PickerRow[], map: StockMap | null): PickerRow[]` — pure; returns new array; per row `{ …row, stock: entry?.available ?? null, image: entry?.image ?? null }`; `map === null` → all rows null/null.

- [ ] **Step 1: Failing tests** in `tests/jubelio-catalog.test.ts` (follow its `stubClient` pattern — extend the stub with `listStockV2` returning a v2 envelope):

```ts
describe("getStockMap", () => {
  it("dedupes within the TTL: two calls, one listStockV2 fetch", async () => {});
  it("unpoisons on failure: rejected fetch is not replayed for the TTL", async () => {});
  it("caches independently of the masters entry (masters hit still serves fresh v2 map)", async () => {});
  it("__resetCatalogCache clears both entries", async () => {});
});
describe("mergeStockIntoRows", () => {
  it("joins stock + image by item_id", () => {
    expect(mergeStockIntoRows([pickerRow(2685)], new Map([[2685, { available: 12, image: "u" }]]))[0])
      .toMatchObject({ stock: 12, image: "u" });
  });
  it("Review Focus 5 — absent SKU keeps the row with null stock/image", () => { /* map without 2685 → stock null image null, row count unchanged */ });
  it("null map → every row null/null, rows survive", () => {});
});
```

- [ ] **Step 2: Run** `node_modules/.bin/vitest run tests/jubelio-catalog.test.ts` — Expected: FAIL (`getStockMap` not exported).
- [ ] **Step 3: Implement** — duplicate the existing entry block for v2 (`stockEntry: { expiresAt, promise: Promise<StockMap> } | null`, same 60 000 ms constant, same `promise.catch` unpoison guarded on identity). A single `cached<T>(slotKey)` factory is the cleaner shape IF both slots stay byte-identical in semantics; either way both entries reset. `mergeStockIntoRows` as specified.
- [ ] **Step 4: Run** `node_modules/.bin/vitest run tests/jubelio-catalog.test.ts` — Expected: PASS (all, including pre-existing masters cases).
- [ ] **Step 5: Commit** `feat(jubelio): cache v2 stock map and expose picker-row merge helper`.

### Task 3: `/api/jubelio/products` merge + failure semantics

**Files:**
- Modify: `src/app/api/jubelio/products/route.ts:22-37`
- Test: `tests/jubelio-products-route.test.ts` (extend; `vi.mock("@/server/jubelio-catalog")` gains `getStockMap`)

**Interfaces:**
- Consumes: `getCatalogRows`, `getStockMap`, `mergeStockIntoRows` (Task 2).
- Produces: route response = merged `PickerRow[]` (now carrying real `stock`/`image`); error contract unchanged for masters.

- [ ] **Step 1: Failing tests:**

```ts
it("200 with v2-joined stock + image on every row", async () => {
  // getCatalogRows → [{itemId: 1, …}], getStockMap → Map([[1, {available: 12, image: "u"}]])
  // expect body[0] toMatchObject({ stock: 12, image: "u" })
});
it("v2-only failure still 200: rows keep null stock/image (plate honesty)", async () => {
  // getStockMap.mockRejectedValue(new JubelioError(500,…)); expect 200, row stock null, image null
});
it("masters failure keeps the error contract (401 SESSION_EXPIRED pin still authoritative)", async () => {
  // getStockMap resolves normally; getCatalogRows rejects JubelioError 401 → expect 401 SESSION_EXPIRED
});
```

- [ ] **Step 2: Run** `node_modules/.bin/vitest run tests/jubelio-products-route.test.ts` — Expected: FAIL (route ignores `getStockMap`; `owner`/fixture rows may also need the Task-1 `image: null` pin updates from its Step 5 if not done).
- [ ] **Step 3: Implement** — replace the single `await getCatalogRows(...)` with:

```ts
const [rowsRes, mapRes] = await Promise.allSettled([
  getCatalogRows(client),
  getStockMap(client),
]);
if (rowsRes.status === "rejected") throw rowsRes.reason; // existing catch: auth/4xx/502 contract
return Response.json(mergeStockIntoRows(rowsRes.value, mapRes.status === "fulfilled" ? mapRes.value : null));
```

(One `createJubelioClient` instance feeds both calls; the existing `catch (e)` block below stays untouched.)

- [ ] **Step 4: Run** `node_modules/.bin/vitest run tests/jubelio-products-route.test.ts` — Expected: PASS, all pre-existing pins too.
- [ ] **Step 5: Full suite + lint** — `node_modules/.bin/vitest run --exclude ".claude/**"` then `node_modules/.bin/next lint --file src/app/api/jubelio/products/route.ts` — Expected: green, clean.
- [ ] **Step 6: Commit** `feat(jubelio): serve picker catalog with live v2 stock and thumbnails`.

### Task 4: Picker search rows — thumbnail + stock cells

**Files:**
- Modify: `src/app/_components/product-picker.tsx` (`SearchResult` ~49-62, search row render ~976-1023, `catalogRow` fixtures in `tests/product-picker.test.ts`)
- Per project CLAUDE.md, invoke `/frontend-design:frontend-design` BEFORE writing markup.

**Interfaces:**
- Consumes: merged rows from Task 3 (`stock: number | null`, `image: string | null` now real on the wire).
- Produces: `SearchResult` with required `image: string | null` and truthful `stock` doc comment; the rendered row cell layout Task 5's screenshots reference.

- [ ] **Step 1: Update `tests/product-picker.test.ts`** `catalogRow` helper to emit `image: null` and any new required field so the file compiles; NO behavior change asserted (filterCatalog ignores image/stock — the existing "never matches on price or stock digits" test stays the pin).
- [ ] **Step 2: Run** `node_modules/.bin/vitest run tests/product-picker.test.ts` — Expected: PASS (fixtures compile-matched; if `SearchResult.image` is not yet added this FAILS on typecheck inside vitest? vitest runs esbuild without type errors — so instead verify: PASS).
- [ ] **Step 3: Implement UI** — (a) `SearchResult += image: string | null` (keep the "Mirrors PickerRow" comment honest); (b) search-row thumb: `r.image ? <img src={r.image} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" /* eslint-disable-next-line @next/next/no-img-element above */ /> : existing letter tile` — reuse the exact `label.charAt(0).toUpperCase()` tile markup; (c) stock meta cell in the SKU/price line: `<span className="font-mono tabular-nums">{r.stock ?? "—"}</span>` with an inline `Sisa` label? NO — follow the existing meta idiom: badge + struck price + stock as a third element `{`Stok ${r.stock ?? "—"}`}` in the same `text-[10px] font-mono` row; negative shows raw `-14`.
- [ ] **Step 4: Verify** `node_modules/.bin/tsc --noEmit` && `node_modules/.bin/next lint --file src/app/_components/product-picker.tsx` && `node_modules/.bin/vitest run tests/product-picker.test.ts` — Expected: all green, lint clean (the `no-img` disable comment is the sanctioned pattern).
- [ ] **Step 5: Commit** `feat(picker): show v2 thumbnails and ERP stock on search rows`.

### Task 5: POST import — v2 source, skip guard, quota floor

**Files:**
- Modify: `src/app/api/sessions/[id]/products/route.ts` (drop `liveStock` ~20-32, rework POST ~104-181)
- Modify: `src/app/_components/product-picker.tsx` `add()` ~801-835 (skip consumption + toast)
- Test: Create `tests/session-products-post.test.ts`

**Interfaces:**
- Consumes: `getStockMap`, `StockEntry` (Tasks 1-2); `inArray` from `drizzle-orm`.
- Produces:
  - `export type ResolvedImport = { jubelioStock: number; sessionQuota: number }`
  - `export function resolveImportRow(entry: StockEntry | undefined, existing: { jubelioStock: number; sessionQuota: number } | undefined): ResolvedImport | null` (pure, exported from the route file for tests — same convention as `toPickerRows` being exported for unit tests)
  - POST response: `{ ok: true, products: <drizzle rows>, skipped: { itemId: number; skuCode: string; itemGroupName: string }[] }` with status 201 (`skipped: []` on happy path — ADDITIVE, never breaks the existing `{ok, products}` consumers).

`resolveImportRow` rules (pinned by tests):
1. `entry` present → `{ jubelioStock: entry.available, sessionQuota: Math.max(0, Math.min(20, entry.available)) }` — negative `available` floors quota at 0, stores negative stock (gate ≤0 = sold out, correct).
2. no `entry`, `existing` present → `{ jubelioStock: existing.jubelioStock, sessionQuota: existing.sessionQuota }` (Review Focus 2 — outage must not zero a live number or clobber admin quota edits).
3. no `entry`, no `existing` → `null` = skip (partner ruling: block no-number new rows).

POST orchestration changes:
- `const client = createJubelioClient(auth.user.token)`; then `let map: StockMap | null` via `await getStockMap(client)` in try/catch: `isJubelioAuthError` → 401 SESSION_EXPIRED (unchanged); any other throw → `map = null` (NO 502 — every new row will skip, Review Focus 3).
- Fetch existing rows once: `db.select({ itemId, jubelioStock, sessionQuota }).from(sessionProducts).where(and(eq(sessionProducts.sessionId, id), inArray(sessionProducts.itemId, items.map(i => i.itemId))))`.
- For each input: `const resolved = resolveImportRow(map?.get(input.itemId), existingByItem.get(input.itemId))`; `null` → push to `skipped`, DO NOT insert; else insert with `values`/`onConflictDoUpdate.set` using `jubelioStock: resolved.jubelioStock, sessionQuota: resolved.sessionQuota` and the SAME remaining fields as today (`skuCode`/`itemGroupName`/`originalPrice`/`flashPrice: input.originalPrice`/`minOrder: 1`/`category: ""` — re-add with a number keeps resetting quota to the derived value, per spec's "one truth per pipeline").
- Response gains `skipped`. The `Promise.all(inserts)` try/catch and its 502 path stay for genuine db failures.
- Delete `liveStock`.

`add()` client changes:
- Response type widens: `{ ok?, products?, skipped?: { itemId: number; skuCode?: string }[], error? }`.
- After the existing `!res.ok || !data?.ok` guard: if `skipped?.length` → `toast.error(`${skipped.length} produk dilewati — stok belum bisa dicek di ERP, coba lagi.`)`, merge only `data.products` (empty on the single-toggle case → roster unchanged → button stays "+ Tambah"); only toast success when ≥1 product merged.

- [ ] **Step 1: Failing tests** `tests/session-products-post.test.ts`:

```ts
describe("resolveImportRow", () => {
  it("v2 number → stock + floored quota", () => {
    expect(resolveImportRow({ available: 5000, image: null }, undefined))
      .toEqual({ jubelioStock: 5000, sessionQuota: 20 });
  });
  it("negative available → raw negative stock, quota floors at 0", () => {
    expect(resolveImportRow({ available: -14, image: null }, undefined))
      .toEqual({ jubelioStock: -14, sessionQuota: 0 });
  });
  it("Review Focus 2 — no number, existing row keeps BOTH previous stock and quota", () => {
    expect(resolveImportRow(undefined, { jubelioStock: 37, sessionQuota: 5 }))
      .toEqual({ jubelioStock: 37, sessionQuota: 5 });
  });
  it("no number, no existing → null (skip, partner ruling)", () => {
    expect(resolveImportRow(undefined, undefined)).toBeNull();
  });
});
```

Plus route-level `describe("POST /api/sessions/[id]/products")` with `vi.mock` of `@/server/better-auth/server`, `@/server/jubelio-catalog`, `@/server/db` (thenable builder mock — copy the `session-query.test.ts` mock shape; `insert(...).values(v).onConflictDoUpdate(...).returning()` resolves `[rowEchoing(v)]` and records `v`):

```ts
it("Review Focus 3 — v2 down: 201, ok:true, products empty, every new item skipped, zero inserts", …);
it("skips ONLY the no-number rows; numbered rows insert", …);
it("401 SESSION_EXPIRED when getStockMap rejects with an auth error", …);
```

- [ ] **Step 2: Run** `node_modules/.bin/vitest run tests/session-products-post.test.ts` — Expected: FAIL (`resolveImportRow` not exported, old route ignores skips).
- [ ] **Step 3: Implement** route + `add()` as specified above.
- [ ] **Step 4: Run** `node_modules/.bin/vitest run tests/session-products-post.test.ts` — Expected: PASS.
- [ ] **Step 5: Full suite** `node_modules/.bin/vitest run --exclude ".claude/**"` + `node_modules/.bin/tsc --noEmit` + `next lint --file` on both changed files — Expected: green (the pre-existing 502 test in `jubelio-products-route.test.ts` must NOT change — different route).
- [ ] **Step 6: Commit** `feat(sessions): import guard — v2-numbered rows only, quota floor 0`.

### Task 6: Retire the dead by-sku readers

**Files:**
- Modify: `src/app/api/sessions/[id]/products/route.ts` GET (~46-92)
- Modify: `src/app/api/sessions/[id]/products/[itemId]/route.ts` GET (~49-87)

**Interfaces:**
- Consumes: `getStockMap`, `StockMap`.
- Produces: both GETs compute `availableStock` from the v2 map (`map.get(row.itemId)?.available ?? null`); `getStockBySku` remains exported in the lib (spec non-goal: not deprecated) but has zero route callers.

- [ ] **Step 1: Implement list GET** — fetch the map once inside the existing try (`getStockMap(client)`; auth error → 401 as today; non-auth v2 error → today's 502 "Gagal memuat stok, coba lagi" message stays for THIS endpoint because live stock IS its purpose — keep it simple: let the existing catch do it); replace `await liveStock(client, row.skuCode)` with the map lookup. Delete the now-unused `liveStock` import/`toAvailableStock` usage if unused in this file.
- [ ] **Step 2: Implement single GET** — swap the `row.skuCode` by-sku block for: `const map = await getStockMap(client)` with the SAME failure semantics as today (`isJubelioAuthError` → 401 SESSION_EXPIRED, other errors → `availableStock = null`); then `map.get(itemId)?.available ?? null`.
- [ ] **Step 3: Verify by grep** `rg -n "getStockBySku|liveStock" src/app` — Expected: zero matches under `src/app` (lib + its test + comments only).
- [ ] **Step 4: Verify** `node_modules/.bin/vitest run --exclude ".claude/**"` && `node_modules/.bin/tsc --noEmit` && lint both files — Expected: green (these routes have no test consumers — grep `tests/` for their paths to confirm nothing breaks; the verification is the grep + suite + tsc).
- [ ] **Step 5: Commit** `refactor(sessions): live stock readers join the v2 cache`.

### Task 7: Admin roster live join

**Files:**
- Create: `src/server/roster-products.ts`
- Modify: `src/app/admin/sessions/[id]/products/page.tsx:30-60`
- Test: Create `tests/roster-products.test.ts`

**Interfaces:**
- Consumes: `getStockMap`, `StockMap`; `getSession` from `@/server/better-auth/server`; `createJubelioClient`; `SessionProduct` type from the picker component.
- Produces: `export function rosterProducts(rows: RosterDbRow[], map: StockMap | null): SessionProduct[]` where `RosterDbRow` is the drizzle row shape the page selects today (`sessionProducts` full row) — pure mapping, page stays thin.

- [ ] **Step 1: Failing tests** `tests/roster-products.test.ts`:

```ts
it("joins availableStock + image from the v2 map by itemId", () => { /* entry {available: 42, image: "u"} → availableStock 42, image "u" */ });
it("Review Focus 4 — null map → availableStock: null, image: null on every row", () => {});
it("SKU absent from map → that row null/null, others keep their numbers", () => {});
it("carries the DB fields through unchanged (id, quota, claimed, prices, category, type)", () => {});
it("never emits the stale jubelioStock column as availableStock when the map has a DIFFERENT number", () => {
  // row.jubelioStock = 3, map says available 1 → availableStock 1 (parity beats snapshot)
});
```

- [ ] **Step 2: Run** `node_modules/.bin/vitest run tests/roster-products.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `rosterProducts` + rewire the page: after `rows` load, `const auth = await getSession(); const map = auth ? await getStockMap(createJubelioClient(auth.user.token)).catch(() => null) : null;` then `const products = rosterProducts(rows, map);`. Replace the `availableStock: row.jubelioStock` block comment with the parity note. `notFound()`/guard behavior otherwise unchanged; no storefront file touched.
- [ ] **Step 4: Run** `node_modules/.bin/vitest run tests/roster-products.test.ts` — Expected: PASS.
- [ ] **Step 5: Full suite + tsc + lint** (page file, new module) — Expected: green.
- [ ] **Step 6: Commit** `feat(admin): roster shows dashboard-current stock and thumbnails`.

### Task 8: Spec close-out + ledger docs

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-jubelio-v2-stock-images-design.md` (append "Implemented: <commit range>")

- [ ] **Step 1:** Update spec header/status line with the branch's final commit range.
- [ ] **Step 2: Full verification** `node_modules/.bin/vitest run --exclude ".claude/**"` && `node_modules/.bin/tsc --noEmit` && `node_modules/.bin/next build` — Expected: green build (manual browser pass is the partner's: picker thumbs + stock parity vs dashboard tab).
- [ ] **Step 3: Commit** `docs(jubelio): mark v2 stock+images spec implemented`.
