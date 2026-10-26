# Admin Console & Jubelio Product Import — Feedback Round Design

Date: 2026-10-26
Status: draft (pending partner approval)
Source: partner feedback on the previous feature branch (6 items)

## Intent and why

The admin currently cannot import products from Jubelio at all — every search
request 502s, verified live. That kills the core workflow of the last feature.
On top of that, the console doesn't answer the questions an operator actually
has when opening it: is a session live right now, is anything waiting on me,
how are sales going today — and the session list has no ordering or filtering,
so finding the latest session is guesswork.

Success looks like: open the console, immediately see live state and pending
work without clicking; type "Sepeda" in the product picker and see matching
Jubelio products within about a second.

## Current state (verified by live probes and code read, 2026-10-26)

- `GET /api/jubelio/products?search=...` always fails. Three stacked bugs, all
  in our code (credentials are fine — login returns 200, company 59325):
  1. Upstream `GET https://open.jubelio.com/core-api/inventory/items/masters`
     rejects **all** query params (`search`, `name`, `sku`, `keyword`,
     `searchtext` → 400 `"search" is not allowed`). Our route's catch-all
     masks any non-401 upstream error as a 502
     (`src/app/api/jubelio/products/route.ts:32-34`).
  2. Base URL default ends with `/` (`src/env.js:29-32`, `JUBELIO_BASE_URL`
     unset) and the path starts with `/`, producing `core-api//inventory/...`
     → 404 (`src/lib/jubelio.ts:45`). So even requests without `search` fail.
  3. Upstream returns `{ data: [...], totalCount }`; our `toPickerRows`
     expects a top-level array and the wrong field names. Actual item keys
     include `item_group_id`, `item_name`, `sell_price` (string), and
     `variants` / `variations` (`src/lib/jubelio.ts:126-139`).
- Two buttons open the same picker dialog with different labels and colors:
  `+ Pilih Produk Jubelio` (variant `ink`, `product-picker.tsx:834`) and
  `Import dari Jubelio` (variant `brand`, `product-picker.tsx:629-631`, inside
  `EmptyRoster`). Same trigger `openPicker`.
- Search input in the picker already debounces via a manual `setTimeout`
  (300 ms) in a `useEffect` (`product-picker.tsx:684-727`). The lag the partner
  felt was the 502, not missing debounce.
- `src/app/admin/page.tsx:134-137` selects sessions with **no `orderBy`**;
  same for `src/app/admin/orders/page.tsx:31`.
- Session status is a manual enum `SCHEDULED | ACTIVE | PAUSED | ENDED`
  (`src/server/db/schema.ts:39-44`), transitioned via explicit API routes
  (`activate|pause|resume|end`). Nothing auto-transitions on time; there is no
  derived "soon/active/ended" classification.
- No summary/KPI UI anywhere. `KpiTile` and `KpiRow` exist but are file-local
  in `admin/page.tsx:36-124`; `getSessionKpis` (`src/server/session-query.ts:47+`)
  already computes productCount, totalQuota, totalClaimed, estimatedGmv per
  session. `recharts@3.8.0` and a shadcn `chart.tsx` wrapper are installed but
  unused.
- Filter precedent to reuse: `src/app/_components/filter-pill.tsx` +
  `admin-orders-filter.tsx` (client-side "ALL" + status chips).
- Schema fields usable for KPIs: `orders` (status enum `UNPAID|CONFIRMED|SHIPPED|COMPLETED`,
  `grandTotal`, `paymentMethod`, `transferProofUrl`, `createdAt`),
  `orderItems`, `sessionProducts` (`sessionQuota`, `claimed`, `flashPrice`),
  `user` (role enum incl. `CUSTOMER`), `flashSessions`.

## Goals

1. Product search/import from Jubelio works end-to-end, fast and with honest
   errors.
2. One consistent button for opening the picker.
3. Console session list ordered newest-first; orders list likewise.
4. Session filter tabs on the console.
5. Global KPI row on the console; status count strip on the pesanan page.
6. Keep the existing debounce behavior; search must feel instant once it hits
   a local filter instead of the network.

## Non-goals

- Trend/time-series charts (recharts stays unused this round; add later once
  order volume makes trends meaningful).
- Payment-method breakdown, customer analytics.
- Automatic session status transitions (enum stays manual; a SCHEDULED session
  past its start time remains SCHEDULED).
