# Invoice Webhook → COMPLETED + Resi Polling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume Jubelio's `hook-invoice` webhook to move a `CONFIRMED` order to `COMPLETED` when the faktur is formed, and keep polling resi (tracking numbers) for `CONFIRMED` orders and `COMPLETED` orders that have no resi yet — via the existing manual button, a new 10-second client poll, and the unchanged 5-minute page-load fallback.

**Architecture:** One new public route (`/api/jubelio/hooks/[token]`) sits next to the observation sink, which stays untouched. The hook is a *hint*: the route saves a verbatim capture, joins `ref_no` → `jubelio_so_id`, re-fetches the SO with the system account, and only then flips — inside one guarded transaction with an audit row. The pure decision logic lives in a directive-free module (`invoice-hook.ts`); the sync core (`daily-sync.ts`) relaxes from "skip end states" to "end states may still receive resi-only patches", and `apply()`'s guarded UPDATE learns the same split. A small client island polls the existing manual-sync endpoint every 10 s while the admin panel is open and shows a last-updated timestamp.

**Tech Stack:** Next.js 15 App Router (RSC + `"use client"` islands), Drizzle ORM + postgres-js, t3-env, Vitest 5 (node env, no DOM), Base UI shadcn components, sonner toasts.

**Spec:** `docs/superpowers/specs/2026-11-08-invoice-webhook-status-design.md` — §-references below point at it. Read it before starting; it carries the *why* and the human partner's decisions, this plan carries the *where* and the *exact names*.

## Global Constraints

