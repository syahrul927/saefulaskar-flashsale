# Order CANCEL status, status history, detail stepper

Date: 2026-11-01
Status: awaiting approval
Mockups: `.superpowers/brainstorm/15145-1793510721/content/` (`cancel-flow.html` = A chosen, `stepper-home.html` = A chosen)

## 1. Why

There is no way to end an order that is not moving forward.

- Admin has many reasons to cancel: the customer withdrew, the customer never pays and is unreachable, the quota is needed elsewhere, or we simply cannot fulfil. Today the row just sits in `UNPAID` forever.
- `session_product.claimed` is never decreased anywhere in this codebase. A dead booking permanently eats session quota, so the session sells out of stock that never shipped.
- Verified live (spike 2026-11-01, system account): the only two orders in our DB that carry a `jubelio_so_id` — SO **192626** and SO **192297**, both `CONFIRMED` — now answer
  `HTTP 404 {"statusCode":404,"error":"Not Found","message":"SalesOrder not found"}`.
  The sync's only reaction is a permanent `failed++` per run: those orders never advance and never end.
- Status changes overwrite each other in place. Nothing records when an order moved or who moved it, so a cancelled paid order cannot be explained after the fact.

## 2. Goals, non-goals, anti-goals

**Goals**

- `CANCEL` joins the order status vocabulary, reachable from `UNPAID` and from `CONFIRMED`.
- An admin cancels with one button in the row, and the surface warns them to contact the customer first.
- Entering `CANCEL` returns the order's units to the session quota, exactly once.
- `COMPLETED` and `CANCEL` are **end states**: the sync stops fetching their Jubelio SO.
- The sync ends an order automatically when — and only when — Jubelio answers 404 for its SO.
- Every status transition is written to `order_status_history`, and a stepper built from it shows in an order detail dialog on both surfaces.
- The cron is discarded: route, `vercel.json` entry, `CRON_SECRET`.

**Non-goals**

- No Jubelio-side cancellation. We never call an upstream cancel/delete; the SO id stays on the row for the record. Refunds stay offline (WhatsApp, manual transfer).
- No webhook consumer. The sink stays observation-only and its code does not change (§7).
- No cancellation-reason taxonomy, enum, or required note. Admins cancel for reasons we do not model.
- No new order detail route, no customer-initiated cancel, no admin undo.

**Anti-goals**

- Cancelling a paid order on an ambiguous upstream answer (timeout, 5xx, 401, unreadable body). This is the failure the design most wants to avoid.
- Releasing quota twice for one order, or releasing quota without the status actually moving.
- A cancel that no admin can later attribute to a person or to the sync.
- A status that is unreachable in the UI — every status value needs a pill and a badge tone.

## 3. Decisions

Numbers 1–9 were decided by the human partner in the brainstorming conversation; the ones marked *(my call)* are mine and listed in §8 so they can be checked.