- Jubelio write operations, stock sync changes, or checkout flow changes.
- Any DB schema change — every needed column already exists, so no
  `db:generate`/`db:push` at all.

## Anti-goals

- KPI tiles that describe but don't act — every tile must be clickable to the
  thing it counts or link to the session it names.
- Inventing new UI idioms when `filter-pill`, `KpiTile`/`KpiRow`, and shadcn
  base components already cover it.
- Masking upstream errors as blanket 502s again.
- Two labels/variants for one trigger.

## Decisions

### 1. Jubelio products (`src/lib/jubelio.ts`, `src/app/api/jubelio/products/route.ts`)

- The upstream items endpoint supports no query params, so **server-side
  search is dropped from this route**. The route fetches the full item list
  from `/inventory/items/masters` (paginating if needed), unwraps `data`, and
  maps items to picker rows using the actual field names
  (`item_name`, `item_group_id`, `sell_price` string→number,
  variants/variations for product type).
- Results are cached server-side in a module-level store with a short TTL
  (~60 s) so picker opens don't re-hit Jubelio. Best-effort: if the deploy
  target fans out serverless instances, a cold instance just pays one full
  fetch (~1.7 s) — acceptable, and no shared cache store is allowed under the
  no-schema-change constraint (my call; veto welcome).
- The picker filters **client-side** by name/SKU substring, case-insensitive.
  The existing 300 ms debounce stays (extract to a small `useDebouncedValue`
  hook for clarity — my call).
- URL joining: normalize by stripping the base's trailing slash (and/or
  default `JUBELIO_BASE_URL` without one). Empty-string `search=` must never
  be forwarded (moot after the change, but the param handling gets cleaned up).
- Error honesty: propagate known upstream statuses/messages instead of a
  blanket 502; 401 keeps the existing `signOutOnExpiry` path.
- Fetch-all is confirmed viable by live probes (2026-10-26): catalog
  `totalCount` = **573**, raw payload ~2.3 MB / ~1.7 s. The endpoint rejects
  **every** pagination/search param (`page`, `limit`, `per_page`, `count`,
  `offset` all → 400). Server maps the 2.3 MB down to slim rows (~60 KB)
  before returning to the client.
- Verified field mapping (masters payload): top level `item_name`, `sell_price`
  (string), `item_group_id`, `thumbnail`; `variants` is a **JSON-encoded
  string** whose entries carry `item_id`, `item_code` (= SKU, e.g.
  `[SLA]UA000044N`), `is_bundle`, `sell_price`, `variation_values`. There is
  **no** `item_id`/`sku_code`/`item_group_name`/`stock` at top level. SKU
  search filters against `variants[].item_code`; display column uses
  `item_name` (the picker's `itemGroupName` column is redundant — group name
  only exists on the single-item endpoint and equals the item name there).
- Stock — live probe findings: `POST /inventory/items/all-stocks/` is broken
  for the system account (`{}` → 500 code 42601; `{location_id:1}` → 400
  `"location_id" is not allowed` — so the current `listStock()` never worked),
  and the working `GET /inventory/items/by-sku/{sku}` returns `end_qty: null`
  in `product_skus`. There is **no reliable list-scale stock source** found.
  Default (pending partner answer below): drop the stock column, keep the
  em-dash-capable `PickerRow.stock = null`, and fix the dialog copy that
  promises "Cek stok real-time dari seluruh gudang".

### 2. Button consistency (`product-picker.tsx`)

- Single label everywhere: **"Pilih Produk Jubelio"**, single variant (`ink`).
  The `EmptyRoster` button adopts the same label and variant. "Import dari
  Jubelio" wording is removed. (Label choice is my call from the two existing;
  partner veto welcome.)

### 3. Console ordering + filter tabs (`admin/page.tsx`)

- `db.select().from(flashSessions).orderBy(desc(flashSessions.createdAt))` —
  newest-created session first, so the last session created is always on top.
  Orders page gets the same `orderBy` on `createdAt` desc.
- Tabs above the session list: **Semua / Terjadwal / Aktif / Dijeda / Selesai**
  mapping to `ALL | SCHEDULED | ACTIVE | PAUSED | ENDED`. Partner asked for a
  suggestion of filters; this enum-mapped set is my proposal (their words were
  "all, soon, active and ended something like that but you can suggest").
  Client-side filtering via the existing `filter-pill` pattern (matches the
  orders-page precedent), with a count badge per tab.
- Indonesian labels match existing UI copy.

### 4. KPI row on the console