- **yarn only.** Never `npm`/`pnpm`/`bun`. There is no `test` script: run tests as `yarn vitest run <file>` (or `yarn vitest run` for the whole suite). Type/lint gate is `yarn check` (`next lint && tsc --noEmit`).
- **Migrations: `yarn db:generate` only.** Never `db:push`, never `db:migrate`. Hand the generated SQL to the human partner; applying it is theirs (Task 1).
- **Commits land on `main`** (authorized per plan, human precedent 2026-11-01; pushing still requires asking). `git add` **only the exact paths a task names** — never `git add -A`, never `git commit -a`. Commit messages end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`; the commit blocks below show subject lines only.
- **Table prefix:** every table is created through `createTable = pgTableCreator((name) => \`pg-drizzle_${name}\`)` (`src/server/db/schema.ts:14`), so the order table is `pg-drizzle_order` in SQL.
- **Vitest runs `environment: "node"`** — no DOM harness. Anything a test must exercise lives in a directive-free `.ts` module, never only inside a `.tsx` island. Client islands may `import type` from `@/server/*` only (precedent: `sync-now-button.tsx:11`); runtime imports would drag drizzle into the browser bundle.
- **The webhook token is the existing `JUBELIO_WEBHOOK_SINK_TOKEN`** (spec §8.2) — no new env var. But the hook route's default is the **opposite** of the sink's: unset ⇒ 401 for every path (spec §8.1), because this route writes order status.
- **`vitest.config.ts` already sets `JUBELIO_WEBHOOK_SINK_TOKEN: "test-sink-token"`** — hook tests reuse it; do not add env keys there.
- **Vocabulary is frozen:** no new `order_status` member, no new tab, no new customer pill, no new `StatusHistorySource`. `source: "sync"` for every hook-driven write.
- **The faktur never appears on a customer surface** (spec §8.8): the hook's history row carries `note: null`. Invoice id/number live in the new `orders` columns for admin/audit only; no display UI in this plan.
- **Customer stepper contracts hold** (spec 2026-11-01 §4.5/§4.6): no invented steps, resi backfill stays silent, `orders.updated_at` is never presented as "when this status began".
- **One writer per transition:** `CANCEL` only through `cancelOrder`; the hook's `COMPLETED` flip mirrors `confirm-order`'s transaction shape (`FOR UPDATE` pre-read + guarded UPDATE + `recordStatusChange` in the same tx, `src/app/api/orders/[id]/confirm/route.ts:169-208`).

## Review Focus

The five ways this ships broken. Each line names the test that pins it, in the task that owns the code.

1. **A marketplace hook is treated as ours.** The same account's webhook URL receives hooks for 184k marketplace SOs whose `ref_no` is `SP-…`. A parser that throws, or a route that 500s or writes on them, poisons the log and risks upstream retry storms. Expected: unjoined `ref_no` → capture still stored, `200 {ok:false, reason}`, zero order reads. → `tests/invoice-hook.test.ts` (parser cases) + `tests/invoice-hook-route.test.ts` (unjoined event), Tasks 2 and 3.
2. **A retried or duplicate hook double-flips.** Jubelio retries stalled handlers; the same faktur hook can arrive twice. Expected: second arrival writes no second history row, answers `changed:false`, and still refreshes the invoice columns idempotently. → `tests/invoice-hook-route.test.ts` (already-COMPLETED case), Task 3.
3. **An unreachable upstream looks like a completed order.** The hook fetch must succeed before anything flips: timeout/5xx/401/403/unparseable body → nothing written, `200 {ok:false}` so Jubelio can retry later. → `tests/invoice-hook-route.test.ts` (fetch-fails case), Task 3.
4. **A resi poll regresses a status or revives a cancel.** The widened sync must never write a status onto a `COMPLETED` row, must never touch a `CANCEL` row at all, and the resi-only write into `COMPLETED` must be guarded so a racing admin cancel wins. → `tests/daily-sync.test.ts` (end-state cases) + `tests/order-sync.filter.test.ts` (guard SQL), Tasks 4 and 5.
5. **The poll stamps Jubelio.** A 10 s interval with a sweep slower than 10 s would stack requests; a hidden tab must not poll at all. Expected: tick skipped while the previous fetch is in flight or the tab is hidden. → `tests/sync-poll.test.ts` (`shouldPollTick`), Task 6.

---

## File Structure

**Create**

| path | responsibility |
|---|---|
| `src/server/invoice-hook.ts` | Pure hook logic: token check (closed-by-default), event parse, `ref_no` join parser, flip/cancel decision. No runtime imports beyond `import type`. |
| `src/app/api/jubelio/hooks/[token]/route.ts` | The webhook consumer: capture → join → fetch → decide → write. All I/O lives here. |
| `src/app/_components/sync-poll.ts` | Pure poll helpers: interval constant, `shouldPollTick`, `formatLastSyncLabel`. Directive-free so tests can run. |
| `src/app/_components/sync-controls.tsx` | Client island: the manual sync button (today's `SyncNowButton` behavior) + 10 s poll + last-updated timestamp + refresh-on-change. |
| `tests/invoice-hook.test.ts` | Parser/decision/token matrix. |
| `tests/invoice-hook-route.test.ts` | Route behavior over mocked db/cancel/system-client. |
| `tests/sync-poll.test.ts` | Poll tick gating + timestamp format. |

**Modify**

| path | change |
|---|---|
| `src/server/db/schema.ts` | `orders` gains `invoiceId` (integer, nullable) + `invoiceNo` (text, nullable). |
| `src/server/daily-sync.ts` | `planSync` end-state rule split: `CANCEL` skipped entirely; `COMPLETED` allowed resi-only patches, never status patches. |
| `src/server/order-sync.ts` | `listLinkedOrders` query widens to `COMPLETED`-without-resi; `apply`'s UPDATE guard splits resi-only vs status patches. |
| `tests/daily-sync.test.ts` | New end-state cases; two existing assertions reworded to the new contract (named in Task 4). |
| `tests/order-sync.filter.test.ts` | New query + guard cases. |
| `src/app/admin/orders/page.tsx` | `SyncNowButton` → `SyncControls`. |
| `.env.example` | Comment on `JUBELIO_WEBHOOK_SINK_TOKEN` gains one sentence: it also gates the hook route (closed when unset). |

**Delete**

| path | reason |
|---|---|
| `src/app/_components/sync-now-button.tsx` | Superseded by `sync-controls.tsx`, which carries the same button behavior plus poll + timestamp. Single caller is `src/app/admin/orders/page.tsx`. |

---

### Task 1: Schema — invoice columns on `orders`

**Files:**
- Modify: `src/server/db/schema.ts` (the `orders` table, after `jubelioSoId` at line 168)
- Create: `drizzle/00XX_*.sql` (via generator — do not hand-write)

**Interfaces:**
- Produces: `orders.invoiceId: integer | null`, `orders.invoiceNo: string | null` on every `orders` select; Tasks 3 and 5 write/read them.

- [ ] **Step 1: Add the two columns**

In `src/server/db/schema.ts`, inside the `orders` table definition directly below `jubelioSoId`:

```ts
// Faktur identity from Jubelio's hook-invoice webhook (spec 2026-11-08 §4.3).
// Written by the hook route (and refreshed idempotently by retries); display
// is admin/audit-only, never customer-facing.
invoiceId: t.integer("invoice_id"),
invoiceNo: t.text("invoice_no"),
```

Both nullable, no default — legacy rows keep `NULL`.

- [ ] **Step 2: Generate the migration**

Run: `yarn db:generate`
Expected: one new `drizzle/00XX_*.sql` containing exactly two statements:

```sql
ALTER TABLE "pg-drizzle_order" ADD COLUMN "invoice_id" integer;
--> statement-breakpoint
ALTER TABLE "pg-drizzle_order" ADD COLUMN "invoice_no" text;
```

**STOP if the generator emits anything else** (a table recreate, a drop, a cast, extra statements) — report the SQL to the human partner instead of committing it.

Do NOT run `db:push`/`db:migrate` — the human applies the SQL.

- [ ] **Step 3: Typecheck**

Run: `yarn check`
Expected: pass (adding nullable columns breaks nothing).

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(schema): invoice id/no columns on orders"
```

---

### Task 2: Pure hook module — `src/server/invoice-hook.ts`

**Files:**
- Create: `src/server/invoice-hook.ts`
- Test: `tests/invoice-hook.test.ts`

**Interfaces:**
- Consumes: nothing at runtime (directive-free; only `import type` if any).
- Produces (Task 3's route and its tests rely on exactly these):

```ts
export type InvoiceHookEvent =
  | { action: "hook-invoice"; salesorderId: number | null; invoiceId: number | null; invoiceNo: string | null }
  | { action: "other"; actionName: string };

/** null = body unparseable as an object. */
export function parseHookEvent(body: unknown): InvoiceHookEvent | null;

/** `SO-000192297` → 192297; bare `"192297"` → 192297; everything else (incl. `SP-…`) → null. */
export function parseInvoiceHookRef(value: unknown): number | null;

/** `"CANCELED"` (case/space-tolerant) → `"cancel"`; every other SO state → `"flip"`. */
export function decideHookFlip(internalStatus: string): "flip" | "cancel";

/** Unlike `checkSinkToken`: configured unset ⇒ false ALWAYS (spec §4.1). */
export function checkHookToken(provided: string | undefined, configured: string | undefined): boolean;
```

- [ ] **Step 1: Write the failing tests**

`tests/invoice-hook.test.ts` — cases, all pinned to spec values:

`parseInvoiceHookRef`:
- `"SO-000192297"` → `192297` (owner-verified shape, spec §1)
- `"SO-192297"` → `192297` (padding is not guaranteed)
- `"192297"` → `192297` (defensive bare digits, spec §8.3)
- `"SP-261107NGP1K1DB"` → `null` (the live marketplace capture, spec §1)
- `""`, `"SO-"`, `"SO-0"`, `"  "`, `null`, `undefined`, `42`, `"SO-12ab"` → `null`
- `" SO-000192297 "` → `192297` (trim before match)

`parseHookEvent` (body = the spec §1 capture):
```ts
{ action: "hook-invoice", ref_no: "SO-000192297", invoice_id: 188102, invoice_no: "INV-000188102" }
```
→ `{ action: "hook-invoice", salesorderId: 192297, invoiceId: 188102, invoiceNo: "INV-000188102" }`
- numeric-string `invoice_id: "188102"` → `188102`; `invoice_id: 0`/negative → `null`
- missing `invoice_id`/`invoice_no` → `null` fields (not an error)
- missing/unparseable `ref_no` → `{ action: "hook-invoice", salesorderId: null, invoiceId: …, invoiceNo: … }` — `salesorderId: null` means unjoined, the route answers `{ok:false, reason:"unjoined"}`
- `action: "hook-salesorder"` → `{ action: "other", actionName: "hook-salesorder" }`
- `action: "hook-salesorder"` → `{ action: "other", actionName: "hook-salesorder" }`
- `[]`, `"text"`, `null`, `undefined` → `null`
- unknown `action` value → `{ action: "other", actionName: <the raw string> }`

`decideHookFlip`:
- `"CANCELED"`, `" canceled "`, `"Canceled"` → `"cancel"`
- `"COMPLETED"`, `"PAID"`, `"SHIPPED"`, `"PENDING"`, `"weird"` → `"flip"` (SO exists and is ours = evidence; spec §4.3)

`checkHookToken`:
- `("tok", undefined)` → `false`, `(undefined, undefined)` → `false` — **the inverted default is the point**
- `("tok", "tok")` → `true`; `("tok ", "tok")` → `false` (no normalisation, same as the sink)
- `("tok", " tok")` → `true` (configured is trimmed, provided is not — the exact asymmetry `checkSinkToken` has, pinned so it cannot drift differently)

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/invoice-hook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Directive-free, no runtime imports. `parseInvoiceHookRef`: trim, then `/^SO-(\d+)$/` or `/^\d+$/`, parse with `Number`, require `Number.isInteger(n) && n > 0`. `parseHookEvent`: object-only unwrap (no `{data:…}` envelope — the live body is flat), `positiveInt` helper for ids, `nonEmptyString` for `invoice_no`. Reimplement both tiny helpers locally rather than exporting new ones from `jubelio-probe.ts` (that module stays sink-owned).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/invoice-hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/invoice-hook.ts tests/invoice-hook.test.ts
git commit -m "feat(hook): pure invoice-webhook parse and decision core"
```

---

### Task 3: Hook route — `src/app/api/jubelio/hooks/[token]/route.ts`

**Files:**
- Create: `src/app/api/jubelio/hooks/[token]/route.ts`
- Test: `tests/invoice-hook-route.test.ts`

**Interfaces:**
- Consumes (from Task 2): `parseHookEvent`, `parseInvoiceHookRef` (used only inside `parseHookEvent`), `decideHookFlip`, `checkHookToken`.
- Consumes (existing): `captureBody`, `redactHeaders`, `detectCaptureRefs` from `@/server/jubelio-probe`; `webhookCaptures`, `orders` from `@/server/db/schema`; `db` from `@/server/db`; `withSystemClient` from `@/server/jubelio-token`; `readSalesOrderState` from `@/server/daily-sync`; `cancelOrder` from `@/server/cancel-order`; `recordStatusChange` from `@/server/status-history`; `END_STATUSES` from `@/server/order-status`; `env` from `@/env`.
- Produces: `POST` handler, always `200 {ok: boolean, changed?: boolean, reason?: string}` after the token gate (401 before it).

- [ ] **Step 1: Write the failing tests**

`tests/invoice-hook-route.test.ts` — mock seams, following `tests/jubelio-sink-route.test.ts` (capturing db builder) and `tests/order-sync.filter.test.ts` (SQL capture via `PgDialect`):

```ts
vi.mock("@/server/db", () => ({ db: { /* capturing builder: insert/update/select/transaction */ } }));
vi.mock("@/server/jubelio-token", () => ({ withSystemClient: vi.fn() }));
vi.mock("@/server/cancel-order", () => ({ cancelOrder: vi.fn() }));
vi.mock("@/env", () => ({ env: { JUBELIO_WEBHOOK_SINK_TOKEN: state.token } })); // state = vi.hoisted, mutable per test
```

Cases (request = `POST` with a `Request("http://x/api/jubelio/hooks/tok", {method:"POST", body, headers})`):

1. **Closed by default:** `state.token = undefined`, any token segment → 401, zero db calls. (The sink's open-when-unset must NOT leak here.)
2. **Wrong token with configured token** → 401.
3. **Happy flip:** configured `"tok"`, body = the spec §1 capture with `ref_no: "SO-000192297"`; db select resolves one `{id: "o-1", status: "CONFIRMED"}`; `withSystemClient` resolves a `PAID_SO`-shaped header; the guarded UPDATE returns one row. Assert: capture row inserted first (into `webhookCaptures`, source `"hook:hook-invoice"`, refs extracted); SO fetched with id `192297`; UPDATE `set` = `{status:"COMPLETED", invoiceId:188102, invoiceNo:"INV-000188102"}` with a `notInArray(status, END_STATUSES)` guard; history row `{fromStatus:"CONFIRMED", toStatus:"COMPLETED", source:"sync", note:null}` written on the **tx**; response `200 {ok:true, changed:true}`.
4. **Already COMPLETED (retried hook):** pre-read resolves `status:"COMPLETED"`; the (unguarded, invoice-only) update runs; **zero** history rows; response `200 {ok:true, changed:false}`.
5. **Upstream CANCELED:** header `internal_status:"CANCELED"` → `cancelOrder` called with `{orderId:"o-1", source:"sync", note:"SO #192297 dibatalkan di Jubelio"}`; response `{ok:true, changed: <cancelOrder result>}`; no direct status UPDATE.
6. **Fetch fails:** `withSystemClient` rejects → no UPDATE, no history, `200 {ok:false, reason:"upstream-unreadable"}`; capture still stored.
7. **Unparseable header** (`readSalesOrderState` → null, e.g. body `{}`) → same as 6 with reason `"upstream-unreadable"`.
8. **UNPAID with SO:** pre-read resolves `status:"UNPAID"` → no write, `200 {ok:false, reason:"not-confirmed"}` (spec §4.3.5 — the confirm-retry path owns that healing).
9. **Marketplace ref (`SP-…`):** order lookup never runs; `200 {ok:false, reason:"unjoined"}`; capture still stored.
10. **Unparseable body** (`"not json"`) → capture stored with `body:null`; `200 {ok:false, reason:"unparseable"}`.
11. **Unhandled action** (`action:"hook-salesorder"`) → capture stored; `200 {ok:false, reason:"unhandled action"}`.
12. **Capture insert fails** (insert throws) → flip still proceeds (best-effort capture, spec §4.1); response unaffected.
13. **Race lost:** guarded UPDATE returns zero rows → no history row, `200 {ok:true, changed:false}`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/invoice-hook-route.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement the route**

`export const runtime = "nodejs"; export const dynamic = "force-dynamic";`

Handler order (spec §4.1–§4.3):
1. `checkHookToken(token, env.JUBELIO_WEBHOOK_SINK_TOKEN)` — false ⇒ 401 `{ok:false, error:"Token webhook tidak valid."}` (sink's copy).
2. Read text (`try/catch` → `""`), `captureBody(text, contentType)`, `detectCaptureRefs`, `parseHookEvent`.
3. Best-effort capture insert — same column shape as the sink route (`source`, `method`, `contentType`, redacted headers, `body`/`rawBody`/`truncated`/`byteLength`, the three ref columns), `source` = `` `hook:${actionName}` `` for `other`, `"hook:hook-invoice"` for the invoice event, `"hook"` for an unparseable body. Wrap insert AND prune (same `KEEP_CAPTURES` shape, own local `const KEEP_CAPTURES = 200`) in one `try/catch` that only logs. **No prune run on the unparseable/unhandled paths is also fine — simplest: always attempt insert, always attempt prune, both best-effort.**
4. `event === null` → `{ok:false, reason:"unparseable"}`; `action:"other"` → `{ok:false, reason:"unhandled action"}`.
5. `event.salesorderId === null` → `{ok:false, reason:"unjoined"}`.
6. Order lookup: `db.select({id, status}).from(orders).where(eq(orders.jubelioSoId, event.salesorderId)).orderBy(desc(orders.createdAt)).limit(1)` (spec §4.2: newest on a multi-match anomaly, log the anomaly). None → `{ok:false, reason:"unjoined"}`.
7. `withSystemClient((c) => c.getSalesOrder(id))` in `try/catch`; then `readSalesOrderState`. Throw or `null` → `{ok:false, reason:"upstream-unreadable"}` (log with the SO id, like `order-sync` does).
8. `decideHookFlip(state.internalStatus)`:
   - `"cancel"` → `cancelOrder(db, {orderId, source:"sync", note: \`SO #${id} dibatalkan di Jubelio\`})` → `{ok:true, changed: result.cancelled}`.
   - `"flip"` → transaction:
     - `FOR UPDATE` pre-read `{status}` (confirm-route shape). Row gone → `{ok:false, reason:"unjoined"}`.
     - `status === "UNPAID"` → log `hook-invoice: SO #<id> arrived for an UNPAID order — confirm flow owns this` and return `{ok:false, reason:"not-confirmed"}`.
     - `status === "COMPLETED" || status === "CANCEL"` → invoice refresh only: `update(orders).set({invoiceId, invoiceNo}).where(eq(orders.id, orderId))` (idempotent rewrite, spec §4.3.4), no history row, `{ok:true, changed:false}`.
     - Otherwise (CONFIRMED / legacy SHIPPED / anything non-end non-UNPAID): guarded UPDATE `.set({status:"COMPLETED", invoiceId, invoiceNo})` `.where(and(eq(orders.id, orderId), notInArray(orders.status, [...END_STATUSES])))` `.returning({id})`. Exactly one row → `recordStatusChange(tx, {orderId, fromStatus: before.status, toStatus:"COMPLETED", source:"sync", note:null})` → `{ok:true, changed:true}`; zero rows (race lost) → `{ok:true, changed:false}`, no history.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/invoice-hook-route.test.ts tests/invoice-hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite**

Run: `yarn check && yarn vitest run`
Expected: pass (the route is additive; nothing existing imports it).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/jubelio/hooks/[token]/route.ts tests/invoice-hook-route.test.ts .env.example
git commit -m "feat(hook): hook-invoice consumer flips confirmed orders on faktur"
```

(The `.env.example` edit — one sentence on the token var — belongs to this commit.)

---

### Task 4: Sync core — end states may receive resi-only patches

**Files:**
- Modify: `src/server/daily-sync.ts` (`planSync`, lines ~200–247)
- Test: `tests/daily-sync.test.ts`

**Interfaces:**
- Consumes: unchanged `SyncStatus`, `STATUS_RANK`, `mapInternalStatus`, `readSalesOrderState`, `SoVerdict`, `LocalOrderSnapshot`.
- Produces: `planSync(localOrders, verdictsBySoId): SyncPatch[]` — same signature, new end-state contract (spec §4.4):
  - `CANCEL` row → nothing, ever.
  - `COMPLETED` row → resi/shipper backfill only (when they differ); **never** a status patch, **never** a cancel patch (even on a 404 verdict or upstream `CANCELED`).
  - Non-end rows behave exactly as today (this is the missed-webhook fallback).

- [ ] **Step 1: Write the failing tests**

Add to `tests/daily-sync.test.ts`:

1. COMPLETED order + `state` verdict `PAID` with a new resi → patch `{orderId, trackingNumber, shipper}` with **no** `status` key.
2. COMPLETED order + `missing` verdict → `[]` (no cancel).
3. COMPLETED order + upstream `CANCELED` verdict → `[]`.
4. COMPLETED order + identical resi already stored → `[]`.
5. CONFIRMED order + `COMPLETED` SO header → status patch + resi (fallback preserved — pin both keys).

**Reword two existing tests** to the new contract (they currently assert a blanket end-state skip):
- `"never pulls an end-state row forward, whatever the SO says"` (line 269) — keep the no-status assertion; if its fixture now also carries a differing resi, assert the resi-only patch is emitted.
- `"never cancels a COMPLETED row on a 404"` (line 280) — keep; optionally also assert a differing resi still backfills.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/daily-sync.test.ts`
Expected: new cases FAIL (blanket `continue` drops everything), reworded cases FAIL or pass vacuously.

- [ ] **Step 3: Implement**

Replace `if (isEndState(order.status)) continue;` with:

- `order.status === "CANCEL"` → `continue`.
- `const completed = order.status === "COMPLETED";`
- `missing` verdict and upstream-`CANCELED` paths: `if (completed) continue;` before pushing a cancel patch.
- Status assignment: `if (!completed && rank(next) > rank(order.status)) patch.status = next;`
- Resi/shipper backfill: unchanged, runs for every non-CANCEL row.
- Update the module comment so the resi-only rule is stated where the old blanket skip was documented.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/daily-sync.test.ts`
Expected: PASS, including every pre-existing case.

- [ ] **Step 5: Commit**

```bash
git add src/server/daily-sync.ts tests/daily-sync.test.ts
git commit -m "feat(sync): completed orders keep receiving resi-only patches"
```

---

### Task 5: Sync deps — widened query + split guard

**Files:**
- Modify: `src/server/order-sync.ts` (`createDbSyncDeps`, lines ~276–393)
- Test: `tests/order-sync.filter.test.ts`

**Interfaces:**
- Consumes: Task 4's resi-only patches (`SyncPatch` without `status`).
- Produces: `listLinkedOrders()` returning `UNPAID/CONFIRMED/SHIPPED` rows **plus** `COMPLETED` rows with `trackingNumber IS NULL`; `apply()` accepting resi-only patches for `COMPLETED` rows while keeping status writes barred from end states.

- [ ] **Step 1: Write the failing tests**

Add to `tests/order-sync.filter.test.ts` (SQL assertions via the existing `sqlOf` helper):

1. `listLinkedOrders` WHERE SQL contains `OR` of (`status NOT IN (…end states…)`) and (`status = 'COMPLETED' AND "tracking_number" IS NULL`) — decode the captured condition and assert both disjuncts appear.
2. Resi-only patch (`{orderId, trackingNumber}`) against a row the pre-read reports as `COMPLETED`: the UPDATE's guard SQL contains `status` `<>`/`NOT IN` **only `CANCEL`** (not the full end-state list); landed → no history row written (resi stays silent, spec §4.5).
3. Status patch against a `COMPLETED` row: guard SQL still carries the full end-state exclusion; UPDATE returns zero rows → no history row, reported not-landed.
4. Resi-only patch against a `CANCEL` row: guard excludes it → zero rows, no history.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/order-sync.filter.test.ts`
Expected: FAIL — query still excludes all end states; guard still blocks resi into `COMPLETED`.

- [ ] **Step 3: Implement**

`listLinkedOrders`:

```ts
.where(
  and(
    isNotNull(orders.jubelioSoId),
    or(
      notInArray(orders.status, [...END_STATUSES]),
      and(eq(orders.status, "COMPLETED"), isNull(orders.trackingNumber)),
    ),
  ),
)
```

Import `eq`, `isNull`, `or` alongside the existing operators; extend the method's comment (a COMPLETED row re-enters the query until its resi lands, then drops out again).

`apply`: the guarded UPDATE's predicate depends on whether the patch carries a status:

```ts
.where(
  and(
    eq(orders.id, patch.orderId),
    status
      ? notInArray(orders.status, [...END_STATUSES])
      : notInArray(orders.status, ["CANCEL"]),
  ),
)
```

(`status` is the `const` copy the function already makes.) The `before.status !== status` history gate needs no change — `status` is `undefined` on a resi-only patch, so no audit row. Update the four-gate comment accordingly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/order-sync.filter.test.ts tests/order-sync.test.ts`
Expected: PASS — every pre-existing case (status guards, locks, cancel routing) unchanged.

- [ ] **Step 5: Typecheck + full suite**

Run: `yarn check && yarn vitest run`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/order-sync.ts tests/order-sync.filter.test.ts
git commit -m "feat(sync): poll resi for completed orders, guard split by patch kind"
```

---

### Task 6: Client poll — timestamp + 10 s refresh loop

**Files:**
- Create: `src/app/_components/sync-poll.ts`
- Create: `src/app/_components/sync-controls.tsx`
- Delete: `src/app/_components/sync-now-button.tsx`
- Modify: `src/app/admin/orders/page.tsx` (import at line 22, usage at line 278, header comment at lines 276–277)
- Test: `tests/sync-poll.test.ts`

**Interfaces:**
- Consumes: `POST /api/admin/sync` → `{ok: true, result: SyncRunResult}` (unchanged route); `useSessionExpiry` (`signOutOnExpiry`); base `Button` with `isLoading`.
- Produces (pure, tested): 

```ts
export const POLL_INTERVAL_MS = 10_000;
/** One tick runs only when the tab is visible and no previous fetch is in flight. */
export function shouldPollTick(input: { visible: boolean; inFlight: boolean }): boolean;
/** Local clock, hand-assembled `id-ID` style with dots: `14.32.05` (h23). */
export function formatLastSyncLabel(date: Date): string;
```

- [ ] **Step 1: Write the failing tests**

`tests/sync-poll.test.ts`:

`shouldPollTick`:
- `{visible:true, inFlight:false}` → `true`
- `{visible:false, inFlight:false}` → `false` (hidden tab never polls)
- `{visible:true, inFlight:true}` → `false` (a sweep slower than 10 s must not stack)
- `{visible:false, inFlight:true}` → `false`

`formatLastSyncLabel`:
- `new Date(2026, 0, 1, 14, 32, 5)` → `"14.32.05"`
- `new Date(2026, 0, 1, 3, 7, 0)` → `"03.07.00"` (h23 zero-padding, dots not colons)

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/sync-poll.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sync-poll.ts`**

Directive-free `.ts` (no `"use client"`, no React). `formatLastSyncLabel` hand-assembles from `getHours()/getMinutes()/getSeconds()` with `padStart(2,"0")` and `.` separators — same determinism rationale as `formatStepTimestamp` (`src/lib/format.ts:44-63`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/sync-poll.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `sync-controls.tsx`**

`"use client"` island replacing `SyncNowButton` wholesale (its file is deleted in Step 7):

- Renders: the same outline `Button` (`ArrowsClockwise` icon, "Sinkron sekarang", `isLoading` while a **manual** click runs) plus, to its right, a muted `<p>` — rendered only once a run has completed — reading `Diperbarui {formatLastSyncLabel(lastSync)}`.
- Manual click handler: the exact logic from today's `sync-now-button.tsx` (`fetch("/api/admin/sync")`, 401 → `signOutOnExpiry()`, toast bit-building from `SyncRunResult`, `router.refresh()` on success) plus one addition: on success set `lastSync` to `new Date()`.
- Poll: `useEffect` on mount sets `window.setInterval(tick, POLL_INTERVAL_MS)`; cleanup clears it. `tick` is async, reads two refs — `inFlightRef` (set `true` around the fetch) and `document.visibilityState` — and early-returns unless `shouldPollTick({visible: document.visibilityState === "visible", inFlight: inFlightRef.current})`. Poll fetch: same endpoint; **no toasts**; on `{ok:true}` → `setLastSync(new Date())` and, when `result.synced + result.cancelled > 0`, `router.refresh()`; on 401 → `signOutOnExpiry()`; on anything else → silent (a failed poll must not toast-spam every 10 s). Clear `inFlightRef` in a `finally`.
- Layout: the page header is a `flex flex-wrap items-start justify-between` row; render `Button` + timestamp inside a small right-aligned flex group so the timestamp sits beside the button without breaking the header wrap.

- [ ] **Step 6: Swap the page over**

`src/app/admin/orders/page.tsx`: import `SyncControls` instead of `SyncNowButton`; replace the element (`className="mt-1"` stays); update the header comment to name all three triggers: page-load throttle (5 min), manual button, and the 10 s poll this island runs while the panel is open.

- [ ] **Step 7: Delete the old component and verify**

```bash
rm src/app/_components/sync-now-button.tsx
```

Run: `yarn check && yarn vitest run`
Expected: pass — no remaining importer of `SyncNowButton` (grep to confirm before deleting: `grep -rn SyncNowButton src/` must show only `page.tsx` and the file itself).

- [ ] **Step 8: Commit**

```bash
git add src/app/_components/sync-poll.ts src/app/_components/sync-controls.tsx src/app/admin/orders/page.tsx
git rm src/app/_components/sync-now-button.tsx
git commit -m "feat(admin): 10s sync poll with last-updated indicator"
```

---

## Task dependency summary

Tasks 1 → 2 → 3 are strictly sequential (route needs the pure module; columns predate both). Task 4 must precede Task 5 (the widened `apply` guard exists because `planSync` now emits resi-only patches). Task 6 is independent of 3–5 and may run in parallel with them after Task 1.
