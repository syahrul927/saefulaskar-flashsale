# Invoice webhook → COMPLETED + resi polling

Date: 2026-11-08
Status: awaiting approval
Owner decision source: brainstorming conversation 2026-11-08 (status semantics agreed with the owner).

## 1. Why

The owner redefined the order lifecycle after a long discussion:

- `UNPAID` — transaction created in flash-sale, admin has not confirmed payment.
- `CONFIRMED` — payment confirmed and a sales order exists in Jubelio.
- `COMPLETED` — Jubelio has formed the **faktur** (invoice) on the sales order. The resi (tracking number) arrives later, by periodic sync or manual sync — both allowed.

Two of the three already hold: checkout creates `UNPAID`; the admin confirm flow creates the Jubelio SO and flips the row to `CONFIRMED` (`src/server/confirm-order.ts`, `markConfirmed`). What changes is what makes `COMPLETED`.

Today `COMPLETED` fires when the SO header reads `internal_status: COMPLETED` (`src/server/daily-sync.ts`, `mapInternalStatus`). The live evidence (webhook body captured 2026-11-07/08 on the observation sink) is that Jubelio pushes a `hook-invoice` event when the faktur is created:

```json
{
  "action": "hook-invoice",
  "ref_no": "SP-261107NGP1K1DB",
  "invoice_id": 188102,
  "invoice_no": "INV-000188102"
}
```