Four tiles, server-computed at page render, placed above the session list.
`KpiTile`/`KpiRow` are exported to shared components (`src/app/_components/`)
and reused — both the file-local ones and the per-session rows below.

1. **Perlu Konfirmasi** — count of orders `status = UNPAID` **and**
   `transferProofUrl IS NOT NULL`. Click → orders page landing on the
   "Belum Bayar" tab showing **all** UNPAID (partner decision: superset is
   fine; tile subtitle gives the context, e.g. "X dari total Y belum bayar").
   This requires URL-driven initial tab in the orders filter (e.g.
   `/admin/orders?status=UNPAID`) — the strip reads `?status=` on mount.
   Red/brand accent when > 0; muted when zero.
2. **GMV Hari Ini** — `SUM(grandTotal)` of orders with status in
   `CONFIRMED | SHIPPED | COMPLETED` created today. Subtitle: delta vs
   yesterday (e.g. "+12% vs kemarin"). Day boundary = Asia/Jakarta (WIB) —
   my call; builder follows any existing date-format helper if one encodes tz.
3. **Sesi Aktif** — if an `ACTIVE` session exists: its name + start time,
   click → that session. Else: "Tidak ada" + next `SCHEDULED` session name and
   start time.
4. **Klaim vs Kuota** — `SUM(claimed) / SUM(sessionQuota)` across products of
   `ACTIVE + SCHEDULED` sessions; shown as `n / m` + percentage with a thin
   progress bar.

### 5. Status strip on pesanan page (`admin/orders/page.tsx`)

- Above the transaction list: pills `Semua / Belum Bayar / Terkonfirmasi /
  Dikirim / Selesai` (`ALL|UNPAID|CONFIRMED|SHIPPED|COMPLETED`) with live
  counts; clicking a pill filters the list (replaces/absorbs the existing
  `AdminOrdersFilter` status chips — builder merges, doesn't stack two filter
  rows).

### Interaction & feedback rules (project CLAUDE.md)

- Any API-triggering button shows loading state via base `Button isLoading`.
- Picker search failures surface a `sonner` toast with the real upstream
  message (per decision 1).
- KPI/status computations run server-side in the RSC; no client fetching added
  for tiles. Filter tabs are pure client-side state like the existing orders
  filter.

## Constraints

- No DB migrations (no schema change). Only `db:generate` is ever run by an
  agent, and it isn't needed here.
- Yarn for scripts.
- Reuse shadcn base components; match existing console visual language (the
  "Konsol" page's panel/ink styling).
- UI copy in Indonesian, consistent with existing strings.
- Existing tests (`tests/`) pattern: add unit tests for the item mapper and
  route error propagation; no E2E mandate.

## Open to the builder

- Deriving product type `single|variable|bundle` from `variants[].is_bundle`
  + variant count — mapping mechanics only, fields are now known.
- Merging the orders status strip into `AdminOrdersFilter` without regressing
  its current behavior.
- Timezone/day-boundary helper choice for GMV-today.
- Per-call caching/retry mechanics inside the route (fields and sizes are now
  known).

## Pending partner answers (2026-10-26 builder check)

1. **Stock column** — partner is asking their Jubelio dev contact. Questions
   to relay (all verified live 2026-10-26 with Bearer token, company 59325):
   - `POST /core-api/inventory/items/all-stocks/`: empty body `{}` → 500
     (code 42601); `{"location_id":1}` → 400 `"location_id" is not allowed`;
     `{"warehouse_id":1}` → 400 not allowed; `?location_id=1` as query → 500.
     **Ask: the correct request payload schema + a sample response.**
   - `GET /core-api/inventory/items/by-sku/{sku}` works but every
     `product_skus[].end_qty` is null. **Ask: how to get actual available
     qty — parameter, different endpoint, or store-scoped API?**
   - `/core-api/inventory/items/masters` rejects **all** query params
     (search, pagination). **Ask: is there a search-capable item endpoint?**
     (Fetch-all works at 573 items, so this is nice-to-have.)
   - **Ask: which API lists warehouse/location IDs for this company?**
   Build proceeds with the default (stock column dropped, dialog copy fixed —
   `PickerRow.stock` stays nullable so a working source can be re-added later
   without UI rework).
2. ~~"Perlu Konfirmasi" tile click semantics~~ — **answered 2026-10-26**:
   lands on all-UNPAID "Belum Bayar" tab; folded into decision 4.
