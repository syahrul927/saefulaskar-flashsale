# Jubelio v2 stock + images — Design

Date: 2026-10-26
Branch context: follow-on to `2026-10-26-admin-console-feedback-design.md` (whose "pending partner answers" item 1 this spec resolves with live evidence).

## Intent

The admin picks flash-sale products while the Jubelio v2 dashboard (`v2.jubelio.com` inventory page) is open in another tab. Today our app shows neither a product image nor a stock number — the picker's stock column was deleted last round ("no working upstream stock source") and `SessionProduct.image` has never been populated, so every thumb is the amber letter tile. The admin's trust test is parity: **the number and picture in our app must be what the dashboard shows them, within the last minute.**

Two distinct numbers exist and must not be conflated (partner's words):

- **Jubelio stock** — ERP `available` per SKU. Admin surface only.
- **Quota sell** — the number the admin set per session product (`session_products.session_quota`, minus `claimed`). What the **customer** sees. Customers never see Jubelio stock.

## Verified live 2026-10-26 (probe evidence)

- `GET {core-api}/inventory/v2/` is the dashboard's own endpoint. **It accepts query params** (`q`, `page`, `page_size`, `is_bundle`, `is_consignment`, `location_ids[i]`) — the "rejects all params" finding was specific to `/inventory/items/masters`.
- Our system core token (`POST {JUBELIO_HOST}/login`, `Authorization: Bearer …`) works on v2 — verified 200 with identical results to the partner's dashboard JWT.
- `page_size=2000` returns the **entire catalog: 1775 SKU rows in one request** (~2.3 MB raw, 1.7 s cold). No pagination loop needed.
- Rows are SKU-level: `item_id`, `item_code`, `item_name`, `is_bundle`, `thumbnail`, `total_stocks.{on_hand,on_order,reserved,available}`, `location_stocks[]`, `last_cogs`, `average_cost`. **No sell price** — masters remains the price source.
- `item_id` domain matches masters `variants[].item_id` (v2 result set was a superset-consistent join in the "controller" comparison: v2 rows ⊂ masters variant rows; the 7 `[dus]` rows the dashboard curl excluded were `is_bundle=true` only because the curl asked so).
- `total_stocks.available`: **numeric for all 1775 rows, zero nulls**, 4 negatives (min −14), max 58 694; `thumbnail` present on every row.
- `q=controller` server-side search returned 81 rows; our client-side filter over masters returned the same 81 plus the 7 bundles — search semantics are equivalent (substring on name/SKU).

## Decisions

### 1. v2 becomes the stock + image source; masters stays the price source

`GET /api/jubelio/products` (our route) merges two cached upstream reads into one response per picker row:

```
PickerRow = masters row (itemId, skuCode, itemGroupName, price, minOrder)
          + v2 join on item_id → { stock: total_stocks.available, image: thumbnail }
```

- `stock: number | null` — the v2 `available` value; `null` only when the SKU is absent from the v2 payload (deleted upstream). Shown **raw** on admin surfaces, including negatives — parity means parity; the ERP itself oversells.
- `image: string | null` — v2 `thumbnail` URL (CDN). Null → existing letter tile (the `<img>` branch in `RosterThumb`/picker rows is already coded, just never fed).

### 2. One more module-level cache, same pattern as the catalog

`src/server/jubelio-catalog.ts` grows a second TTL entry for v2 (`listStockV2` on the client → `/inventory/v2/?page=1&page_size=2000`), 60 s, promise-dedupe, failure-unpoisons — identical semantics to the masters entry, no new cache abstraction. First paint costs one extra upstream call (~1.7 s); after that the 60 s window is free.

**Merge failure semantics (ruling, resolves a contradiction between an earlier `Promise.all` draft and §3's "plate honesty"):** the two entries settle independently. Masters failure = today's route error contract, unchanged (401/403/4xx/502 — the catalog itself is gone). **v2-only failure never fails the route**: every row merges `stock: null, image: null`, picker renders `—` + letter tile, the admin can still search and pick. The customer gate's writers get the same null-tolerant contract (§3).

Rationale for fetch-all + client-side filter over proxying `q=`: the picker already filters locally with a 300 ms debounce and shows `matched/total`; switching to server search would add request-per-keystroke latency jitter without any parity gain. The dashboard's search is not the parity target — its **numbers and pictures** are.

### 3. Admin roster joins live; the DB snapshot keeps serving the customer gate

- `/admin/sessions/[id]/products` (server component) renders `availableStock` and `image` from the v2 cache by `item_id` — the admin always sees dashboard-current values, never a stale column.
- `session_products.jubelio_stock` (existing column) remains the **customer-facing gate snapshot**: checkout/sold-out logic in the storefront reads it, untouched. No new column, no migration.
- **The stock writers, exactly (verified against code 2026-10-26):** `jubelio_stock` has ONE writer today — `POST /api/sessions/[id]/products` (`liveStock` per-SKU `getStockBySku` fan-out, `availableStock ?? 0`). `PUT …/[itemId]` never writes stock and never calls Jubelio — **untouched, out of scope**. POST switches to the v2 cache lookup by `item_id`, fixing a live hazard: today a failed by-sku lookup stores `0`, which whiteouts the card as sold out — a network glitch could silently kill a product's sales. Update path (on-conflict re-add): v2 yields nothing → **keep the previous `jubelio_stock`, never guess 0** (missing ≠ empty). New-row path when v2 yields nothing (**partner decision 2026-10-26 — block**): the row is NOT inserted; POST imports the rows that have a number and reports the rest as skipped, and the picker names them in a toast (`N produk dilewati, stok belum bisa dicek`) without leaving them in the "✓ Ditambah" state — the admin can re-pick once the ERP answers. If the whole v2 lookup is down, every new row skips; nothing imports as a silent whiteout. Exact POST response shape (e.g. `{ created, skipped }`) is the plan's to pin; tests pin skipped-rows-never-persist.
- **The two dead by-sku readers migrate too:** `GET /api/sessions/[id]/products` and `GET …/[itemId]` compute `availableStock` per row via by-sku fan-out and have **zero app consumers** (the picker calls only POST/PUT/DELETE; the roster page reads the DB directly). They stay, but their per-row `liveStock` swaps to the same v2 map — otherwise a second, contradicting stock source survives behind the "no two numbers in one minute" anti-goal, for free.
- **Derived quota floor (my call):** POST sets `sessionQuota = Math.min(20, availableStock ?? 0)`; negative v2 `available` (4 SKUs exist, min −14) would now flow into a **negative quota** the PUT schema (`positive()`) can never repair and the `quota − claimed` model can't express. New derivation: `Math.max(0, Math.min(20, available))` — floor 0 is today's effective floor already (unknown stock → quota 0 → sold-out card, admin edits up via PUT). Ruling stands unless partner says otherwise.
- v2 cache unavailable (ERP down): roster shows `—` for stock/image (same plate honesty as the picker, §2 merge semantics). The gate never gets a fresh 0 from an outage on the update path.

### 4. Customer-facing behavior does not change

Storefront cards keep: quota bar, `sisa N` (quota − claimed), sold-out overlay when quota exhausted **or** `jubelio_stock ≤ 0`. What changes is only the trustworthiness of that stored number (real value at import instead of fail-to-0). No Jubelio numbers are ever rendered to customers.

## Goals

- Picker rows: real thumbnail + ERP `available`, equal to dashboard within 60 s.
- Admin roster rows: same, joined live, including after ERP moves stock post-import.
- Import-time `jubelio_stock` written from the same source the admin just saw (one truth per pipeline).
- Letter tile remains the fallback for missing images; `—` remains the fallback for missing stock.

## Non-goals

- Removing or re-typing `jubelio_stock`; DB migrations of any kind.
- Server-side search for the picker (keeping client-side filter).
- Per-location (`location_stocks[]`) breakdown or location selector — dashboard default view is the aggregate.
- Cost fields (`last_cogs`, `average_cost`) anywhere in the UI.
- Storefront display of ERP stock.
- Deprecating `getStockBySku` from the client lib (harmless to keep; call sites move to the cache).

## Anti-goals

- A customer ever seeing a Jubelio number.
- A transient ERP failure silently marking a product sold out (today's fail-to-0).
- Admin seeing two different stock numbers in picker vs roster in the same minute.

## Constraints

- No query params may be sent to `/inventory/items/masters` (upstream 400) — only v2 accepts them.
- v2 must be fetched with `Bearer ${coreToken}` exactly like masters; the dashboard's raw-JWT `omni` token format is not needed by our app (probed: core token 200).
- Plain `<img>` + `eslint-disable @next/next/no-img-element` is the established pattern for Jubelio CDN thumbs (no `next/image` remote config).
- Existing test/lint/build commands: `node_modules/.bin/vitest run --exclude ".claude/**"`, `node_modules/.bin/tsc --noEmit`, `next lint --file …` (per prior-round ledger rulings).
- `pnpm db:generate` only for migrations — none needed here.

## Left to the builder (plan)

- Exact function names/shapes in `jubelio-catalog.ts` (`getStockMap(db-client) → Map<item_id, {stock, image}>` or similar) and where the merge composes (route vs catalog module).
- `PickerRow.image` typing: extend the existing `SearchResult` (which already declares `image?: string | null`) vs a required field — plan decides, tests pin.
- The roster page's join plumbing (it already loads `db`; needs the token-bearing client like the products route does).
- Test list: mapper merge (matched/missing SKU, negative passthrough), cache second-entry semantics (dedupe, unpoison), writers' "missing ≠ 0" behavior, route shape.
- UI cell placement for stock/image in picker rows and roster rows — follows the existing row idiom (mono `tabular-nums`, letter-tile frame already sized). Note: `RosterThumb` has a working `<img>`-else-letter branch; the picker's search rows hard-code the letter tile (`product-picker.tsx:985-992`) and need the same branch added.

## Open questions for partner

None open. Resolved 2026-10-26: new-row import with no v2 number → **block that row, import the rest, toast names the skips** (see §3). The quota-floor-0 derivation in §3 is my call standing unless partner overrides.

## Implemented

Branch `jubelio-v2-stock-images`, commits 7b8ca6b..159520a (Tasks 1-8, SDD ledger: .superpowers/sdd/2026-10-26-jubelio-v2-stock-images/progress.md). Manual browser parity pass (picker/roster thumbs + stock vs dashboard tab, no flicker on add/save) pending partner.