The PRD (§4.6, §6 #7) held exactly this trigger "on evidence" — the payload is now known. This feature consumes it, and re-aims the resi sync at `CONFIRMED` + `COMPLETED`-without-resi rows.

**Join verified by the owner (2026-11-08):** for our internally-created SOs, `hook-invoice.ref_no` carries the `SO-<digits>` form. The `SP-…` example above is a marketplace order picked at random from the log; our own hooks echo `SO-000192297`-shape numbers. (Our SO create payload still sends the header field `ref_no: ""` — the hook echoes the SO's `salesorder_no`, not that field.)

## 2. Goals / non-goals / anti-goals

**Goals**

- A real webhook consumer route for `hook-invoice` that flips a matching `CONFIRMED` order to `COMPLETED`, with an `order_status_history` row and the invoice id/number stored on the order.
- `ref_no` joins back to the local order through the Jubelio SO id.
- Resi polling covers `CONFIRMED` rows and `COMPLETED` rows that have no resi yet (today `COMPLETED` is excluded from the sync's query entirely).
- A 10-second browser-driven poll while the admin orders panel is open, server fetching the targeted SOs with bounded concurrency.
- The old fallback stays: `internal_status: COMPLETED` on a polled SO still lifts a `CONFIRMED` row, so a missed webhook heals on the next pass.

**Non-goals**

- No webhook signature verification. The owner decided (2026-11-08): trust what arrives for now; a secret key is a future step. The route still carries the same secret-path-segment pattern the observation sink uses, and it is **closed by default** (see §4.1).
- No change to the status vocabulary: no new enum member, no new tab, no new customer pill. Customer-facing copy for `COMPLETED` ("DIPROSES") already reads correctly for "faktur formed".
- No change to the observation sink (`/api/jubelio/webhook-sink/[token]`) — it keeps capturing everything verbatim.
- No cancel, quota, or refund changes.
- No adoption of the PRD §6 #16 `ref_no = booking_id` candidate. The SO create payload keeps sending `ref_no: ""`.

**Anti-goals**

- A webhook that moves an order the fetched SO contradicts (e.g. the SO now reads `CANCELED` — see §4.3).
- A resi poll that writes status backwards or re-writes an existing resi.
- A status flip that skips the history ledger, or a duplicated flip on a retried hook.

## 3. Decisions

Decided by the owner in conversation:

1. The three-status lifecycle above (`UNPAID`/`CONFIRMED`/`COMPLETED` with faktur as the `COMPLETED` trigger).
2. On receiving `hook-invoice`: fetch the specific SO from Jubelio, then update what changed. The first hook for an SO is the faktur creation — that is the moment `CONFIRMED → COMPLETED`.
3. Resi updates come from manual sync ("Sync Manually" button) **or** a 10-second periodic fetch driven by the client while the admin panel is open — both allowed.
4. These sync actions target only orders in `CONFIRMED` state and `COMPLETED` state with no resi.
5. Trust the webhook body as-is for now; secret key later.
6. The existing 5-minute page-load throttled sync stays as-is, alongside the new mechanisms.

## 4. Behaviour

### 4.1 Webhook consumer route

New route, separate from the observation sink: `POST /api/jubelio/hooks/[token]` (exact segment name is the builder's; the point is a second path next to `webhook-sink`). The Jubelio dashboard takes one callback URL per event, so this URL is what gets pasted into Pengaturan → Developer → Webhook for the invoice event.

- Token: same `JUBELIO_WEBHOOK_SINK_TOKEN` env var as the sink, but **unset ⇒ the route answers 401 to everything** — unlike the sink's open-when-unset debugging default. This route writes order status; an open-by-default status writer is the one mistake this design must not ship.
- Body: `{ action: string, ref_no?: string, invoice_id?: number, invoice_no?: string }`. Parse tolerantly (numbers as numeric strings accepted, matching `detectCaptureRefs`' habits in `src/server/jubelio-probe.ts`).
- Any unknown `action` (the dashboard may deliver other events to the same URL): log one line, answer `200 {ok:false, reason:"unhandled action"}`. Never 5xx for a body we simply do not consume.
- **Verbatim capture continues.** Repointing the invoice callback to this route stops the observation sink from receiving that event (one URL per event), so the consumer itself inserts a capture row into `webhook_captures` — reusing `captureBody`/`redactHeaders` — before deciding anything. Removable once the join and payload are boring. Failures of this insert must not block the flip (best-effort, logged, like the sink's prune).
- Always answers fast (2xx/4xx). A handler that stalls makes Jubelio retry.
- Unparseable/missing `ref_no`, or a `ref_no` that does not join to a local order: log, answer `200 {ok:false, reason}`. This is expected traffic, not an error — the same account receives hooks for its 184k marketplace orders and their `SP-…` numbers.

### 4.2 `ref_no` → order join

`ref_no` echoes Jubelio's own `salesorder_no` for the SO. Our created SOs answer `SO-000192297` (`src/lib/format.ts:53-61`); marketplace SOs answer `SP-<ref_no>`. Parser:

- `^SO-(\d+)$` → the numeric SO id (`parseInt`, strip leading zeros naturally).
- Bare positive integer string → accept as the SO id too (defensive; the body format is not documented upstream).
- Anything else (`SP-…`, empty, garbage) → not ours, ignore.

Resolve the order by `orders.jubelio_so_id = <parsed id>`. No match → ignore (this is how marketplace hooks fall out). If several rows matched (no unique constraint on `jubelio_so_id`), act on the most recent and log the anomaly.

### 4.3 The flip transaction

The hook is a *hint*; the fetched SO is the evidence (this also matches the owner's stated flow: "we receive the hook, we need to fetch specific SO then update what changes"). One service function owns the whole transition — the same single-writer rule the cancel design set (spec 2026-11-01 §7):

1. Look up the order by `jubelio_so_id`.
2. Fetch the SO with the **system account** client (`withSystemClient((c) => c.getSalesOrder(id))` — same rule the sync uses: the write must not depend on whichever admin's page happened to be open).
3. Decide:
   - Fetch fails (timeout/5xx/401/403/unparseable) → do nothing, log, answer `200 {ok:false, reason}`. An unreachable upstream must never look like a completed order.
   - SO reads `CANCELED` → do **not** complete; route through the existing `cancelOrder` service with a note naming the invoice event. (A faktur hook for a since-cancelled SO is stale or out-of-order; the cancel service is the one writer of `CANCEL` and releases quota correctly.)
   - Otherwise (the SO exists and is ours) → proceed to flip.
4. In one transaction:
   - Update `orders`: `invoice_id`, `invoice_no` (always — idempotent re-writes are fine), and `status = 'COMPLETED'` **guarded** by `WHERE status NOT IN ('COMPLETED','CANCEL')`.
   - Write the `order_status_history` row only when exactly one row flipped, `fromStatus` = the row's status before the write, `toStatus: 'COMPLETED'`, `source: 'sync'`, **`note: null`**. Owner ruling (2026-11-08): the customer stepper renders history notes, so the faktur is never named on a customer surface — the step already reads "Selesai" attributed "sinkronisasi Jubelio", and the invoice id/number live in the new `orders` columns for admin/audit. No stepper filtering machinery.
   - If the row was already `COMPLETED` or `CANCEL`: still refresh `invoice_id`/`invoice_no` when empty, write no history row, answer `200 {ok:true, changed:false}`. This is the retried-hook no-op.
5. Legacy `SHIPPED` rows flip to `COMPLETED` too (not end states; the ladder already allows it). An `UNPAID` row with a `jubelio_so_id` (the 2026-10-28 damage shape) does **not** flip — log it; the confirm-retry path owns that healing, not the hook.

The observation sink keeps a verbatim capture of the same event; the consumer route does not need to duplicate the raw body into `webhook_captures`.

### 4.4 Resi polling targets

`createDbSyncDeps().listLinkedOrders()` (`src/server/order-sync.ts:278-299`) widens from "linked and not in an end state" to:

```
jubelio_so_id IS NOT NULL
AND ( status NOT IN ('COMPLETED','CANCEL')          -- today's set: UNPAID/CONFIRMED/SHIPPED
      OR ( status = 'COMPLETED' AND tracking_number IS NULL ) )
```

`CANCEL` stays fully excluded (nothing to fetch, ever). A `COMPLETED` row with a resi stops costing an upstream read again.

`planSync` (`src/server/daily-sync.ts`) relaxes accordingly:

- End-state rows today `continue` before anything. Now: a `COMPLETED` row may produce a **resi-only patch** (`tracking_number`/`shipper` backfill when they differ), never a status patch — the rank guard alone is not the contract here; make the "no status writes into or out of an end state" rule explicit in the code, pinned by a test.
- `CANCEL` rows still produce nothing (they are also excluded by the query; the guard stays for the pure core's tests).
- The `internal_status: COMPLETED → local COMPLETED` mapping stays on non-end-state rows — that is the missed-webhook fallback.
- Resi backfill on a `CONFIRMED` row whose SO is still `PAID`/`SHIPPED` upstream continues exactly as today.

Bounded concurrency for the "one by one, multi-thread if possible" requirement is already the shape: `runOrderSync` fetches in batches of `DEFAULT_CONCURRENCY = 4` with a 15 s per-request abort. An empty target list costs zero upstream calls (the list query runs first).

### 4.5 The 10-second client poll

- A small client component on `/admin/orders`: every 10 s while the tab is **visible** (`document.visibilityState === "visible"`), `POST /api/admin/sync` (the existing manual-sync endpoint → `forceRunOrderSync()`). Stops on `visibilitychange` hidden and on unmount, and skips a tick if the previous fetch is still in flight.
- **Visible feedback (owner ruling 2026-11-08):** the component shows a "last updated" timestamp — "Diperbarui HH.mm.ss" — fed by the run result every completed poll (or manual click) returns, placed near the manual sync button. On a run reporting `synced + cancelled > 0` it also calls `router.refresh()` so new resi and completed rows appear under the cursor; on a no-op run only the timestamp moves. No toasts from the poll — the manual button keeps its existing ones.
- `force()` already joins an in-flight pass instead of doubling it and stamps the throttle clock, so a 10 s poll and the 5-minute page-load `maybe()` coexist without overlap.
- The poll adds no new endpoint and no new auth: it is the admin page's own session hitting the admin API it already uses.
- Load note: each tick re-runs the full target list; with N targeted orders that is N upstream reads per 10 s while an admin keeps the panel open. Accepted by the owner (the target set is small in practice and empties as resi arrive). The builder should keep the poll from stacking: skip a tick if the previous fetch is still in flight.

## 5. Existing behaviour this must not break

- Forward-only status movement; `CANCEL` stays an end state only reachable through `cancelOrder`.
- A failed SO fetch never throws out of a sync run; one bad order must not freeze the sweep (hook failures likewise never propagate).
- The guarded-update race discipline in `order-sync.apply` (`FOR UPDATE`, `before.status !== status`, end-state guard) — the hook's transaction mirrors it rather than inventing a weaker one.
- The customer stepper contract (spec 2026-11-01 §4.5/§4.6): no invented steps; a resi backfill stays silent in the history; `COMPLETED` renders as "Selesai"/"DIPROSES" exactly as today.
- The webhook sink's 503-when-unconfigured/open-when-unset behaviour is unchanged.
- `admin-order-tabs`, `order-filters`, `status-badge`, KPI counts: no vocabulary change, so none of these move.

## 6. Left to the builder

- Route file layout and naming next to the existing sink; the hook decision logic split pure/I-O the way `daily-sync.ts`/`order-sync.ts` do (the join parser and the decide-step want unit tests without HTTP).
- Where the flip service lives (a small module next to `cancel-order.ts` is the clean read).
- Whether the hook reuses `recordStatusChange` directly inside its transaction (it should — one ledger writer).
- Test placement following `tests/*.test.ts` conventions: parser cases (`SO-000192297`, bare digits, `SP-…`, empty), decide-step matrix (fetch-fails / CANCELED / already-COMPLETED / UNPAID-with-SO / happy CONFIRMED / legacy SHIPPED), `planSync` end-state resi-only rule, `shouldRunSync`-adjacent poll gating if extracted.
- Migration via `yarn db:generate` only (repo rule: yarn; `db:push`/`db:migrate` are never run here — the human applies it). Expect one plain `ALTER TABLE "pg-drizzle_order" ADD COLUMN "invoice_id" integer` + `ADD COLUMN "invoice_no" text`, both nullable, no data statement. Hand the SQL to the human partner.
- The admin page's poll component placement (`admin-orders-filter.tsx`'s client island or a sibling small component) and its cleanup correctness; the last-updated timestamp's exact spot next to the manual sync button.

## 7. Migration summary

- No enum change.
- `order` gains two nullable columns: `invoice_id integer`, `invoice_no text`.

## 8. My calls, listed for checking

1. Route is **closed by default** (unset token ⇒ 401 always), unlike the sink's open-when-unset default.
2. Same env token as the sink (`JUBELIO_WEBHOOK_SINK_TOKEN`) — one secret to rotate.
3. `ref_no` parser accepts `SO-<digits>` and bare digits; everything else ignored.
4. The hook re-fetches the SO and treats the fetch as the evidence; the body alone never flips a status.
5. Fetched SO `CANCELED` → cancel path via `cancelOrder`, not `COMPLETED`.
6. `UNPAID` rows with an SO id do not flip on a hook (confirm-retry path owns that healing).
7. Invoice id/number stored on `orders` (new nullable columns), refreshed idempotently on every hook.
8. History row: `source: 'sync'`, `note: null` — the faktur is never named on a customer surface (owner ruling 2026-11-08).
9. Poll uses the existing `POST /api/admin/sync` / `force()` door; page-load `maybe()` untouched at 5 min (owner confirmed the two clocks are separate: 5 min = server throttle, 10 s = browser timer).
10. Poll pauses on hidden tabs, skips a tick while a previous poll fetch is in flight, and surfaces a "last updated" timestamp + `router.refresh()` when the run changed something (owner ruling 2026-11-08).
11. No `ref_no = booking_id` adoption at SO create this round (PRD §6 #16 stays parked).
12. COMPLETED-with-resi rows stop being fetched; COMPLETED-without-resi keep being fetched until the resi lands.
13. Consumer route inserts a verbatim capture into `webhook_captures` (owner ruling 2026-11-08) so the observation channel survives the callback repoint; the insert is best-effort and never blocks the flip.