1. The status member is named `CANCEL` (not `CANCELED`/`CANCELLED`). Raw enum labels are the **admin** vocabulary only — admin chips and admin badges print `UNPAID`/`CONFIRMED` verbatim. The customer surface translates: `STATUS_LABEL` in `src/app/(storefront)/orders/page.tsx:32` maps them to "Belum Bayar"/"Dikonfirmasi"/"Diproses", and `orders-list.tsx` pills upper-case those words. So the customer sees **Dibatalkan**, in the pill and in the dialog badge. (Mockup `cancel-flow.html` shows the admin row, where raw `CANCEL` is correct; the stepper mockup's customer dialog should be read as `Dibatalkan`, not `CANCEL`.)
2. Admin cancels both `UNPAID` and `CONFIRMED` orders. A `CONFIRMED` cancel is the rare, deliberate case — the money is already in, so the warning is different.
3. Cancel UI = **option A**: `Batalkan` sits next to `Konfirmasi Bayar` in the row footer as a destructive-outline button (visible, one click, quieter than the primary), and the dialog carries the warning.
4. `CANCEL` gets its own tab in the admin list **and** its own pill in the customer transaction list, with counts.
5. The contact button: on a cancelled order in the **admin** surface it dials the **customer** (WhatsApp); on the **customer** surface it dials **CS**.
6. Sync auto-cancel fires on a definitive 404 only. Timeout never cancels.
7. `COMPLETED` + `CANCEL` are end states, and the sync query excludes them.
8. Detail = **option A**: a per-row dialog, no new route, reused by admin and customer.
9. Cron goes away entirely, so the sync runs only when an admin opens the orders page (throttled). Consequence accepted knowingly: a `CONFIRMED` order whose SO disappeared upstream stays `CONFIRMED` — and its quota stays held — until an admin opens /admin/orders, and nobody sees a cancel landing unless they are looking. Confirmed by the human partner 2026-11-01: **no external pinger exists, and the Vercel cron was already removed from the dashboard** — so `vercel.json`'s entry and the code comments describing an hourly pinger are dead configuration, not a live schedule being cut. Nothing outside this repo needs cleanup, and the consequence above is the real, complete model: an admin opening /admin/orders is the only thing that moves a status.
10. The `backfill-images` maintenance route goes with it, so `CRON_SECRET` can disappear completely instead of being renamed (§4.7). Sessions imported before `session_product.image_url` existed keep their letter tiles; nothing in the app re-fills those photos.

*(my call)* Upstream `internal_status: CANCELED` also maps to local `CANCEL` with quota release, not just 404. It is currently dropped by `mapInternalStatus` and the reason for it ("no local member") is gone.

## 4. Behaviour

### 4.1 Status vocabulary

`orderStatus` enum gains `CANCEL`. Places that must widen with it. The first five are keyed off `OrderStatus`, so TypeScript forces them; the last two are **not** — they degrade silently, so they need to be in the plan explicitly:

- `src/server/db/schema.ts:46` — the `pgEnum` values.
- `src/app/_components/status-badge.tsx` — `OrderStatus` union and `ORDER_STATUS_TONES`. Tone: `red` (the only unused tone today, and it already maps to the `destructive` badge variant).
- `src/app/_components/admin-order-tabs.ts` — `TABS` gains `CANCEL`, which makes `?status=CANCEL` deep links work through `resolveInitialTab`.
- `src/app/_components/order-filters.ts` — the pinned customer tab set `all | UNPAID | CONFIRMED | COMPLETED` gains `CANCEL`, in `OrderFilterTab`, `OrderStatusCounts`, and `statusCounts`.
- `src/server/daily-sync.ts` — `SyncStatus` and `STATUS_RANK`.
- `src/app/(storefront)/orders/page.tsx:32` — `STATUS_LABEL`, typed `Record<string, string>` and read as `STATUS_LABEL[order.status] ?? order.status` (line 109). A missing `CANCEL` key is **not** a compile error and not a crash: the customer badge quietly prints `CANCEL` where every sibling badge is Bahasa. Add `CANCEL: "Dibatalkan"`.
- `src/app/_components/orders-list.tsx` — the customer pill list (`SEMUA / BELUM BAYAR / DIKONFIRMASI / DIPROSES`). `CANCEL` needs a pill there too, labelled `DIBATALKAN`, or a cancelled order is only reachable under "SEMUA" on the customer side while the tab contract in `order-filters.ts` claims four visible statuses.

**Ranking.** `STATUS_RANK` is a forward-only ladder and `CANCEL` is not on it; it is a side exit reachable from `UNPAID` and `CONFIRMED` and absorbing nothing. Treat it as a predicate, not a rank: `isEndState(status)` → `COMPLETED | CANCEL`, consulted before any rank comparison. A row in `CANCEL` must never be pulled back to `CONFIRMED` by a stale SO read, and no rank lookup alone should be relied on for that. Legacy `SHIPPED` is not an end state (it can still advance to `COMPLETED`), and nothing ever writes `CANCEL` through the forward-only path.

### 4.2 Two doors into CANCEL

**Door 1 — admin button.** In the row footer for `UNPAID` and `CONFIRMED` rows: `Batalkan` beside `Konfirmasi Bayar`/`Lihat detail`. Click opens a dialog:

- title `Batalkan FS-2026-0148?`
- the consequence stated as fact: status becomes `CANCEL`, and `N unit kembali ke kuota sesi` (N summed from the order's items)
- `UNPAID`: an amber warning — the customer has not paid, contact them first.
- `CONFIRMED`: a heavier warning — the customer has paid; cancelling means you contact them and refund out of band. The Jubelio SO id is named in the dialog so it cannot be mistaken for an unpaid booking.
- footer: `Hubungi pelanggan` (WhatsApp, left) + `Kembali` and `Ya, batalkan` (right).

The warning never blocks: `Ya, batalkan` is always pressable without opening WhatsApp first.

`POST /api/orders/[id]/cancel`. OWNER only, same guard as the confirm route. `{ ok, order }` on success; `404` when the id is unknown, `409` when the row is not in a cancellable state (message names the current status, matching the confirm route's existing `409`). Button sets `isLoading` until resolve, toasts both outcomes, `router.refresh()` on success — the list is server-rendered, so the new status and the returned quota both re-paint.

**Door 2 — sync verdict.** `runOrderSync` gets a three-way verdict per SO instead of two (§4.4) and, on `missing`, plans `{ status: "CANCEL", cause: … }` for that order. Same release path, same history write, actor recorded as the sync rather than a person.

Both doors land in exactly one place: one service function that owns the transition. No route or loop should write `CANCEL` on its own.

### 4.3 Releasing quota

One shared function, used by both doors:

- Sum the order's `order_item.qty` per `session_product_id`.
- `UPDATE session_product SET claimed = GREATEST(claimed - <qty>, 0)` per line. The clamp floors at 0 because a legacy row could reference a product whose quota was already truncated by an admin edit; going negative would silently break the storefront cap.
- Written in the **same transaction** as the status update and the history insert, so status, quota, and audit trail never disagree.
- Idempotent by construction: the status UPDATE carries `WHERE status NOT IN ('COMPLETED','CANCEL')` and the release (and the history row) only happens when exactly one row flipped. Two overlapping sync passes, a double click, or an admin racing a sync therefore release once. Do not rely on the button's `isLoading` for this.
- A `CANCEL` never touches `tracking_number`/`shipper` and never nulls `jubelio_so_id` — "SO #192626, deleted upstream" is the evidence the dialog shows.
- Quota returns even if the session is already `ENDED`, and that is inert by design rather than a reopening: checkout's first gate is `sessionStatus !== "ACTIVE"` → `SESSION_NOT_ACTIVE` (`src/server/checkout.ts:96`), verified 2026-11-01, so nobody can buy from an ended session no matter what `claimed` says. Inside an `ACTIVE` session the returned slot genuinely goes back on sale — which is the point of the feature, and is why the release must not be conditional on session status.

### 4.4 Sync: verdicts and end states

`src/server/order-sync.ts`:

- `createDbSyncDeps().listLinkedOrders()` gains `AND status NOT IN ('COMPLETED','CANCEL')` on top of the existing `jubelioSoId IS NOT NULL`. End-state rows stop costing an upstream call forever, and stop being candidates for any patch.
- The per-SO outcome becomes `state` | `missing` | `unknown`:
  - `state` — body read, `internal_status` present (today's success path).
  - `missing` — `e instanceof JubelioError && e.status === 404`. Definitive. Verified shape: `{"statusCode":404,"error":"Not Found","message":"SalesOrder not found"}`.
  - `unknown` — everything else: `TimeoutError` from the 15 s abort, 401 (the token-expiry retry inside `withSystemClient` already burns one attempt before surfacing it), **403**, 5xx, or a 2xx body without `internal_status`. Left exactly as now: untouched order, counted as `failed`, logged. `403` is named on purpose: the read runs under the **system account's** token while the SO was created under a **signed-in admin's** token, and a permission-shaped answer must never cancel a live order. Only `404` cancels.
- `src/env.js` schema is not a scope guard here: `JUBELIO_SYSTEM_EMAIL`/`JUBELIO_SYSTEM_PASSWORD` have no `SAFAR_COMPANY_ID` sibling, and `SAFAR_COMPANY_ID` is only ever sent as a `company` header on `/token/refresh` — `authenticateWithJubelio` reads `currentCompany` off the login response and *rejects* a mismatch ("Company tidak valid"), so the sync silently uses whatever company and location the system account's own profile carries. That is the one assumption the cancel rule rests on, so the plan must open with a verification step, not a build step: with the system token, read one SO that is **known to be alive** and confirm it returns `200` with an `internal_status`. If it answers `404` instead, the two deleted SOs proved nothing about scope, and auto-cancel has to wait for a scope guarantee before it ships.
- **Verified 2026-11-01 (system account; GETs only — spike `.superpowers/spike-so-live.mjs`, gitignored). The 404 rule holds: SAFE, auto-cancel ships as designed.** Login (`POST ${JUBELIO_HOST}/login`) → `200` with `currentCompany: 59325` (= `SAFAR_COMPANY_ID`, `company_name: "Saeful Askar"`), `currentLocation: 6` ("Cabang Semarang"), `location_ids: [-1,2,3,5,6,7]`. Every SO known or expected to be alive answered `200` **with** a non-empty `internal_status` — `209` → `SHIPPED`, `85` → `COMPLETED`, `192296` → `SHIPPED`, `192295` → `CANCELED`, `192200` → `COMPLETED`, plus the first three ids read off `GET /sales/orders/` (`84` → `COMPLETED`, `85` → `COMPLETED`, `86` → `CANCELED`): 8/8, no `200`-without-`internal_status` case. Both of our deleted SOs answered `404` with the exact body spec §4.4 claims — `{"statusCode":404,"error":"Not Found","message":"SalesOrder not found"}` — for `192626` and `192297`. The decisive evidence is **adjacency**: `192295` and `192296` sit immediately below `192297` in the same id space, are `SP-`-prefixed like our own orders, and are readable by this same token in this same company — so `192297`'s `404` cannot be "outside this token's company/location", it is deletion. Two details worth keeping: `192295 → CANCELED` proves `CANCELED` is a value this account's SO headers actually carry (which §4.1's ladder and Task 3's vocabulary test assert), and every alive header carried `location_id: -1`, the same sentinel `.env`'s `JUBELIO_LOCATION_ID` uses, so no location filter narrows this read. `403` never appeared and stays correctly classified as `unknown`.
- `planSync` takes the verdicts, not just the parseable states, and can now emit a cancel patch. Cancel patches are exempt from the forward-only rank rule (that rule exists to stop regressions along the ladder, and a cancel is not a rung) but are gated by `isEndState`.
- `SyncRunResult` gains `cancelled: number` alongside `checked | synced | failed`. `checked` should stay "orders we actually looked at" so the number means what it says after the end-state filter. It is **not** rendered anywhere: no surface displays `checked/synced/failed` today — the admin orders page awaits the run, discards the result, and keeps it alive in `after()` (verified 2026-11-01). So `cancelled` is returned and `console.log`ged with the other counts, and that is the whole requirement. Building a status line for it would mean also deciding what it says when the run was throttled away (`maybe()` resolves `null`) and what a run that outlives `ORDER_SYNC_AWAIT_MS` means for a page already painted — three questions this feature does not need answered.

### 4.5 Status history

New table `order_status_history` via the repo's `createTable` helper (real name `pg-drizzle_order_status_history`):

| column | notes |
|---|---|
| `id` | uuid pk |
| `order_id` | fk → `order.id`, `onDelete: cascade` |
| `from_status` | nullable `order_status` — null on creation |
| `to_status` | `order_status` |
| `source` | text: `checkout` \| `admin` \| `sync` |
| `actor_user_id` | nullable text → `user.id`, `onDelete: set null` — set when `source = admin`, null for `checkout`/`sync` |
| `note` | nullable text, display-ready: `SO #192626 dihapus di Jubelio`, `2 unit kembali ke kuota sesi`, `Sales order dibuat` |
| `created_at` | timestamptz, indexed with `order_id` |

Rules:

- Written inside the same transaction as the status write, by the service function that owns the transition — not by each caller. Callers pass `{ source, actorUserId?, note? }`.
- **Where that function is called from.** Two call sites, both already doing I/O: the admin cancel route, and `createDbSyncDeps().apply()` in `src/server/order-sync.ts` (status is written there today, so it is already non-pure and already imports `schema.ts`). The pure core `planSync`/`mapInternalStatus` in `src/server/daily-sync.ts` only *decides* — it must not gain writes, because that module is deliberately HTTP- and DB-free so its rules stay unit-testable. Do not push the transaction down into it.
- There is no `server-only` obstacle to record: after the cron route is deleted, `maybeRunOrderSync` has exactly one caller — the admin orders page (`src/app/admin/orders/page.tsx:56`) — verified 2026-11-01. No customer surface triggers a sync, so `order_status_history` lives in `schema.ts` next to `orders` and both triggers reach it through the same service function.
- Only written when the status actually changes. A sync pass that backfills a resi stays silent.
- `order.created_at` stays the creation time and the stepper's first step; `checkout` history rows are optional, but creation must still render as a step.
- **No history rows are invented.** The table records transitions this app actually observed, and nothing else; a row that did not happen cannot be told apart from a real one later, which would defeat the reason the table exists. Orders predating the feature therefore have zero rows, and the dialog handles it: the stepper always renders the creation step from `orders.created_at`, and when there is no history it adds one muted step "Status saat ini — tercatat sebelum riwayat status aktif" with **no timestamp**. `orders.updated_at` must never be shown as "when this status began": `$onUpdate` rewrites it on every write, including a resi backfill that changed no status at all (`src/server/db/schema.ts:186`). If the current status is `CANCEL` with no history row, the dialog says the order is cancelled and stops there — it does not claim who did it.
- Actor is the admin's `user.full_name` for display; a deleted admin still renders (label for `actor_user_id IS NULL` with `source = admin` — "admin yang sudah dihapus").

### 4.6 Detail dialog and stepper

One dialog per row on both surfaces, opened by `Lihat detail` in the row footer (admin `UNPAID`/`CONFIRMED` rows keep their action buttons in the list itself; the dialog shows them too so there is one place to act).

Dialog content, in order:

1. Header band: booking id (mono), status badge, `grand_total`, session name, `SO #<id>` when linked.
2. **Stepper** built from `order_status_history` in ascending time order. Each step: label, `dd MMM yyyy, HH.mm` (`id-ID`), who (admin name / "sinkronisasi Jubelio"), and the note when present. Labels come from the transition, not the raw enum — `UNPAID → CONFIRMED` reads "Dibayar — sales order dibuat", `→ CANCEL` reads "Dibatalkan". A `→ CANCEL` step is red, and the last one.
3. When the order is **not** in an end state, one greyed pending step (`Menunggu pembayaran` for `UNPAID`, `Selesai` for `CONFIRMED`). No pending step after a cancel.
4. Items list (same rows as the card), transfer-proof link when present, shipment band when `tracking_number` is present.
5. Footer: `Hubungi pelanggan` (admin, `wa.me` to the customer's number) or `Hubungi CS` (customer, existing `WHATSAPP_NUMBER` pattern), plus `Batalkan` for the admin when the row is cancellable.

WhatsApp number resolution, one helper shared by both doors: `orders.contact_id → contact.phone`, else the order customer's contact by email (the same fallback chain the confirm route uses), else `orders.recipient_phone`. Normalise for `wa.me`: leading `008`/`0` → `62`, strip separators, keep a leading `+62` → `62`. No number found → the button does not render (never a dead link), and the dialog says the order has no phone number so the admin uses the profile.

Prefilled message: name + booking id + what happened, Indonesian, one line each; for `CONFIRMED → CANCEL` it states the refund has to be arranged. The exact copy is the builder's, and it is user-visible product copy, not a placeholder.

Dialog follows the existing dialog anatomy (`receipt-dialog.tsx`: `sm:max-w-xl`, header band, scrollable body), the app's neutral/shadcn styling, and the base `Button`'s `isLoading` for every API-triggered action inside it.

### 4.7 Cron removal

- Delete `src/app/api/cron/daily-sync/route.ts`.
- Delete `vercel.json`. Verified 2026-11-01: it contains nothing but the one cron entry, so the file goes with the job.
- Deleting the route kills nothing live. The comments in `src/server/order-sync.ts:15-27` and the route header claim an hourly external pinger (cron-job.org / GitHub Actions) shares this URL; the human partner confirmed 2026-11-01 that no such pinger exists and the Vercel cron job is already deleted from the dashboard. Fix those comments as part of this bullet — after this change they describe two triggers, one of which was never real and the other of which no longer exists.
- Delete `CRON_SECRET` from `src/env.js` (schema + `runtimeEnv`), `.env.example`, `vitest.config.ts`'s env block, and any test that sets it.
- `src/app/api/cron/backfill-images/route.ts` is deleted too, not renamed. It is the only other reader of `CRON_SECRET` (`route.ts:28`, `x-cron-secret`), and it is a manual curl-only maintenance tool with no caller anywhere in the app — verified 2026-11-01 — so dropping it is what lets `CRON_SECRET` disappear instead of being renamed. Delete the route, `src/server/backfill-images.ts`, and `tests/backfill-images.test.ts`. Consequence, accepted by the human partner: sessions imported before `session_product.image_url` existed keep their letter tiles with no way to re-fill the photos short of re-importing the products.
- Update the comments that still describe a nightly cron — `src/server/order-sync.ts`'s header and the note in `daily-sync.ts` about what feeds the sync — so the docs match the single remaining trigger.

## 5. Existing behaviour this must not break

- Forward-only status movement for non-cancel patches, including legacy `SHIPPED` rows.
- A failed SO fetch never throws out of the run; one bad order must not freeze the sweep.
- Resi backfill on a `CONFIRMED` row that has nothing else to change still produces a patch.
- The admin orders page paints within `ORDER_SYNC_AWAIT_MS` and lets the run finish in `after()`; with the cron gone this page is the only trigger, so its throttle and timeout budget now decide how fresh every status is.
- The customer tab contract pinned in `order-filters.ts` and its tests in `tests/order-filters.test.ts`.
- The webhook sink keeps its 503-when-unconfigured behaviour.

## 6. Left to the builder

- File layout and naming within the existing conventions (`src/server/*.ts` for the service, pure cores split from I/O the way `daily-sync.ts` / `order-sync.ts` already do).
- Whether the cancel service lives next to `confirm-order.ts` or in a new `cancel-order.ts` (a new module is the cleaner read; both are established shapes here).
- The stepper's exact label vocabulary and the dialog's information density.
- How much of the history to surface in the admin list beyond the dialog (nothing is required).
- Re-check every switch/record keyed on order status for a new-member gap: `src/server/console-kpi.ts`, `admin-nav.tsx`, `orders-list.tsx`, receipt/struk copy, and any `satisfies Record<OrderStatus, …>` map. TypeScript catches the keyed ones; hand-written conditionals will not complain.
- `yarn db:generate` only (repo rule: yarn, never npm/pnpm/bun), then hand the SQL to the human partner — applying it is theirs, and `db:push`/`db:migrate` are never run here. Expect one `ALTER TYPE "public"."order_status" ADD VALUE 'CANCEL';` plus a plain `CREATE TABLE "pg-drizzle_order_status_history"` with its index; there is no data statement, since no history rows are invented (§4.5). Precedent for exactly that shape: `drizzle/0003_empty_newton_destine.sql:1` did `ALTER TYPE "public"."user_role" ADD VALUE 'CUSTOMER';` and applied cleanly. If generate ever emits a **recreate** instead (drop type + rebuild + column casts — drizzle does this when a member is inserted mid-list), that is a lock and a data risk on a live `order` table: stop and say so rather than handing it over as routine.

## 7. Webhook: no change

The sink at `/api/jubelio/webhook-sink/[token]` stays observation-only, and its code does not change. (Naming, for anyone cross-reading the main spec: §4.7 there spells it `webhook-sink/[...path]`, a catch-all. The live route is the single segment `src/app/api/jubelio/webhook-sink/[token]/route.ts`. The old spec is the stale one.) One premise to correct: the sink has never verified a Jubelio signing secret — `src/server/jubelio-probe.ts` deliberately excludes signatures because whether requests are signed at all is one of the open questions. Jubelio's dashboard "secret key" left blank therefore changes nothing on our side. Testing a callback only needs `JUBELIO_WEBHOOK_SINK_TOKEN` set in `.env` and the resulting tokened URL pasted into Jubelio's Pengaturan → Developer → Webhook field. The documented "Resend Webhook Sales Order" endpoint (`POST /core-api/webhook/sales-order`, guide §8) is how an event can be fired at it on demand.

Direction, stated by the human partner on 2026-11-01 and deliberately **not** built here: status freshness is meant to come from a webhook eventually, once real captures have been read and the payload/join question is answered. That is its own design. The one thing this feature owes it is that the transition must stay callable from a single place — the cancel/status service function of §4.2 — so a future webhook handler drives the same transaction (status + quota + history) instead of inventing a second one. Nothing else about this design waits on the webhook.

## 8. My calls, listed for checking

1. Name: `CANCEL`.
2. Admin cancel is allowed from `UNPAID` **and** `CONFIRMED` (the `CONFIRMED` dialog warns harder).
3. The warning never blocks the cancel.
4. No cancellation-reason field; `note` on the history row carries human-readable cause only.
5. Upstream `internal_status: CANCELED` → local `CANCEL` + release, same as a 404.
6. `CANCEL` badge tone `red`; admin and customer both get a `CANCEL` pill.
7. Quota release is clamped at 0 and happens even for an `ENDED` session.
8. `jubelio_so_id`, resi, and shipper survive the cancel; only status changes plus quota.
9. Actor for a sync-driven cancel is the sync, not a system user id.
10. ~~Baseline history rows backfilled at migration time~~ — **retracted after review.** No rows are invented; old orders render from `orders.created_at` plus a timestamp-free "status sebelum riwayat" step (§4.5). This also means the migration is enum-add + create-table only, no data statement in it.
11. WhatsApp number: `contact.phone` first, then `recipient_phone`; no number → no button.
12. Cancel is not available to customers, and there is no undo path.
13. `SyncRunResult` gains `cancelled`.
14. The auto-cancel on 404 has no second-run confirmation delay — one definitive 404 cancels, as you specified.
15. `403` (and every other non-404 failure) counts as `unknown` and never cancels, because the sync reads with the system account's token while the SO was created with an admin's.
16. The plan opens with a verification spike, not a build step: the system token must read a known-live SO as `200` before the 404 rule is trusted. Our two 404s are consistent with "deleted", but with no live control in the DB they cannot also rule out "outside the system account's space" — and this app's history says company/location scoping is exactly where Jubelio lies.
17. `Hubungi CS` on the customer surface needs no number resolution: it is the existing `csLink` pattern (`env.WHATSAPP_NUMBER`). The `contact.phone` → `recipient_phone` chain in §4.6 is only for the admin's `Hubungi pelanggan`.
18. Status, quota release, and history row are written by one service function called from the cancel route and from the sync's `apply()`; the pure sync core stays free of writes.
