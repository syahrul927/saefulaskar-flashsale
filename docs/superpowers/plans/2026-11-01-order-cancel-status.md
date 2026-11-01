# Order CANCEL Status, Status History & Detail Stepper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an order a way to end: an admin `Batalkan` button and a sync 404 both move it to a new `CANCEL` status, return its units to the session quota exactly once, and record every status transition in a new `order_status_history` table that a per-row detail dialog renders as a stepper.

**Architecture:** One pure vocabulary module (`src/server/order-status.ts`) derived from the `pgEnum`, so widening the DB enum widens every consumer's type in the same commit. One transactional service function (`cancelOrder`) owns the whole cancel transition — status + quota release + history row — and is called from exactly two places: the new cancel route and the sync's `apply()`. The pure sync core (`daily-sync.ts`) only *decides* (it gains a three-way verdict and can emit a cancel patch); it never writes. Presentation logic that both surfaces share lives in directive-free `.ts` modules (`status-steps.ts`, `order-contact.ts`), because `vitest.config.ts` runs `environment: "node"` and there is no DOM test harness — anything that must be tested cannot live in a `.tsx` island.

**Tech Stack:** Next.js 15 App Router (RSC + `"use client"` islands), Drizzle ORM + postgres-js, t3-env, Vitest 5, Base UI (`@base-ui/react`) primitives wrapped in `src/components/ui/`, sonner toasts, Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-01-order-cancel-status-design.md` — §-references below point at it. Read it before starting; it carries the *why* and the human partner's decisions, this plan carries the *where* and the *exact names*.

## Global Constraints

- **yarn only.** Never `npm`/`pnpm`/`bun`. There is no `test` script: run tests as `yarn vitest run <file>` (or `yarn vitest run` for the suite). Type/lint gate is `yarn check` (`next lint && tsc --noEmit`).
- **Migrations: `yarn db:generate` only.** Never `db:push`, never `db:migrate`. Hand the generated SQL to the human partner; applying it is theirs (Task 2).
- **Commits land on `main`.** The human partner chose that explicitly on 2026-11-01, which is also their CLAUDE.md confirmation for committing on this branch — do not create a feature branch for this plan. Because the tree already carries unrelated uncommitted work (jubelio v2 / stock images), `git add` **only the exact paths a task names**: never `git add -A`, never `git commit -a`, never `git add -u <directory>`. Pushing still requires asking first.
- **Commit messages end with the attribution line this session's instructions require** (`Co-Authored-By: Claude Code <noreply@anthropic.com>`). The `git commit` blocks below show the subject line only; append the attribution when you run them.
- **Base components live in `src/components/ui/`** (dialog, button, badge, spinner, skeleton, sonner). Reuse them; do not hand-roll a modal or a spinner. (The project CLAUDE.md says `src/app/_components/ui/` — that path does not exist; `src/components/ui/` is the real one, aliased `@/components/ui/*`.)
- **Every API-triggering button uses the base `Button`'s `isLoading` prop** (`src/components/ui/button.tsx:46-68`: disables, sets `aria-busy`, renders the spinner). `confirm-order-button.tsx` hand-rolls `disabled` + `<Spinner />`; that is legacy, do not copy it. Both outcomes of every action surface a `sonner` toast.
- **Vocabulary split (spec §3.1):** admin surfaces print the raw enum (`CANCEL`); customer surfaces print Bahasa (`Dibatalkan`). Customer labels come from the typed `CUSTOMER_STATUS_LABEL` map in Task 3 — never re-declare a `Record<string, string>` label map, because that shape degrades silently instead of failing compilation.
- **No `Date` crosses into a client island.** Row/detail types carry pre-formatted strings only (precedent: `TransactionRow`, `src/app/_components/orders-list.tsx:29-41`). Timestamps are formatted server-side by `formatStepTimestamp` (Task 6).
- **A client component may only `import type` from `@/server/*`** (precedent: `orders-list.tsx:9`). Shared *runtime* logic goes in a directive-free `.ts` module — see the comment at `src/app/_components/admin-order-tabs.ts:6-12` for the exact Next.js error this avoids.
- **The mockups may not exist at execution time.** `.superpowers/` is gitignored, so `cancel-flow.html` (option A) and `stepper-home.html` (option A), referenced in Tasks 11 and 12, may be absent from a fresh checkout or a subagent's working copy. Every decision they carry — copy, tone, order, density — is restated in the task that uses it. Where a surviving mockup and the plan disagree, the plan wins.
- **No new routes, no new pages** (spec §2 non-goals). The detail surface is a dialog.
- **Nothing ever nulls `jubelio_so_id`, `tracking_number` or `shipper` on a cancel** (spec §4.3). `SO #192626, deleted upstream` is the evidence the dialog shows.
- **No history rows are invented** (spec §4.5, §8.10): no backfill, no synthesised `updated_at` timestamps. `orders.updated_at` is rewritten by `$onUpdate` (`src/server/db/schema.ts:186`) and must never be presented as "when this status began".

## Review Focus

The five ways this ships broken. Each line names the test that pins it, in the task that owns the code.

1. **A non-404 upstream answer cancels a live, paid order.** Timeout, 401, **403** (the sync reads with the *system* account's token while the SO was created with an *admin's*), 5xx, or a 2xx body without `internal_status` must leave the order untouched and count as `failed`. Only a definitive 404 cancels. → `tests/order-sync.test.ts` (three verdict cases) and `tests/daily-sync.test.ts` (`planSync` emits nothing for `{kind:"unknown"}`), Task 10.
2. **A cancelled order gets pulled back to life.** `rank()` returns `-1` for any status missing from `STATUS_RANK` (`src/server/daily-sync.ts:63-67`) and `planSync:155` compares `rank(next) > rank(order.status)` — so `CANCEL` ranking `-1` means a stale `PAID` read would rewrite a cancelled order to `CONFIRMED` and re-hold nothing while the customer is told it is live. `CANCEL` is a predicate, not a rung. → `tests/daily-sync.test.ts` (`planSync` skips an end-state row even when the SO says PAID), Task 10.
3. **Quota released twice.** Double click, two overlapping sync passes, or an admin racing a sync. `isLoading` on the button is not the guard; the guarded `UPDATE … WHERE status NOT IN ('COMPLETED','CANCEL')` + "exactly one row flipped" is. → `tests/cancel-order.test.ts` (second call flips zero rows → `{cancelled:false}`, zero `session_product` updates, zero history rows), Task 7.
4. **`claimed` goes negative.** A legacy line can reference a product whose quota an admin already truncated; a negative `claimed` silently breaks the storefront cap (`src/server/checkout.ts:121`). → `tests/cancel-order.test.ts` asserts the emitted SQL is `GREATEST(… - $n, 0)`, plus `planQuotaRelease` sums two lines for the same product, Task 7.
5. **The dialog lies about an old order.** No history rows, no phone number anywhere, actor deleted: the stepper must still render the creation step from `orders.created_at`, must not attach a timestamp or an actor it does not have, must not claim who cancelled, and must render no dead WhatsApp link. → `tests/status-steps.test.ts` (empty history; `CANCEL` with no history) and `tests/order-contact.test.ts` (no phone → `null`; garbage → `null`), Tasks 6 and 8.

Also uncovered but compile-guarded rather than test-guarded: the customer `STATUS_LABEL` at `src/app/(storefront)/orders/page.tsx:32` is `Record<string, string>` read as `?? order.status`, so a missing key prints the raw enum to customers with no error. Task 3 replaces it with an exhaustive `Record<OrderStatus, string>`; `yarn check` is the test.

---

## File Structure

**Create**

| path | responsibility |
|---|---|
| `src/server/order-status.ts` | Pure, zero runtime imports. `OrderStatus` derived from the `pgEnum`, end-state/cancellable predicates, the customer label map, `stepLabel`. |
| `src/server/status-history.ts` | The audit table's two seams: `recordStatusChange` (write, works with `db` *or* a `tx`) and `listStatusHistory` (read + actor-name join). |
| `src/server/status-steps.ts` | Pure. Turns history rows + order facts into display-ready `StatusStep[]` for the stepper. |
| `src/server/cancel-order.ts` | Pure `planQuotaRelease` / `composeCancelNote` + the transactional `cancelOrder` writer. The only place that writes `CANCEL`. |
| `src/server/order-contact.ts` | Customer WhatsApp resolution (batched for list pages) + `wa.me` link/message builders. |
| `src/app/api/orders/[id]/cancel/route.ts` | `POST`, OWNER-only, maps `cancelOrder`'s result onto 200/404/409. |
| `src/app/_components/cancel-order-button.tsx` | Client. `Batalkan` trigger + the warning dialog (spec §4.2, mockup `cancel-flow.html` option A). |
| `src/app/_components/status-stepper.tsx` | Client. Renders `StatusStep[]` (mockup `stepper-home.html` option A). |
| `src/app/_components/order-detail-dialog.tsx` | Client. The per-row detail dialog + its self-contained trigger, shared by both surfaces. |
| `tests/order-status.test.ts`, `tests/status-history.test.ts`, `tests/status-steps.test.ts`, `tests/cancel-order.test.ts`, `tests/order-contact.test.ts`, `tests/cancel-route.test.ts`, `tests/format-step-timestamp.test.ts` | One test file per new module, plus the route. |

**Modify**

| path | change |
|---|---|
| `src/server/db/schema.ts` | `orderStatus` enum gains `CANCEL` (:46); new `orderStatusHistory` table via `createTable`; `STATUS_HISTORY_SOURCES` / `StatusHistorySource` next to `PRODUCT_TYPES` (:110-114 precedent). |
| `src/lib/format.ts` | `formatStepTimestamp(date): string` — `28 Okt 2026, 19.04`, assembled from `formatToParts`. |
| `src/app/_components/status-badge.tsx` | `OrderStatus` becomes a re-export of the derived type; `ORDER_STATUS_TONES` gains `CANCEL: "red"`. |
| `src/app/_components/admin-order-tabs.ts` | `TABS` gains `"CANCEL"` (makes `?status=CANCEL` deep links resolve). |
| `src/app/_components/order-filters.ts` | `OrderFilterTab`, `OrderStatusCounts`, `statusCounts` gain `CANCEL`. |
| `src/app/_components/orders-list.tsx` | `DIBATALKAN` pill; `TransactionRow` gains `detail`; row footer mounts `OrderDetailTrigger`. |
| `src/app/(storefront)/orders/page.tsx` | Uses `CUSTOMER_STATUS_LABEL`; builds `detail` (history + session name + CS contact). |
| `src/app/_components/admin-orders-filter.tsx` | `AdminOrderRow` gains `detail` + `cancel`; footer gains `Lihat detail`, `Batalkan`, and an in-row `Hubungi pelanggan` for `CANCEL` rows. |
| `src/app/admin/orders/page.tsx` | Builds `detail` + `cancel`: session-name map, `listStatusHistory`, `resolveCustomerContacts`. |
| `src/server/daily-sync.ts` | `SyncStatus` gains `CANCEL`; `SoVerdict`; `mapInternalStatus("CANCELED") → "CANCEL"`; `planSync` takes verdicts and skips end states; `SyncPatch` gains `cause`; header comment fixed. |
| `src/server/order-sync.ts` | Verdict classification (`JubelioError.status === 404` → `missing`); `SyncRunResult.cancelled`; end-state filter in `listLinkedOrders`; transactional `apply()` that routes cancels through `cancelOrder` and records history; stale cron/pinger comment fixed; `runOrderSyncNow` deleted with the cron route. |
| `src/app/api/orders/[id]/confirm/route.ts` | Final status write becomes transactional and records history (`source: "admin"`). |
| `src/app/api/orders/route.ts` | Creation history row (`source: "checkout"`, `fromStatus: null → UNPAID`) inside the existing transaction. |
| `tests/daily-sync.test.ts`, `tests/order-sync.test.ts`, `tests/order-filters.test.ts`, `tests/status-badge.test.ts`, `tests/confirm-route.test.ts` | Updated for the widened contracts (exact assertions named in each task). |
| `src/env.js`, `.env.example`, `vitest.config.ts` | `CRON_SECRET` deleted (Task 14). |

**Delete** (Task 14): `src/app/api/cron/daily-sync/route.ts`, `src/app/api/cron/backfill-images/route.ts`, `src/server/backfill-images.ts`, `tests/backfill-images.test.ts`, `tests/daily-sync-route.test.ts`, `vercel.json`.

---

### Task 1: Verify the 404 rule against a live sales order

The whole auto-cancel rule rests on one assumption: a 404 from `GET /sales/orders/{id}` under the **system account's** token means "deleted", not "outside this token's company/location". Our only two linked SOs both 404 (spec §1), and a nonsense id also 404s — so there is no positive control in the DB. `authenticateWithJubelio` rejects a company mismatch with `"Company tidak valid"`, but nothing in `src/env.js` pins the system account's company (spec §4.4). Prove it before building on it.

**Files:**
- Create: `.superpowers/spike-so-live.mjs` (gitignored, throwaway — never committed)
- Modify: `docs/superpowers/specs/2026-11-01-order-cancel-status-design.md` (append the dated result to §4.4)

**Interfaces:**
- Consumes: nothing from later tasks.
- Produces: a recorded verdict that decides whether Task 10 ships auto-cancel or ships with `missing` downgraded to `unknown`.

- [ ] **Step 1: Find the two request shapes to copy**

Run: `grep -n "sales/orders\|salesorder\|getSalesOrder\|async list" src/lib/jubelio.ts`
Expected: the by-id path used by `createJubelioClient(...).getSalesOrder(id)` and the list/search path that `toPickerRows` consumes. Copy both paths and their query params verbatim into the spike — do not guess them.

- [ ] **Step 2: Write the spike**

`.superpowers/spike-so-live.mjs`, plain `fetch`, no TS imports (the earlier `spike-so-missing.mjs` run is the precedent). It must:

1. `POST ${JUBELIO_HOST}/login` with `JUBELIO_SYSTEM_EMAIL` / `JUBELIO_SYSTEM_PASSWORD`; keep the **full** body; read the token and `currentCompany` off it.
2. Call the sales-order **list** endpoint (path/params from Step 1) and print the first 5 `salesorder_id`s it returns. This is the positive control: an SO the system account can see.
3. `GET` the **by-id** endpoint for one of those ids and print `status`, plus `internal_status` from the body.
4. Then `GET` by-id for `192626` and `192297` (our two deleted SOs) and print both statuses.

- [ ] **Step 3: Run it**

Run: `node --env-file=.env .superpowers/spike-so-live.mjs`
(If this Node rejects `--env-file`: `set -a; source .env; set +a; node .superpowers/spike-so-live.mjs`.)

Expected — the rule is safe:
- list returns ≥ 1 id;
- by-id for one of those ids returns `200` and a non-empty `internal_status`;
- by-id for `192626` / `192297` returns `404`.

- [ ] **Step 4: Record the verdict in the spec**

Append to §4.4 of `docs/superpowers/specs/2026-11-01-order-cancel-status-design.md`, under the bullet that demands this check:

```markdown
- Verified 2026-11-01 (system account): list returned <n> SOs; `GET /sales/orders/<live id>` → 200 with `internal_status: <value>`; `GET /sales/orders/192626` and `/192297` → 404. The 404 rule therefore distinguishes "deleted" from "outside this token's space", and auto-cancel ships as designed.
```

**If the live read does NOT return 200 + `internal_status`** (404, 403, or a company error): stop. Report to the human partner with the printed statuses. Do not implement Task 10's cancel path — implement Task 10 with `missing` classified as `unknown` (still filtered out of end states, still counted `failed`) and record in the spec that auto-cancel is blocked on a scope guarantee. Every other task is unaffected.

- [ ] **Step 5: Commit the spec (not the spike)**

```bash
git add docs/superpowers/specs/2026-11-01-order-cancel-status-design.md docs/superpowers/plans/2026-11-01-order-cancel-status.md
git commit -m "docs(orders): order CANCEL status design + implementation plan"
```

---

### Task 2: Schema — `CANCEL` and `order_status_history`

**Files:**
- Modify: `src/server/db/schema.ts:46-51` (enum), after `orders` (:148-193) for the new table
- Create: `drizzle/0009_*.sql` + `drizzle/meta/0009_snapshot.json` + `_journal.json` entry (generated, never hand-edited)

**Interfaces:**
- Consumes: nothing.
- Produces: `orderStatus` enum values `["UNPAID","CONFIRMED","SHIPPED","COMPLETED","CANCEL"]`; `orderStatusHistory` table; `STATUS_HISTORY_SOURCES: readonly ["checkout","admin","sync"]` and `type StatusHistorySource = (typeof STATUS_HISTORY_SOURCES)[number]`; `orderStatusHistory.$inferInsert` / `$inferSelect`.

- [ ] **Step 1: Widen the enum**

`src/server/db/schema.ts:46` — append `"CANCEL"` as the **last** member. Last, not mid-list: drizzle emits `ALTER TYPE … ADD VALUE` for an append and a drop-and-recreate for a mid-list insert (spec §6).

- [ ] **Step 2: Add the source vocabulary**

Directly above the new table, following the `PRODUCT_TYPES` / `ProductType` precedent at `src/server/db/schema.ts:110-114`:

```ts
/** Who caused a status transition — `order_status_history.source` (spec §4.5). */
export const STATUS_HISTORY_SOURCES = ["checkout", "admin", "sync"] as const;
export type StatusHistorySource = (typeof STATUS_HISTORY_SOURCES)[number];
```

- [ ] **Step 3: Add the table**

Must go through `createTable` (the `pgTableCreator` prefixes real names `pg-drizzle_…`; a bare `pgTable` would land outside the prefix). Place it after `orderItems` so the `orders` and `user` references above it are already declared:

```ts
export const orderStatusHistory = createTable(
  "order_status_history",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    orderId: t
      .uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    // null on the creation row: there is no status before UNPAID.
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status").notNull(),
    source: t.text("source").notNull().$type<StatusHistorySource>(),
    // Set only when `source = 'admin'`; `set null` keeps the row when the admin
    // is deleted, which is why the display layer needs a "deleted admin" label.
    actorUserId: t
      .text("actor_user_id")
      .references(() => user.id, { onDelete: "set null" }),
    note: t.text("note"),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
  (t) => [index("order_status_history_order_id_idx").on(t.orderId, t.createdAt)],
);
```

Match the sibling tables' callback names — the column builder is `d`, the index builder is `t` (`orders` at `:189-192`). `index` is already imported (`:4`).

No data statement, no backfill (spec §4.5, §8.10).

- [ ] **Step 4: Generate the migration**

Run: `yarn db:generate`
Expected: one new `drizzle/0009_*.sql`, one `drizzle/meta/0009_snapshot.json`, one appended `_journal.json` entry (currently 9 entries, newest `0008_cultured_baron_zemo`).

- [ ] **Step 5: Read the SQL and check its shape**

Run: `cat drizzle/0009_*.sql`
Expected, exactly this shape (precedent `drizzle/0003_empty_newton_destine.sql:1`):

```sql
ALTER TYPE "public"."order_status" ADD VALUE 'CANCEL';--> statement-breakpoint
CREATE TABLE "pg-drizzle_order_status_history" ( … );--> statement-breakpoint
CREATE INDEX "order_status_history_order_id_idx" ON "pg-drizzle_order_status_history" USING btree ("order_id","created_at");
```

**Stop and flag** if it instead contains `DROP TYPE`, a rebuilt `CREATE TYPE`, or `ALTER TABLE … ALTER COLUMN … TYPE` casts on `pg-drizzle_order.status` — that is a lock and a data risk on a live table, not a routine migration.

- [ ] **Step 6: Type-check**

Run: `yarn check`
Expected: PASS. Nothing consumes `CANCEL` yet, so the only possible failure is the schema edit itself.

- [ ] **Step 7: Hand the migration to the human partner**

Say, in so many words: `drizzle/0009_*.sql` is generated and needs `yarn db:migrate` (or their own apply path) run by them — this plan never runs it. Add the warning that `ALTER TYPE … ADD VALUE` cannot run inside a transaction block on older Postgres; if their apply fails with that message, the single `ALTER TYPE` line has to be run manually first, then the rest.

- [ ] **Step 8: Commit**

```bash
git add src/server/db/schema.ts drizzle/0009_*.sql drizzle/meta/0009_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(db): add CANCEL order status and order_status_history table"
```

---

### Task 3: Status vocabulary, one source of truth

Widens every status-keyed surface and kills the two silent-degradation gaps (`OrderStatus` hand-written in `status-badge.tsx:8`, `STATUS_LABEL` typed `Record<string, string>`).

**Files:**
- Create: `src/server/order-status.ts`
- Create: `tests/order-status.test.ts`
- Modify: `src/app/_components/status-badge.tsx:8,17-22`, `src/app/_components/admin-order-tabs.ts:19-25`, `src/app/_components/order-filters.ts:13,19-24,40-49`, `src/app/_components/orders-list.tsx:49-54`, `src/app/(storefront)/orders/page.tsx:32-37,109`
- Modify: `tests/status-badge.test.ts`, `tests/order-filters.test.ts`

**Interfaces:**
- Consumes: `orderStatus` (Task 2), `StatusHistorySource` (Task 2).
- Produces:
```ts
// src/server/order-status.ts — pure; type-only import, so client islands may import the type
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export const END_STATUSES: readonly OrderStatus[];            // ["COMPLETED","CANCEL"]
export function isEndState(status: string): boolean;
export const CANCELLABLE_STATUSES: readonly OrderStatus[];    // ["UNPAID","CONFIRMED"]
export function isCancellable(status: string): boolean;
export const CUSTOMER_STATUS_LABEL: Record<OrderStatus, string>;
export function stepLabel(from: OrderStatus | null, to: OrderStatus): string;
export type { StatusHistorySource } from "./db/schema";
```

- [ ] **Step 1: Write the failing test**

`tests/order-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CANCELLABLE_STATUSES, CUSTOMER_STATUS_LABEL, END_STATUSES,
  isCancellable, isEndState, stepLabel,
} from "@/server/order-status";
import { orderStatus } from "@/server/db/schema";

describe("order-status vocabulary", () => {
  it("derives OrderStatus from the pgEnum, so the two cannot drift", () => {
    // Every enum member has a customer label; a missing key is a compile error,
    // and this pins the runtime map to the DB list too.
    expect(Object.keys(CUSTOMER_STATUS_LABEL).sort()).toEqual([...orderStatus.enumValues].sort());
    expect(CUSTOMER_STATUS_LABEL.CANCEL).toBe("Dibatalkan");
  });
  it("treats COMPLETED and CANCEL as end states, and nothing else", () => {
    expect(END_STATUSES).toEqual(["COMPLETED", "CANCEL"]);
    expect(isEndState("COMPLETED")).toBe(true);
    expect(isEndState("CANCEL")).toBe(true);
    expect(isEndState("SHIPPED")).toBe(false);   // legacy, can still advance
    expect(isEndState("UNPAID")).toBe(false);
    expect(isEndState("nonsense")).toBe(false);
  });
  it("allows cancel from UNPAID and CONFIRMED only", () => {
    expect(CANCELLABLE_STATUSES).toEqual(["UNPAID", "CONFIRMED"]);
    expect(isCancellable("SHIPPED")).toBe(false);
    expect(isCancellable("CANCEL")).toBe(false);
    expect(isCancellable("COMPLETED")).toBe(false);
  });
  it("labels a transition by what happened, not by the raw enum", () => {
    expect(stepLabel(null, "UNPAID")).toBe("Pesanan dibuat");
    expect(stepLabel("UNPAID", "CONFIRMED")).toBe("Dibayar — sales order dibuat");
    expect(stepLabel("CONFIRMED", "CANCEL")).toBe("Dibatalkan");
    expect(stepLabel("UNPAID", "CANCEL")).toBe("Dibatalkan");
    expect(stepLabel("CONFIRMED", "COMPLETED")).toBe("Selesai");
    expect(stepLabel("CONFIRMED", "SHIPPED")).toBe("Dikirim");
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `yarn vitest run tests/order-status.test.ts`
Expected: FAIL — cannot resolve `@/server/order-status`.

- [ ] **Step 3: Implement `src/server/order-status.ts`**

Header comment must say why the type is derived (one source of truth; the hand-written union in `status-badge.tsx` is what let `SHIPPED` and the label map drift) and why the module has **no runtime imports** (client islands import its types; a runtime import of `schema.ts` would pull drizzle into the browser bundle — `import type` is erased).

`stepLabel` is a small switch: `to === "CANCEL"` → `"Dibatalkan"`; `from === null` → `"Pesanan dibuat"`; `UNPAID → CONFIRMED` → `"Dibayar — sales order dibuat"`; `to === "SHIPPED"` → `"Dikirim"`; `to === "COMPLETED"` → `"Selesai"`; default → `CUSTOMER_STATUS_LABEL[to]`. `CUSTOMER_STATUS_LABEL` copies the four existing values verbatim from `src/app/(storefront)/orders/page.tsx:32-37` (including its comment about why `COMPLETED` reads "Diproses") and adds `CANCEL: "Dibatalkan"`.

- [ ] **Step 4: Run it, expect pass**

Run: `yarn vitest run tests/order-status.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewire `status-badge.tsx`**

Replace the hand-written union at `:8` with `import type { OrderStatus } from "@/server/order-status";` and keep re-exporting the name (`export type { OrderStatus, … }` at `:68-74`) so its ~8 importers do not move. Add `CANCEL: "red"` to `ORDER_STATUS_TONES` (`:17-22`) — `red` already maps to the `destructive` badge variant at `:37-43`, so no new variant. `isPulseStatus` (`:33`) stays as-is: `CANCEL` must not pulse.

- [ ] **Step 6: Update its test**

`tests/status-badge.test.ts` — in the `orderStatusTone` block (`:18-24`) add `expect(orderStatusTone("CANCEL")).toBe("red");`; in the `isPulseStatus` block (`:26-37`) add `expect(isPulseStatus("CANCEL")).toBe(false);`.

- [ ] **Step 7: Widen the admin tab set**

`src/app/_components/admin-order-tabs.ts:19-25` — `TABS` gains `"CANCEL"` after `"COMPLETED"`. `AdminTab` and `resolveInitialTab` follow automatically (`(typeof TABS)[number]`, runtime `includes` guard).

- [ ] **Step 8: Widen the customer filter contract**

`src/app/_components/order-filters.ts`: `OrderFilterTab` (`:13`) gains `"CANCEL"` — keep the pinned comment at `:7-12` and extend it with the reason (a cancelled order must be reachable on the customer side, not only under SEMUA); `OrderStatusCounts` (`:19-24`) gains `CANCEL: number`; `statusCounts` (`:40-49`) gains `CANCEL: orders.filter((o) => o.status === "CANCEL").length`.

- [ ] **Step 9: Update the pinned filter tests**

`tests/order-filters.test.ts` — the fixture at `:12-18` gains `{ id: "6", status: "CANCEL" }`, then:

```ts
const tabs: OrderFilterTab[] = ["all", "UNPAID", "CONFIRMED", "COMPLETED", "CANCEL"];   // :44
expect(Object.keys(counts).sort()).toEqual(["CANCEL","COMPLETED","CONFIRMED","UNPAID","all"]);   // :54-59
expect(counts).toEqual({ all: 6, UNPAID: 2, CONFIRMED: 1, COMPLETED: 1, CANCEL: 1 });   // :62-67
expect(statusCounts([])).toEqual({ all: 0, UNPAID: 0, CONFIRMED: 0, COMPLETED: 0, CANCEL: 0 });   // :71-76
expect(resolveInitialTab("CANCEL")).toBe("CANCEL");   // deep-link block :89-99
```

The existing `SHIPPED` row (`id: "4"`) stays: it is the deliberate legacy case, still counted only in `all`.

- [ ] **Step 10: Add the customer pill and switch the page to the typed label map**

`src/app/_components/orders-list.tsx:49-54` — `TABS` gains `{ id: "CANCEL", label: "DIBATALKAN" }`.
`src/app/(storefront)/orders/page.tsx` — delete the local `STATUS_LABEL` (`:32-37`), import `CUSTOMER_STATUS_LABEL` from `@/server/order-status`, and change `:109` to `statusLabel: CUSTOMER_STATUS_LABEL[order.status]`. Drop the `?? order.status` fallback: with the map typed `Record<OrderStatus, string>` the fallback is dead code, and keeping it would hide the next missing key.

- [ ] **Step 11: Sweep the hand-written status conditionals**

`yarn check` cannot see these — a `===` chain or an array literal with no type behind it gains nothing and loses nothing when a member appears. Spec §6 names the suspects; read each and record the verdict in the commit body:

```bash
grep -rn "COMPLETED\|SHIPPED" src/app src/server
```

- `src/server/console-kpi.ts:67` `GMV_STATUSES = ["CONFIRMED","SHIPPED","COMPLETED"] as const` — `CANCEL` stays **out**, deliberately: a cancelled order is not revenue we kept. Add a one-line comment saying so, since the omission is the whole decision and reads like an oversight. `tests/console-kpi.test.ts` already pins the GMV set; run it and expect no change.
- `src/app/_components/orders-list.tsx:245` `row.status === "COMPLETED"` note — untouched: a cancelled card must not show it.
- `src/app/_components/admin-nav.tsx` — confirm by grep that it keys nothing on order status.
- anything else the grep turns up that compares order statuses by hand: read it and decide whether a `CANCEL` row reaching it is correct. If it needs a branch, that is a finding, not a silent default — say so before committing.

- [ ] **Step 12: Full gate**

Run: `yarn vitest run tests/order-status.test.ts tests/status-badge.test.ts tests/order-filters.test.ts tests/console-kpi.test.ts && yarn check`
Expected: PASS. `yarn check` is what proves no other status-keyed map was missed — `orders-list.tsx:327` (`counts[id]`) and `ORDER_STATUS_TONES`'s `satisfies` both fail compilation on a gap.

- [ ] **Step 13: Commit**

```bash
git add src/server/order-status.ts tests/order-status.test.ts src/app/_components/status-badge.tsx tests/status-badge.test.ts src/app/_components/admin-order-tabs.ts src/app/_components/order-filters.ts tests/order-filters.test.ts src/app/_components/orders-list.tsx "src/app/(storefront)/orders/page.tsx"
git commit -m "feat(orders): add CANCEL to the status vocabulary, derived from the enum"
```

---

### Task 4: Status history — write and read seams

**Files:**
- Create: `src/server/status-history.ts`, `tests/status-history.test.ts`

**Interfaces:**
- Consumes: `orderStatusHistory`, `user`, `orders` (Task 2); `OrderStatus`, `StatusHistorySource` (Task 3).
- Produces:
```ts
export type StatusWriter = Pick<PostgresJsDatabase<typeof schema>, "insert">;
export type StatusReader = Pick<PostgresJsDatabase<typeof schema>, "select">;
export type StatusChangeEntry = {
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  source: StatusHistorySource;
  actorUserId?: string | null;
  note?: string | null;
};
export async function recordStatusChange(db: StatusWriter, entry: StatusChangeEntry): Promise<void>;

export type StatusHistoryEntry = {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  source: StatusHistorySource;
  actorName: string | null;      // user.full_name via left join; null when the actor is gone
  note: string | null;
  createdAt: Date;
};
export async function listStatusHistory(
  db: StatusReader, orderIds: readonly string[],
): Promise<Map<string, StatusHistoryEntry[]>>;   // ascending by created_at, grouped per order
```

- [ ] **Step 1: Write the failing test**

`tests/status-history.test.ts`. Injection, not module mocking — the repo's only transaction/db fake precedent is `tests/booking-id.test.ts:10-21`. Capture what the writer receives:

```ts
function makeWriter() {
  const inserted: unknown[] = [];
  const db = { insert: (_table: unknown) => ({ values: async (row: unknown) => { inserted.push(row); return [row]; } }) } as never;
  return { db, inserted };
}

it("writes exactly the entry it is given, and nothing else", async () => {
  const { db, inserted } = makeWriter();
  await recordStatusChange(db, {
    orderId: "o1", fromStatus: "UNPAID", toStatus: "CONFIRMED",
    source: "admin", actorUserId: "u1", note: "SO #192626 dibuat",
  });
  expect(inserted).toEqual([{
    orderId: "o1", fromStatus: "UNPAID", toStatus: "CONFIRMED",
    source: "admin", actorUserId: "u1", note: "SO #192626 dibuat",
  }]);
});

it("defaults the actor and note to null, so a checkout row claims no person", async () => {
  const { db, inserted } = makeWriter();
  await recordStatusChange(db, { orderId: "o1", fromStatus: null, toStatus: "UNPAID", source: "checkout" });
  expect(inserted[0]).toMatchObject({ actorUserId: null, note: null, fromStatus: null });
});
```

Plus: `listStatusHistory(db, [])` resolves an empty `Map` **without issuing a query** (spy on `select`), and a two-order fake proves the grouping and the ascending order are preserved as returned.

- [ ] **Step 2: Run it, expect failure**

Run: `yarn vitest run tests/status-history.test.ts`
Expected: FAIL — cannot resolve `@/server/status-history`.

- [ ] **Step 3: Implement `src/server/status-history.ts`**

`recordStatusChange` is one `db.insert(orderStatusHistory).values({ …entry, actorUserId: entry.actorUserId ?? null, note: entry.note ?? null })`. It deliberately has no status logic and no guard: the caller decided the transition happened.

`listStatusHistory`: early-return `new Map()` for an empty id list; then one select of `{ id, orderId, fromStatus, toStatus, source, note, createdAt, actorName: user.fullName }` from `orderStatusHistory`, `.leftJoin(user, eq(orderStatusHistory.actorUserId, user.id))`, `.where(inArray(orderStatusHistory.orderId, [...orderIds]))`, `.orderBy(asc(orderStatusHistory.createdAt))`; group into a `Map` preserving that order. Comment why the join is a *left* join: `actor_user_id` goes null when an admin is deleted (`onDelete: "set null"`), and the row must survive that — spec §4.5.

If drizzle's transaction type is not assignable to `Pick<PostgresJsDatabase<…>, "insert">` at a call site inside a `db.transaction` callback, widen `StatusWriter` to the structural shape `{ insert(table: typeof orderStatusHistory): { values(row: typeof orderStatusHistory.$inferInsert): PromiseLike<unknown> } }` rather than casting at every call site.

- [ ] **Step 4: Run it, expect pass**

Run: `yarn vitest run tests/status-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/status-history.ts tests/status-history.test.ts
git commit -m "feat(orders): status history write/read seams"
```

---

### Task 5: Record the transitions that already happen

The stepper is useless if only cancels are recorded (Goals: *every* status transition). Two existing writers, both already inside I/O.

**Files:**
- Modify: `src/app/api/orders/route.ts` (inside the transaction opened at `:161`), `src/app/api/orders/[id]/confirm/route.ts` (the final update, `:154-161`), `tests/confirm-route.test.ts`

**Interfaces:**
- Consumes: `recordStatusChange`, `StatusWriter` (Task 4).
- Produces: history rows for `null → UNPAID` (`source: "checkout"`) and `UNPAID → CONFIRMED` (`source: "admin"`, `actorUserId`, note `SO #<id> dibuat`).

- [ ] **Step 1: Extend the confirm route test first**

`tests/confirm-route.test.ts:33-98` mocks `@/server/db` with `select`/`update` only. Add a `transaction` key that hands the callback the same thenable builders, and capture history inserts:

```ts
const state = vi.hoisted(() => ({ /* existing keys */ history: [] as Record<string, unknown>[] }));
// inside the vi.mock factory:
transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),   // tx exposes select/update/insert
insert: (table: unknown) => ({ values: async (row: Record<string, unknown>) => { state.history.push(row); return [row]; } }),
```

New assertions on the existing happy-path test: `state.history` has one row, `{ fromStatus: "UNPAID", toStatus: "CONFIRMED", source: "admin", actorUserId: <the OWNER's id> }`, and `note` contains the SO id. On the 409 and 404 paths: `expect(state.history).toEqual([])` — a refused transition writes no audit row.

- [ ] **Step 2: Run it, expect failure**

Run: `yarn vitest run tests/confirm-route.test.ts`
Expected: FAIL — `state.history` empty (nothing records yet), or `db.transaction is not a function`.

- [ ] **Step 3: Make the confirm route's final write transactional**

Replace the bare `db.update(orders).set(markConfirmed(order, salesorderId)).where(...).returning()` with:

```ts
const [updated] = await db.transaction(async (tx) => {
  const rows = await tx.update(orders).set(markConfirmed(order, salesorderId))
    .where(eq(orders.id, order.id)).returning();
  if (rows[0]) {
    await recordStatusChange(tx, {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: "CONFIRMED",
      source: "admin",
      actorUserId: auth.user.id,
      note: `SO #${salesorderId} dibuat`,
    });
  }
  return rows;
});
```

Everything above it — the Jubelio create, the id read, the 401/409/502 paths — is unchanged. The response stays `Response.json({ ok: true, order: updated })`.

- [ ] **Step 4: Add the checkout creation row**

`src/app/api/orders/route.ts`, inside the existing `db.transaction`, immediately after `orderId = order.id;` (the `order` row returned by the `orders` insert):

```ts
await recordStatusChange(tx, {
  orderId: order.id, fromStatus: null, toStatus: "UNPAID", source: "checkout",
});
```

No test exists for that transaction today (verified 2026-11-01) and this plan does not add one — the insert is unconditional and carries no decision. `yarn check` plus the confirm-route test are the gate; the manual pass in Task 12 sees the row.

- [ ] **Step 5: Gate**

Run: `yarn vitest run tests/confirm-route.test.ts && yarn check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/orders/[id]/confirm/route.ts" src/app/api/orders/route.ts tests/confirm-route.test.ts
git commit -m "feat(orders): record checkout and confirm transitions in status history"
```

---

### Task 6: Stepper steps, pure

**Files:**
- Create: `src/server/status-steps.ts`, `tests/status-steps.test.ts`
- Modify: `src/lib/format.ts`, create `tests/format-step-timestamp.test.ts`

**Interfaces:**
- Consumes: `StatusHistoryEntry` (Task 4); `stepLabel`, `isEndState`, `CUSTOMER_STATUS_LABEL` (Task 3); `formatStepTimestamp` (this task).
- Produces:
```ts
// src/lib/format.ts
export function formatStepTimestamp(date: Date): string;   // "28 Okt 2026, 19.04"

// src/server/status-steps.ts — pure
export type StatusStep = {
  id: string;                              // history id, or "created" / "current" / "pending"
  label: string;
  timestampLabel: string | null;           // null = we do not know when; never guess
  actorLabel: string | null;               // "oleh Rina" | "oleh admin yang sudah dihapus" | "sinkronisasi Jubelio" | null
  note: string | null;
  tone: "done" | "cancel" | "pending" | "unknown";
};
export function buildStatusSteps(input: {
  status: OrderStatus;
  createdAt: Date;
  history: readonly StatusHistoryEntry[];   // ascending
}): StatusStep[];
```

- [ ] **Step 1: Write the failing timestamp test**

`tests/format-step-timestamp.test.ts`:

```ts
it("formats a step timestamp as dd MMM yyyy, HH.mm in id-ID", () => {
  // Fixed offset, not the runner's local zone.
  const d = new Date("2026-10-28T19:04:00+07:00");
  expect(formatStepTimestamp(d)).toBe("28 Okt 2026, 19.04");
});
it("zero-pads single-digit day, hour and minute", () => {
  expect(formatStepTimestamp(new Date("2026-01-05T09:07:00+07:00"))).toBe("05 Jan 2026, 09.07");
});
```

If the runner's TZ makes a fixed-offset assertion ambiguous, construct the dates with explicit local components (`new Date(2026, 9, 28, 19, 4)`) and assert against those — the point is the *shape*, not the zone.

- [ ] **Step 2: Run it, expect failure**

Run: `yarn vitest run tests/format-step-timestamp.test.ts`
Expected: FAIL — `formatStepTimestamp` is not exported.

- [ ] **Step 3: Implement `formatStepTimestamp` in `src/lib/format.ts`**

Assemble from `formatToParts`, do not `format()` a whole string — the same CLDR reason `formatRupiah` is hand-built (`src/lib/format.ts` header comment): some runtimes render `id-ID` time as `19.04`, others `19:04`, and a server render must match its client hydration.

```ts
const STEP_TIME = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function formatStepTimestamp(date: Date): string {
  const p = Object.fromEntries(STEP_TIME.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year}, ${p.hour}.${p.minute}`;
}
```

Keep the module dependency-free (the `tests/format-boundary.test.ts` contract).

- [ ] **Step 4: Write the failing stepper test**

`tests/status-steps.test.ts`. Fixture helper:

```ts
const entry = (o: Partial<StatusHistoryEntry> = {}): StatusHistoryEntry => ({
  id: "h1", fromStatus: "UNPAID", toStatus: "CONFIRMED", source: "admin",
  actorName: "Rina", note: "SO #192626 dibuat",
  createdAt: new Date(2026, 9, 28, 20, 11), ...o,
});
```

Cases, each its own `it`:

```ts
it("always opens with the creation step, from orders.created_at", () => {
  const steps = buildStatusSteps({ status: "CONFIRMED", createdAt: new Date(2026, 9, 28, 19, 4), history: [entry()] });
  expect(steps[0]).toEqual({ id: "created", label: "Pesanan dibuat",
    timestampLabel: "28 Okt 2026, 19.04", actorLabel: null, note: null, tone: "done" });
});

it("renders a history row with its actor, note and timestamp", () => {
  const steps = buildStatusSteps({ status: "CONFIRMED", createdAt: new Date(2026, 9, 28), history: [entry()] });
  expect(steps[1]).toMatchObject({ label: "Dibayar — sales order dibuat",
    actorLabel: "oleh Rina", note: "SO #192626 dibuat", tone: "done" });
});

it("attributes a sync cancel to the sync, never to a person", () => {
  const steps = buildStatusSteps({ status: "CANCEL", createdAt: new Date(2026, 9, 28),
    history: [entry({ id: "h2", fromStatus: "CONFIRMED", toStatus: "CANCEL", source: "sync",
      actorName: null, note: "SO #192626 dihapus di Jubelio — 2 unit kembali ke kuota sesi" })] });
  expect(steps[1]).toMatchObject({ label: "Dibatalkan", actorLabel: "sinkronisasi Jubelio", tone: "cancel" });
});

it("names a deleted admin instead of dropping the step", () => {
  const steps = buildStatusSteps({ status: "CANCEL", createdAt: new Date(2026, 9, 28),
    history: [entry({ toStatus: "CANCEL", source: "admin", actorName: null })] });
  expect(steps[1].actorLabel).toBe("oleh admin yang sudah dihapus");
});

it("adds a muted, timestamp-free step when the order predates history", () => {
  const steps = buildStatusSteps({ status: "CONFIRMED", createdAt: new Date(2026, 9, 28), history: [] });
  expect(steps).toHaveLength(2);
  expect(steps[1]).toEqual({ id: "current", label: "Dikonfirmasi", timestampLabel: null,
    actorLabel: null, note: "Tercatat sebelum riwayat status aktif", tone: "unknown" });
});

it("says a pre-history order is cancelled without claiming who did it", () => {
  const steps = buildStatusSteps({ status: "CANCEL", createdAt: new Date(2026, 9, 28), history: [] });
  expect(steps[1]).toMatchObject({ label: "Dibatalkan", actorLabel: null, timestampLabel: null, tone: "cancel" });
});

it("adds one pending step for a live order and none after an end state", () => {
  const unpaid = buildStatusSteps({ status: "UNPAID", createdAt: new Date(2026, 9, 28), history: [] });
  expect(unpaid.at(-1)).toMatchObject({ id: "pending", label: "Menunggu pembayaran", tone: "pending", timestampLabel: null });
  expect(buildStatusSteps({ status: "CANCEL", createdAt: new Date(2026, 9, 28), history: [] }).at(-1)?.tone).not.toBe("pending");
  expect(buildStatusSteps({ status: "COMPLETED", createdAt: new Date(2026, 9, 28),
    history: [entry({ toStatus: "COMPLETED", fromStatus: "CONFIRMED" })] }).at(-1)?.tone).toBe("done");
});
```

- [ ] **Step 5: Run it, expect failure**

Run: `yarn vitest run tests/status-steps.test.ts`
Expected: FAIL — cannot resolve `@/server/status-steps`.

- [ ] **Step 6: Implement `buildStatusSteps`**

Rules, in order — spec §4.5/§4.6, and Review Focus 5:

1. Step `created`: `{ id: "created", label: "Pesanan dibuat", timestampLabel: formatStepTimestamp(createdAt), actorLabel: null, note: null, tone: "done" }`. Always first, always from `orders.created_at`.
2. One step per history row, ascending as given: `label: stepLabel(fromStatus, toStatus)`, `timestampLabel: formatStepTimestamp(createdAt)`, `note`, and `actorLabel` = `source === "sync"` → `"sinkronisasi Jubelio"`; `source === "admin"` → `actorName?.trim() ? \`oleh ${actorName.trim()}\` : "oleh admin yang sudah dihapus"`; `source === "checkout"` → `null`. `tone` = `toStatus === "CANCEL" ? "cancel" : "done"`.
3. When `history.length === 0`: one step `{ id: "current", label: CUSTOMER_STATUS_LABEL[status], timestampLabel: null, actorLabel: null, note: "Tercatat sebelum riwayat status aktif", tone: status === "CANCEL" ? "cancel" : "unknown" }`. **Never** fall back to `orders.updated_at` — `$onUpdate` rewrites it on a resi backfill that changed no status (spec §4.5).
4. When `!isEndState(status)`: append `{ id: "pending", label: status === "UNPAID" ? "Menunggu pembayaran" : "Selesai", timestampLabel: null, actorLabel: null, note: null, tone: "pending" }`. (`SHIPPED` takes the same "Selesai" branch — legacy rows can still advance.)

- [ ] **Step 7: Run both, expect pass**

Run: `yarn vitest run tests/status-steps.test.ts tests/format-step-timestamp.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/status-steps.ts tests/status-steps.test.ts src/lib/format.ts tests/format-step-timestamp.test.ts
git commit -m "feat(orders): pure status stepper + step timestamp formatter"
```

---

### Task 7: The cancel transition — quota release, once

The heart of the feature. One function, one transaction, both doors.

**Files:**
- Create: `src/server/cancel-order.ts`, `tests/cancel-order.test.ts`

**Interfaces:**
- Consumes: `orders`, `orderItems`, `sessionProducts` (schema); `isEndState`, `END_STATUSES`, `OrderStatus` (Task 3); `recordStatusChange` (Task 4).
- Produces:
```ts
export type CancelSource = "admin" | "sync";
export type QuotaReleaseLine = { sessionProductId: string; qty: number };   // uuid, not int
export function planQuotaRelease(
  items: readonly { sessionProductId: string; qty: number }[],
): QuotaReleaseLine[];                       // summed per product, zero/negative lines dropped
export function composeCancelNote(cause: string | null, releasedUnits: number): string | null;

export type CancelOrderInput = {
  orderId: string;
  source: CancelSource;
  actorUserId?: string | null;
  note?: string | null;                      // human-readable cause, e.g. "SO #192626 dihapus di Jubelio"
};
export type CancelOrderResult =
  | { cancelled: true; fromStatus: OrderStatus; releasedUnits: number }
  | { cancelled: false; reason: "not-found" | "already-ended" };
export type CancelDb = Pick<PostgresJsDatabase<typeof schema>, "transaction">;
export async function cancelOrder(db: CancelDb, input: CancelOrderInput): Promise<CancelOrderResult>;
```

- [ ] **Step 1: Write the failing pure tests**

`tests/cancel-order.test.ts`:

```ts
it("sums two lines for the same session product", () => {
  expect(planQuotaRelease([
    { sessionProductId: "sp1", qty: 2 }, { sessionProductId: "sp2", qty: 1 }, { sessionProductId: "sp1", qty: 3 },
  ])).toEqual([{ sessionProductId: "sp1", qty: 5 }, { sessionProductId: "sp2", qty: 1 }]);
});
it("drops lines that would release nothing", () => {
  expect(planQuotaRelease([{ sessionProductId: "sp1", qty: 0 }])).toEqual([]);
});
it("keeps both facts in the note, and the quota line alone when there is no cause", () => {
  expect(composeCancelNote("SO #192626 dihapus di Jubelio", 2)).toBe("SO #192626 dihapus di Jubelio — 2 unit kembali ke kuota sesi");
  expect(composeCancelNote(null, 1)).toBe("1 unit kembali ke kuota sesi");
  expect(composeCancelNote(null, 0)).toBeNull();
});
```

- [ ] **Step 2: Write the failing transaction tests**

Same file. Fake `tx` capturing every statement (the `booking-id.test.ts:10-21` seam, extended):

The two selects are distinguished by the table handed to `from`, and every write captures both its `value` and its `cond` so the SQL can be inspected afterwards:

```ts
type Kind = "select-order" | "select-items" | "update-order" | "update-product" | "insert-history";
type Captured = { kind: Kind; arg?: unknown };

function makeDb(opts: {
  order?: { id: string; status: string } | undefined;
  items?: { sessionProductId: string; qty: number }[];
  flipped?: number;                        // rows the guarded status UPDATE returns
}) {
  const calls: Captured[] = [];
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          const items = table === orderItems;
          calls.push({ kind: items ? "select-items" : "select-order" });
          return items ? (opts.items ?? []) : opts.order ? [opts.order] : [];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => ({
        // Recorded at `where`, not at `returning`: the quota UPDATE is awaited
        // with no `.returning()`, the status UPDATE reads its flipped rows back,
        // and both must be captured. Hence an awaitable that also chains.
        where: (cond: unknown) => {
          calls.push({
            kind: table === orders ? "update-order" : "update-product",
            arg: { value, cond },
          });
          const rows = Array.from({ length: table === orders ? (opts.flipped ?? 1) : 1 }, () => ({ id: "o1" }));
          return Object.assign(Promise.resolve(rows), { returning: async () => rows });
        },
      }),
    }),
    insert: () => ({
      values: async (row: unknown) => { calls.push({ kind: "insert-history", arg: row }); return [row]; },
    }),
  };
  const writes = () => calls.filter((c) => c.kind !== "select-order" && c.kind !== "select-items");
  return { db: { transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as never, calls, writes };
}
```

Cases:

```ts
it("flips the status, releases quota per line and writes one history row, in one transaction", async () => {
  const { db, calls } = makeDb({ order: { id: "o1", status: "UNPAID" },
    items: [{ sessionProductId: "sp1", qty: 2 }, { sessionProductId: "sp1", qty: 1 }] });
  const res = await cancelOrder(db, { orderId: "o1", source: "admin", actorUserId: "u1" });
  expect(res).toEqual({ cancelled: true, fromStatus: "UNPAID", releasedUnits: 3 });
  expect(calls.filter((c) => c.kind === "update-product")).toHaveLength(1);   // summed, one UPDATE
  expect(calls.filter((c) => c.kind === "insert-history")).toHaveLength(1);
});

it("clamps the release at zero with GREATEST, never a negative claimed", async () => {
  const { db, calls } = makeDb({ order: { id: "o1", status: "CONFIRMED" }, items: [{ sessionProductId: "sp1", qty: 9 }] });
  await cancelOrder(db, { orderId: "o1", source: "sync", note: "SO #86 dihapus di Jubelio" });
  const captured = calls.find((c) => c.kind === "update-product")!.arg as { value: { claimed: SQL } };
  const q = new PgDialect().sqlToQuery(captured.value.claimed as never);
  expect(q.sql).toContain("GREATEST(");
  expect(q.sql).toContain("- ");
  expect(q.params).toEqual([9]);            // the 0 floor is literal SQL, not a parameter
});

it("guards the flip against the end states, so a second cancel releases nothing", async () => {
  const { db, calls, writes } = makeDb({ order: { id: "o1", status: "UNPAID" },
    items: [{ sessionProductId: "sp1", qty: 2 }], flipped: 0 });
  expect(await cancelOrder(db, { orderId: "o1", source: "sync" })).toEqual({ cancelled: false, reason: "already-ended" });
  expect(calls.filter((c) => c.kind === "update-product")).toHaveLength(0);
  expect(calls.filter((c) => c.kind === "insert-history")).toHaveLength(0);
  const captured = calls.find((c) => c.kind === "update-order")!.arg as { cond: SQL };
  const q = new PgDialect().sqlToQuery(captured.cond as never);
  expect(q.sql).toMatch(/not in/i);
  expect(q.params).toEqual(["o1", "COMPLETED", "CANCEL"]);
});

it("reports an unknown order without writing anything", async () => {
  const { db, writes } = makeDb({ order: undefined });
  expect(await cancelOrder(db, { orderId: "nope", source: "admin" })).toEqual({ cancelled: false, reason: "not-found" });
  expect(writes()).toEqual([]);              // the selects ran, no UPDATE, no INSERT
});

it("refuses to cancel an order that is already in an end state", async () => {
  const { db } = makeDb({ order: { id: "o1", status: "COMPLETED" }, items: [] });
  expect(await cancelOrder(db, { orderId: "o1", source: "admin" })).toEqual({ cancelled: false, reason: "already-ended" });
});
```

`PgDialect` import: `import { PgDialect } from "drizzle-orm/pg-core"` — the idiom `tests/confirm-route.test.ts:110-119` already uses to read captured SQL.

- [ ] **Step 3: Run them, expect failure**

Run: `yarn vitest run tests/cancel-order.test.ts`
Expected: FAIL — cannot resolve `@/server/cancel-order`.

- [ ] **Step 4: Implement `src/server/cancel-order.ts`**

`planQuotaRelease` and `composeCancelNote` are plain folds. `cancelOrder` is the transaction below; the comments are the point of the file, keep them:

```ts
export async function cancelOrder(db: CancelDb, input: CancelOrderInput): Promise<CancelOrderResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select({ id: orders.id, status: orders.status })
      .from(orders).where(eq(orders.id, input.orderId));
    if (!order) return { cancelled: false, reason: "not-found" } as const;
    // Cheap early-out; the guarded UPDATE below is the real race guard.
    if (isEndState(order.status)) return { cancelled: false, reason: "already-ended" } as const;

    const items = await tx.select({ sessionProductId: orderItems.sessionProductId, qty: orderItems.qty })
      .from(orderItems).where(eq(orderItems.orderId, input.orderId));
    const lines = planQuotaRelease(items);
    const releasedUnits = lines.reduce((sum, l) => sum + l.qty, 0);

    // Exactly one caller can flip this row: two overlapping cancels both read
    // UNPAID above, only one finds a row that is still not in an end state.
    // Do not rely on the button's isLoading for this (spec §4.3).
    const flipped = await tx.update(orders).set({ status: "CANCEL" })
      .where(and(eq(orders.id, input.orderId), notInArray(orders.status, [...END_STATUSES])))
      .returning({ id: orders.id });
    if (flipped.length !== 1) return { cancelled: false, reason: "already-ended" } as const;

    // GREATEST clamps at 0: a legacy line can exceed the quota an admin has
    // since truncated, and a negative `claimed` silently breaks the storefront
    // cap (src/server/checkout.ts:121). Deliberately unconditional on session
    // status — checkout's first gate is `sessionStatus !== "ACTIVE"`, so a
    // release into an ENDED session is inert, not a reopening (spec §4.3).
    for (const line of lines) {
      await tx.update(sessionProducts)
        .set({ claimed: sql`GREATEST(${sessionProducts.claimed} - ${line.qty}, 0)` })
        .where(eq(sessionProducts.id, line.sessionProductId));
    }

    // jubelio_so_id, tracking_number and shipper are untouched on purpose:
    // "SO #192626, deleted upstream" is the evidence the dialog shows.
    await recordStatusChange(tx, {
      orderId: input.orderId,
      fromStatus: order.status,
      toStatus: "CANCEL",
      source: input.source,
      actorUserId: input.actorUserId ?? null,
      note: composeCancelNote(input.note ?? null, releasedUnits),
    });

    return { cancelled: true, fromStatus: order.status, releasedUnits } as const;
  });
}
```

`order.status` comes back typed as the enum, so it is already an `OrderStatus` — no cast needed if the select is written as above.

- [ ] **Step 5: Run them, expect pass**

Run: `yarn vitest run tests/cancel-order.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/cancel-order.ts tests/cancel-order.test.ts
git commit -m "feat(orders): cancelOrder — status, clamped quota release and history in one transaction"
```

---

### Task 8: Customer WhatsApp resolution

**Files:**
- Create: `src/server/order-contact.ts`, `tests/order-contact.test.ts`

**Interfaces:**
- Consumes: `StatusReader` (Task 4); `orders`, `contacts`, `user` (schema).
- Produces:
```ts
export type CustomerContact = { phone: string; name: string | null };   // phone = normalised wa.me digits
export function toWhatsAppNumber(raw: string | null | undefined): string | null;
export function buildCustomerWaLink(phone: string, text: string): string;
export function cancelMessageText(input: { bookingId: string; customerName: string | null; wasPaid: boolean }): string;
export async function resolveCustomerContacts(
  db: StatusReader, orderIds: readonly string[],
): Promise<Map<string, CustomerContact | null>>;      // batched: one pass for a whole list page
```

Batched only. A single-order variant would have no caller — both surfaces that need a number are list pages (`/admin/orders`), and the cancel *route* never resolves a phone: the link is already in the row the admin clicked.

- [ ] **Step 1: Write the failing pure tests**

`tests/order-contact.test.ts`:

```ts
it("normalises every local spelling of an Indonesian number to 62…", () => {
  for (const [raw, want] of [["0812-8877-1042","628128877 1042".replace(/\s/g,"")], ["0081288771042","6281288771042"],
    ["+62 812 8877 1042","6281288771042"], ["6281288771042","6281288771042"]] as const) {
    expect(toWhatsAppNumber(raw)).toBe(want);
  }
});
it("returns null rather than a dead link for anything unusable", () => {
  for (const raw of [null, undefined, "", "   ", "-", "12345", "bukan nomor", "+1 555 0100"]) {
    expect(toWhatsAppNumber(raw)).toBeNull();
  }
});
it("builds an encoded wa.me link", () => {
  expect(buildCustomerWaLink("6281288771042", "Halo Rina\nPesanan FS-1 dibatalkan."))
    .toBe("https://wa.me/6281288771042?text=Halo%20Rina%0APesanan%20FS-1%20dibatalkan.");
});
it("states the refund when the customer already paid, and does not when they did not", () => {
  expect(cancelMessageText({ bookingId: "FS-1", customerName: "Rina", wasPaid: true })).toMatch(/FS-1/);
  expect(cancelMessageText({ bookingId: "FS-1", customerName: "Rina", wasPaid: true })).toMatch(/refund|kembali/i);
  expect(cancelMessageText({ bookingId: "FS-1", customerName: null, wasPaid: false })).not.toMatch(/refund/i);
  expect(cancelMessageText({ bookingId: "FS-1", customerName: null, wasPaid: false })).toMatch(/FS-1/);
});
```

Fix the first case's expected value by hand rather than the `replace` trick — write the literal digits.

- [ ] **Step 2: Write the failing resolution tests**

Same file. A fake `select`-only db keyed by the tables it is asked for (the `tests/confirm-route.test.ts:33-98` builder idiom), proving the chain order and the batch behaviour:

```ts
it("prefers the linked contact's phone", …);            // contactId set → that phone wins
it("falls back to the order customer's contact by email", …);  // contactId null → orders.customerId → user.email → contacts.email
it("falls back to the order's recipient snapshot", …);   // no contact row → orders.recipientPhone
it("yields null when there is no number anywhere", …);   // Review Focus 5: no button, never a dead link
it("resolves a whole list in one pass and keeps the order ids straight", …);  // two ids → Map with both keys
it("returns an empty Map for an empty id list without issuing a query", …);   // an empty tab must not hit the DB
```

- [ ] **Step 3: Run them, expect failure**

Run: `yarn vitest run tests/order-contact.test.ts`
Expected: FAIL — cannot resolve `@/server/order-contact`.

- [ ] **Step 4: Implement `src/server/order-contact.ts`**

`toWhatsAppNumber`: strip everything but digits and a leading `+`; drop the `+`; then `008…` → `62…`, `0…` → `62…`, `62…` unchanged; anything else → `null`; also `null` when the result is shorter than 9 or longer than 15 digits. Comment why `+1…` is rejected: `wa.me` wants an Indonesian mobile and a wrong-country link silently opens a stranger's chat.

`resolveCustomerContacts(db, orderIds)`: empty list → empty `Map`. Otherwise three queries, each `inArray`-batched, and only for the ids still unresolved: (1) `orders` ⋈ `contacts` on `orders.contactId`; (2) `orders` ⋈ `user` on `orders.customerId` ⋈ `contacts` on `contacts.email = user.email`; (3) `orders.recipientPhone`. Name for the message: `contacts.contactName` when a contact row was used, else `orders.recipientName`, else `null`. Normalise every candidate through `toWhatsAppNumber`; the first non-null wins, and an order with none maps to `null`. This is the same chain the confirm route walks (`src/app/api/orders/[id]/confirm/route.ts:47-75`), batched — comment that, and comment that `Hubungi CS` on the customer surface does **not** use it (spec §8.17).

Return an empty `Map` immediately when `orderIds` is empty — an empty tab reaches this line on every visit, and an `inArray` with no values is a query worth not sending.

`cancelMessageText`: three lines joined by `\n`, Indonesian, no placeholder text — the customer's name when we have it (otherwise no greeting name), the booking id, and what happened. For `wasPaid` it must say the refund is arranged manually outside the system and ask for the account details; for `!wasPaid` it must say the order was cancelled because no confirmed payment arrived and that the quota is released, without inventing any other reason. Copy is yours (spec §4.6), the three facts are not.

- [ ] **Step 5: Run them, expect pass**

Run: `yarn vitest run tests/order-contact.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/order-contact.ts tests/order-contact.test.ts
git commit -m "feat(orders): batched customer WhatsApp resolution for the cancel surfaces"
```

---

### Task 9: `POST /api/orders/[id]/cancel`

**Files:**
- Create: `src/app/api/orders/[id]/cancel/route.ts`, `tests/cancel-route.test.ts`

**Interfaces:**
- Consumes: `cancelOrder`, `CancelOrderResult` (Task 7); `isCancellable` (Task 3); `getSession` (`@/server/better-auth/server`); `db`.
- Produces: `POST` returning `{ ok: true, order: { id, bookingId, status: "CANCEL", releasedUnits } }`, or `{ ok: false, error }` with 401 / 403 / 404 / 409. `CancelOrderTarget` (Task 11) is built by pages, not here.

- [ ] **Step 1: Write the failing test**

`tests/cancel-route.test.ts` — mock the auth seam and the service, not the DB, so this file pins the route's own decisions (guards + status mapping). The service's transaction semantics are Task 7's file.

```ts
vi.mock("@/server/better-auth/server", () => ({ getSession: vi.fn() }));
vi.mock("@/server/cancel-order", () => ({ cancelOrder: vi.fn() }));
vi.mock("@/server/db", async () => {
  const { orders } = await import("@/server/db/schema");
  // A queue, not a single row: the route reads once for its guards and — only on
  // the raced `already-ended` verdict — once more to name the current status.
  return { db: { select: () => ({ from: () => ({ where: async () => state.orderRows.splice(0, 1) }) }) } };
});
```

Cases (`POST` with `{ params: Promise.resolve({ id: "o1" }) }`, mirroring `tests/confirm-route.test.ts`):

```ts
it("401s with no session and never touches the order", …);
it("403s a signed-in CUSTOMER", …);                       // role !== "OWNER"
it("404s an unknown order id", …);                         // "Pesanan tidak ditemukan"
it("409s a COMPLETED order and names the current status", …);
   // expect(body.error).toBe("Pesanan sudah berstatus COMPLETED") — same shape as confirm/route.ts:38-40
it("409s a legacy SHIPPED order", …);                      // cancellable = UNPAID | CONFIRMED only
it("cancels an UNPAID order as the acting admin", …);
   // Assert the input object only: `expect(vi.mocked(cancelOrder).mock.calls[0][1]).toEqual({ orderId: "o1", source: "admin", actorUserId: "owner-1" })`.
   // The first argument is the mocked module's `db` export and pins nothing here.
   // expect(await res.json()).toEqual({ ok: true, order: { id: "o1", bookingId: "FS-2026-0148", status: "CANCEL", releasedUnits: 2 } })
it("cancels a CONFIRMED order too — the paid case is deliberate", …);
it("maps the service's already-ended verdict to 409, naming the status it re-read", …);
   // state.orderRows = [unpaidRow, completedRow] — the pre-check passes on the first read,
   // cancelOrder resolves { cancelled: false, reason: "already-ended" }, the route re-reads
   // for the message: expect(body.error).toBe("Pesanan sudah berstatus COMPLETED")
it("maps the service's not-found verdict to 404", …);
```

- [ ] **Step 2: Run it, expect failure**

Run: `yarn vitest run tests/cancel-route.test.ts`
Expected: FAIL — the route module does not exist.

- [ ] **Step 3: Implement the route**

Copy `src/app/api/orders/[id]/confirm/route.ts` structurally: `export const runtime = "nodejs"`, the same local `jsonError(status, error)` helper, the same `POST(request, { params }: { params: Promise<{ id: string }> })` signature, the same 401/403 order. Then:

```ts
const { id } = await params;
const [order] = await db.select().from(orders).where(eq(orders.id, id));
if (!order) return jsonError(404, "Pesanan tidak ditemukan");
if (!isCancellable(order.status)) return jsonError(409, `Pesanan sudah berstatus ${order.status}`);

const result = await cancelOrder(db, { orderId: order.id, source: "admin", actorUserId: auth.user.id });
if (!result.cancelled) {
  if (result.reason === "not-found") return jsonError(404, "Pesanan tidak ditemukan");
  // The row moved between our read and the guarded UPDATE — name what it says
  // now, because the pre-check above cannot tell a cancel from a completion.
  const [now] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id));
  return jsonError(409, `Pesanan sudah berstatus ${now?.status ?? "CANCEL"}`);
}
return Response.json({ ok: true, order: {
  id: order.id, bookingId: order.bookingId, status: "CANCEL" as const, releasedUnits: result.releasedUnits,
} });
```

Wrap the `cancelOrder` call in `try/catch` → `console.error("cancel: …", e)` + `jsonError(500, "Gagal membatalkan pesanan, coba lagi")`, matching the confirm route's habit of never leaking a stack to the client. Doc comment above `POST`: owner-only, no upstream call (spec §2 — we never cancel in Jubelio, the SO id stays for the record), refunds are offline.

Note the double gate is intentional and worth a comment: `isCancellable` here gives the admin a precise 409, the `notInArray` guard inside `cancelOrder` is what makes the write race-safe.

- [ ] **Step 4: Run it, expect pass**

Run: `yarn vitest run tests/cancel-route.test.ts && yarn check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/orders/[id]/cancel/route.ts" tests/cancel-route.test.ts
git commit -m "feat(api): POST /api/orders/[id]/cancel, owner-only"
```

---

### Task 10: Sync — three-way verdict, end states, and the cancel patch

**Files:**
- Modify: `src/server/daily-sync.ts`, `src/server/order-sync.ts`, `tests/daily-sync.test.ts`, `tests/order-sync.test.ts`

**Interfaces:**
- Consumes: `isEndState`, `END_STATUSES` (Task 3); `cancelOrder` (Task 7); `recordStatusChange` (Task 4); `JubelioError` (`@/lib/jubelio`, `class JubelioError extends Error { constructor(public status: number, public code: string | undefined, message: string) }`).
- Produces:
```ts
// daily-sync.ts
export type SyncStatus = "CONFIRMED" | "COMPLETED" | "CANCEL";
export type SoVerdict =
  | { kind: "state"; state: SalesOrderState }
  | { kind: "missing" }                       // definitive 404 — the only thing that cancels
  | { kind: "unknown"; detail: string };      // timeout, 401, 403, 5xx, unparseable 2xx
export type SyncPatch = { orderId: string; status?: SyncStatus; trackingNumber?: string; shipper?: string; cause?: string };
export function planSync(localOrders: LocalOrderSnapshot[], verdictsBySoId: ReadonlyMap<number, SoVerdict>): SyncPatch[];

// order-sync.ts
export type SyncRunResult = { checked: number; synced: number; cancelled: number; failed: number };
```

- [ ] **Step 1: Update the pure sync tests**

`tests/daily-sync.test.ts` — the `states` map at `:137` and the `local()` helper at `:144` are the fixture surface for the whole `planSync` describe. Retype the map as `new Map<number, SoVerdict>([…])` and wrap each of its four existing entries (`209`, `85`, `192297`, `86`) in `{ kind: "state", state: <the existing literal> }`; `local()` keeps its shape and simply passes the verdict map through. New inline maps take the same `Map<number, SoVerdict>` annotation. Then:

```ts
const verdicts = (entries: [number, SoVerdict][]) => new Map<number, SoVerdict>(entries);

it("maps upstream CANCELED onto the local CANCEL member", () => {
  expect(mapInternalStatus("CANCELED")).toBe("CANCEL");
  expect(mapInternalStatus("canceled")).toBe("CANCEL");
});                                            // replaces the `→ null` case at :86-93

it("cancels on a definitive 404 and nothing else", () => {
  const row = { id: "a", jubelioSoId: 86, status: "CONFIRMED" };
  expect(planSync([row], verdicts([[86, { kind: "missing" }]])))
    .toEqual([{ orderId: "a", status: "CANCEL", cause: "SO #86 dihapus di Jubelio" }]);
  expect(planSync([row], verdicts([[86, { kind: "unknown", detail: "403 Forbidden" }]])))
    .toEqual([]);                              // Review Focus 1
});

it("emits a cancel patch for an upstream CANCELED SO, with a cause and no resi", () => {
  // soId 86's existing map entry carries `shipper: "Grab Same Day"` — a cancel
  // must not deliver it (spec §4.3), so the patch has exactly three keys.
  expect(local({ id: "a", jubelioSoId: 86, status: "CONFIRMED" })).toEqual([
    { orderId: "a", status: "CANCEL", cause: "Jubelio menandai SO #86 dibatalkan" },
  ]);
});

it("never pulls an end-state row forward, whatever the SO says", () => {
  // soId 192297's existing entry is `internalStatus: "PAID"` → CONFIRMED locally,
  // i.e. forward from CANCEL on the ladder. rank("CANCEL") is -1.
  expect(local({ id: "a", jubelioSoId: 192297, status: "CANCEL" })).toEqual([]);
  expect(local({ id: "a", jubelioSoId: 192297, status: "COMPLETED" })).toEqual([]);
});                                             // Review Focus 2

it("never cancels a COMPLETED row on a 404", () => {
  expect(planSync([{ id: "a", jubelioSoId: 86, status: "COMPLETED" }], verdicts([[86, { kind: "missing" }]]))).toEqual([]);
});
```

**Existing assertions that must change**, both pinned today and both now wrong by design:
- the second expectation of `it("never regresses: a PAID or CANCELED SO cannot pull SHIPPED back")` (`:178-182`) — `local({ id: "a", jubelioSoId: 86, status: "CONFIRMED" })` returned `[]` because `CANCELED` had no local member; it now returns the cancel patch asserted above. Rewrite that test's name and intent: the first expectation (soId `192297` against a `SHIPPED` row) stays and is still a regression test.
- the doc comment above `planSync` ("including `CANCELED`, so shipping detail is never backfilled onto it") — still true about the resi, no longer true about the status.

Everything else in the file (`SHIPPED` never written, forward-only jumps, resi-alone backfill, the four `readSalesOrderState` null cases) stays and must still pass.

- [ ] **Step 2: Implement the pure changes in `daily-sync.ts`**

`SyncStatus` gains `"CANCEL"` (update its doc comment at `:17-22`: `SHIPPED` is still never written; `CANCEL` is written only by a cancel patch). `STATUS_RANK` (`:54-61`) gains **no** `CANCEL` entry: `rank()` returning `-1` for it is harmless once `isEndState` short-circuits first, and putting it on the ladder would make a side exit look like a rung. `SoVerdict` as above. `mapInternalStatus` gains `case "CANCELED": return "CANCEL";` and its comment loses "notably `CANCELED`, which has no local member" (`:74-76`). `SyncPatch` gains `cause?: string` — the human-readable reason a cancel patch carries into the history note, composed here because only the pure core knows both the SO id and which verdict fired.

`planSync(localOrders, verdictsBySoId)` body:

```ts
for (const order of localOrders) {
  if (order.jubelioSoId == null) continue;
  // End states are already filtered out of the query; this is the second half of
  // Review Focus 2 — `rank()` returns -1 for CANCEL, so without this guard a
  // stale PAID read would rewrite a cancelled order to CONFIRMED.
  if (isEndState(order.status)) continue;
  const verdict = verdictsBySoId.get(order.jubelioSoId);
  if (!verdict || verdict.kind === "unknown") continue;
  if (verdict.kind === "missing") {
    patches.push({ orderId: order.id, status: "CANCEL", cause: `SO #${order.jubelioSoId} dihapus di Jubelio` });
    continue;
  }
  const next = mapInternalStatus(verdict.state.internalStatus);
  if (!next) continue;
  if (next === "CANCEL") {
    patches.push({ orderId: order.id, status: "CANCEL", cause: `Jubelio menandai SO #${order.jubelioSoId} dibatalkan` });
    continue;
  }
  const patch: SyncPatch = { orderId: order.id };
  if (rank(next) > rank(order.status)) patch.status = next;
  /* resi + shipper backfill unchanged (:156-164) */
  if (Object.keys(patch).length > 1) patches.push(patch);
}
```

A cancel patch is exempt from the ladder (spec §4.4 — the ladder exists to stop regressions *along* it, and a cancel is not a rung) and carries no resi, so it returns before the backfill block.

- [ ] **Step 3: Update the orchestration tests**

`tests/order-sync.test.ts` — the `deps()` factory at `:24-49` keeps its `applied` / `fetched` capture arrays; failure simulation stays "throw inside a fake", never `vi.fn`. Its two body fixtures are named `SHIPPED` and `PAID` (`:14-21`), and it returns two linked orders (`a` → SO 209, `b` → SO 192297) unless a test overrides `listLinkedOrders`. Import `JubelioError` from the real `@/lib/jubelio` — no partial mock needed, `order-sync.ts` uses the class only for `instanceof`, and this file imports nothing from `@/server/db`.

```ts
it("classifies a 404 as missing and cancels exactly that order", async () => {
  const d = deps({ fetchState: async (soId) => {
    if (soId === 209) throw new JubelioError(404, "Not Found", "SalesOrder not found");
    return SHIPPED;                       // order b: a resi-only patch, so synced stays 1
  } });
  expect(await runOrderSync(d)).toEqual({ checked: 2, synced: 1, cancelled: 1, failed: 0 });
  expect(d.applied).toContainEqual({ orderId: "a", status: "CANCEL", cause: "SO #209 dihapus di Jubelio" });
});

it("never cancels on a 403 — the sync reads with the system token, the SO was made with an admin's", async () => {
  const d = deps({ fetchState: async () => { throw new JubelioError(403, "Forbidden", "Forbidden"); } });
  expect(await runOrderSync(d)).toEqual({ checked: 2, synced: 0, cancelled: 0, failed: 2 });
  expect(d.applied).toEqual([]);                                        // Review Focus 1
});

it("never cancels on a timeout or a 5xx", async () => {
  for (const e of [new Error("TimeoutError: The operation timed out"), new JubelioError(503, undefined, "unavailable")]) {
    const d = deps({ fetchState: async () => { throw e; } });
    expect((await runOrderSync(d)).cancelled).toBe(0);
    expect(d.applied).toEqual([]);
  }
});

it("counts an unparseable 2xx as failed and leaves the order alone", async () => {
  const d = deps({ fetchState: async () => ({ salesorder_id: 1 }) });    // fixture at :107
  expect(await runOrderSync(d)).toEqual({ checked: 2, synced: 0, cancelled: 0, failed: 2 });
});   // CHANGED: today this asserts `failed: 0` — spec §4.4 counts every `unknown`. Update the
      // comment at order-sync.ts:107-109 with it ("not a failure" is no longer true).

it("a cancel patch that the service refuses is not counted as cancelled", async () => {
  const d = deps({ fetchState: async () => { throw new JubelioError(404, undefined, "gone"); },
                   apply: async () => { throw new Error("db down"); } });
  expect(await runOrderSync(d)).toEqual({ checked: 2, synced: 0, cancelled: 0, failed: 2 });
});
```

The existing `toEqual({ checked: 2, synced: 1, failed: 0 })` assertions (`:82-89` and neighbours) all need `cancelled: 0` added.

- [ ] **Step 4: Implement the orchestration changes in `order-sync.ts`**

1. `SyncRunResult` gains `cancelled: number` with a doc line: *orders moved to `CANCEL` by this pass*. Not rendered anywhere — the admin page discards the result (spec §4.4); it is returned and `console.log`ged with the others.
2. Replace the `states` map with `const verdicts = new Map<number, SoVerdict>()`. In the fetch loop: `try { const state = readSalesOrderState(await deps.fetchState(soId)); verdicts.set(soId, state ? { kind: "state", state } : { kind: "unknown", detail: "unparseable body" }); } catch (e) { verdicts.set(soId, e instanceof JubelioError && e.status === 404 ? { kind: "missing" } : { kind: "unknown", detail: describeError(e) }); }` — keep the existing `console.error` per failure, and add a `console.warn` naming the SO on `missing` (this is the line an admin will read when an order silently cancels). `describeError` is a two-line local helper: `JubelioError` → `` `${e.status} ${e.message}` ``, anything else → `e instanceof Error ? e.name : "error"`.
3. `planSync(localOrders, verdicts)`; count `patch.status === "CANCEL"` into `cancelled`, everything else into `synced`; an `apply` that throws counts as `failed` (unchanged).
4. `listLinkedOrders` where-clause becomes `and(isNotNull(orders.jubelioSoId), notInArray(orders.status, [...END_STATUSES]))` — spec §4.4: end-state rows stop costing an upstream call forever.
5. `apply(patch)` becomes transactional:

```ts
async apply(patch) {
  if (patch.status === "CANCEL") {
    // One service function owns the transition (spec §4.2): quota release and
    // the history row live there, not here.
    const result = await cancelOrder(db, { orderId: patch.orderId, source: "sync", note: patch.cause ?? null });
    if (!result.cancelled) {
      console.warn(`order-sync: cancel for ${patch.orderId} skipped (${result.reason})`);
    }
    return;
  }
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, patch.orderId));
    const flipped = await tx.update(orders).set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.trackingNumber ? { trackingNumber: patch.trackingNumber } : {}),
      ...(patch.shipper ? { shipper: patch.shipper } : {}),
    // Guarded: today this is a bare update, so a sync racing an admin cancel
    // can overwrite CANCEL. End states are untouchable (Review Focus 2).
    }).where(and(eq(orders.id, patch.orderId), notInArray(orders.status, [...END_STATUSES]))).returning({ id: orders.id });
    // A resi-only pass changed no status and stays silent (spec §4.5).
    if (patch.status && before && flipped.length === 1) {
      await recordStatusChange(tx, { orderId: patch.orderId, fromStatus: before.status, toStatus: patch.status, source: "sync" });
    }
  });
},
```

6. Rewrite the header comment at `:15-27`. It currently claims three triggers (Vercel cron, an external hourly pinger, the admin page). After Task 14 there is exactly one, and the pinger never existed (spec §4.7). New text: the sync runs throttled when an admin opens `/admin/orders`, kept alive past the response by `after()`; there is no cron and no external pinger, so an admin opening that page is the only thing that moves a status. Keep the paragraph explaining why `SyncDeps` is injected.
7. Fix `daily-sync.ts:1-15`'s header the same way — keep the 2026-10-30 post-mortem as history, drop the present-tense cron. Same for the block comment above the fixtures in `tests/order-sync.test.ts:11-13`, which says the sync is "shared by the cron route and the throttled hook".

- [ ] **Step 5: Gate**

Run: `yarn vitest run tests/daily-sync.test.ts tests/order-sync.test.ts && yarn check`
Expected: PASS. Then the whole suite, because `SyncPatch` and `SyncRunResult` are widely imported: `yarn vitest run`.

- [ ] **Step 6: Commit**

```bash
git add src/server/daily-sync.ts src/server/order-sync.ts tests/daily-sync.test.ts tests/order-sync.test.ts
git commit -m "feat(sync): three-way SO verdict, end-state filter, cancel on definitive 404 only"
```

---

### Task 11: `CancelOrderButton` and its warning dialog

Spec §4.2, mockup `.superpowers/brainstorm/15145-1793510721/content/cancel-flow.html` option A. No DOM test harness exists (`vitest.config.ts` sets `environment: "node"`, no `@testing-library/*`), so this task's gates are `yarn check` and the manual pass in Step 5.

**Files:**
- Create: `src/app/_components/cancel-order-button.tsx`

**Interfaces:**
- Consumes: `OrderStatus` (Task 3); `Button`, `Dialog*` (`@/components/ui/*`); `toast` (sonner); `useRouter`; `useSessionExpiry` (`@/app/_components/use-session-expiry`).
- Produces — pages build this object, so its name and fields are a contract for Tasks 12 and 13:
```ts
export type CancelOrderTarget = {
  orderId: string;
  bookingId: string;
  status: OrderStatus;          // UNPAID | CONFIRMED in practice
  unitCount: number;            // summed order_item.qty — "N unit kembali ke kuota sesi"
  jubelioSoId: number | null;   // named in the CONFIRMED warning so it cannot be read as an unpaid booking
  customerWaLink: string;       // "" when no phone resolved → the contact button is not rendered
};
export function CancelOrderButton({ target, size = "sm" }: { target: CancelOrderTarget; size?: "xs" | "sm" }): JSX.Element;
```

- [ ] **Step 1: Build the trigger + dialog**

`"use client"`. Trigger:

```tsx
<Button variant="outline" size={size} onClick={() => setOpen(true)} aria-haspopup="dialog"
  className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30">
  Batalkan
</Button>
```

Destructive-**outline**, not solid `destructive`: spec §3.3 wants it visible and one click, but quieter than the primary action next to it.

Dialog: `Dialog` + `DialogContent className="sm:max-w-md"` + `DialogHeader` / `DialogTitle` / `DialogDescription` / `DialogFooter` from `@/components/ui/dialog` (these exist and are unused so far — a small confirm dialog is exactly what they are for; the receipt's hand-rolled bands are for the tall scrollable dialog in Task 12). Verbatim copy:

- `DialogTitle`: `Batalkan {bookingId}?`
- `DialogDescription`: `Status jadi CANCEL. {unitCount} unit kembali ke kuota sesi.` — `unitCount === 1` reads `1 unit`; do not pluralise.
- `UNPAID` warning, amber box `rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200`: `Pelanggan belum membayar. Sebaiknya hubungi dulu lewat WhatsApp sebelum membatalkan.`
- `CONFIRMED` warning, same box in red (`border-red-200 bg-red-50 text-red-900` + dark equivalents): `Pelanggan sudah membayar{jubelioSoId ? ` (SO #${jubelioSoId})` : ""}. Membatalkan berarti kamu menghubungi pelanggan dan mengatur refund di luar sistem.`
- `DialogFooter className="items-center justify-between gap-2 sm:justify-between"`: left, when `customerWaLink.length > 0`, `Hubungi pelanggan` as `<Button variant="outline" size="xs" render={<a href={customerWaLink} target="_blank" rel="noreferrer" />}>` (the `render` prop is the repo's link-button idiom, `orders-list.tsx:81-82`); right, `Kembali` (`variant="ghost" size="xs"`, closes) and `Ya, batalkan` (`variant="destructive" size="xs"`, `isLoading={loading}`).

**The warning never blocks** (spec §4.2, §8.3): `Ya, batalkan` is pressable without opening WhatsApp, with no timer and no extra click.

- [ ] **Step 2: Wire the request**

`POST /api/orders/${orderId}/cancel`, no body. Then, in the `confirm-order-button.tsx` order: `res.status === 401` → `await signOutOnExpiry()` and return; `!res.ok || !data?.ok` → `toast.error(data?.error ?? "Gagal membatalkan pesanan. Coba lagi.")`; success → `toast.success(\`Pesanan ${bookingId} dibatalkan — ${releasedUnits} unit kembali ke kuota sesi.\`)`, `setOpen(false)`, `router.refresh()`. `catch` → `toast.error("Terjadi kesalahan, coba lagi.")`. `finally` → `setLoading(false)`. `isLoading` on the confirm button is what prevents the double submit (and Task 7's guard is what makes a double submit harmless).

Read `releasedUnits` off the response's `order` object (Task 9's shape); fall back to `target.unitCount` when it is absent.

- [ ] **Step 3: Type gate**

Run: `yarn check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/_components/cancel-order-button.tsx
git commit -m "feat(admin): Batalkan button with a contact-first warning dialog"
```

- [ ] **Step 5: Manual pass (do this after Task 12 wires it into a row)**

`yarn dev`, sign in as the OWNER, open `/admin/orders`. Check, in order: `Batalkan` sits beside `Konfirmasi Bayar` on an `UNPAID` row; the dialog names the booking id and the unit count; the amber warning shows for `UNPAID` and the red one with `SO #…` for `CONFIRMED`; `Hubungi pelanggan` is absent when the customer has no phone; `Ya, batalkan` spins and disables while in flight; a success toast names the released units; the row moves to the `CANCEL` tab with a red badge; the session's `claimed` went down (storefront stock for that product rose); pressing `Batalkan` twice quickly does not release twice.

---

### Task 12: Detail dialog, stepper, admin wiring

**Files:**
- Create: `src/app/_components/status-stepper.tsx`, `src/app/_components/order-detail-dialog.tsx`
- Modify: `src/app/_components/admin-orders-filter.tsx`, `src/app/admin/orders/page.tsx`

**Interfaces:**
- Consumes: `StatusStep` + `buildStatusSteps` (Task 6); `OrderStatus`, `CUSTOMER_STATUS_LABEL`, `isCancellable` (Task 3); `CancelOrderTarget` + `CancelOrderButton` (Task 11); `resolveCustomerContacts`, `buildCustomerWaLink`, `cancelMessageText` (Task 8); `listStatusHistory` (Task 4); `formatRupiah` (`@/lib/format`); `flashSessions` (schema).
- Produces:
```ts
// src/app/_components/status-stepper.tsx  ("use client")
export function StatusStepper({ steps }: { steps: readonly StatusStep[] }): JSX.Element;

// src/app/_components/order-detail-dialog.tsx  ("use client")
export type OrderDetailData = {
  orderId: string;
  bookingId: string;
  status: OrderStatus;
  statusLabel: string;              // raw enum on admin, CUSTOMER_STATUS_LABEL on the storefront
  dateLabel: string;                // created, existing toLocaleString("id-ID", …) shape
  grandTotalLabel: string;
  sessionName: string | null;
  jubelioSoId: number | null;
  steps: StatusStep[];
  items: { id: string; name: string; qtyPriceLabel: string; subtotalLabel: string }[];
  transferProofUrl: string | null;
  trackingNumber: string | null;
  shipper: string | null;
  contact: { label: string; href: string } | null;   // null → no button, plus the "no phone" line
  contactHint: string | null;                        // shown only when contact is null
};
export function OrderDetailDialog({ order, cancel, open, onOpenChange }: {
  order: OrderDetailData; cancel?: CancelOrderTarget | null;
  open: boolean; onOpenChange: (next: boolean) => void;
}): JSX.Element;
export function OrderDetailTrigger({ order, cancel, label = "Lihat detail" }: {
  order: OrderDetailData; cancel?: CancelOrderTarget | null; label?: string;
}): JSX.Element;                     // per-row open state, the ReceiptTrigger pattern
```

- [ ] **Step 1: Build `StatusStepper`**

`<ol>` from `steps`, translating the chosen mockup (`stepper-home.html` option A, `.steps` block) into Tailwind: each `<li>` `relative pl-6 pb-4`, a dot via a span (`absolute left-1 top-1 h-2.5 w-2.5 rounded-full`) coloured by tone — `done` `bg-neutral-900 dark:bg-neutral-100`, `cancel` `bg-red-600`, `pending` and `unknown` `bg-neutral-300 dark:bg-neutral-700` — and a connector `absolute left-[8px] top-4 bottom-0 w-px bg-neutral-200 dark:bg-border` hidden on the last item. Label `text-[13px] font-semibold` (`cancel` → `text-red-700 dark:text-red-400`; `pending`/`unknown` → `text-neutral-400`). Second line, when present, `font-mono text-[11px] text-neutral-500`: `{timestampLabel}` · `{actorLabel}`. Note, when present, its own line at `text-[11px] text-neutral-500`. A step with `timestampLabel: null` renders no time and **no placeholder dash** — silence is honest, `—` implies we looked (Review Focus 5).

- [ ] **Step 2: Build the dialog**

Follow `receipt-dialog.tsx`'s anatomy exactly (spec §4.6): `DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"`, the `h-1.5` gradient bar first, the header band with `pr-14` to clear the default close button, the scrollable body `min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5`, the footer band. Body order, per spec §4.6:

1. Header band: `bookingId` (mono) + `StatusBadge tone={orderStatusTone(order.status)}` with `statusLabel` as children, `grandTotalLabel`, `sessionName`, and `SO #{jubelioSoId}` when linked.
2. `<StatusStepper steps={order.steps} />` under a `text-[10px] font-bold uppercase text-neutral-400` label `Riwayat status`.
3. Items — reuse the receipt's table frame classes (`overflow-hidden rounded-xl border`, mono uppercase header, `divide-y` rows).
4. Transfer proof link when `transferProofUrl`, `<ShipmentBand trackingNumber shipper />` when `trackingNumber`.
5. Footer: `contact` → `<Button variant="outline" size="sm" render={<a href={contact.href} target="_blank" rel="noreferrer" />}>{contact.label}</Button>`; when `contact` is `null` render `contactHint` as muted text instead (never a dead link); then `cancel` → `<CancelOrderButton target={cancel} size="sm" />`; then `Tutup` (`variant="ink" size="lg" className="w-full"`, closes) as the last element.

`OrderDetailTrigger` copies `ReceiptTrigger` (`receipt-dialog.tsx:266-282`): local `useState(false)`, a `Button variant="ink" size="xs"` labelled `label`, `aria-haspopup="dialog"`, and the controlled dialog beside it — per-row state so one open dialog never re-renders the list. `OrderDetailTrigger` is what both pages import; `OrderDetailDialog` is exported beside it because the trigger renders it in the same module, and no page needs the controlled form today.

- [ ] **Step 3: Extend `AdminOrderRow` and the row footer**

`admin-orders-filter.tsx:21-38` gains `detail: OrderDetailData;` and `cancel: CancelOrderTarget | null;`. In the footer (`:160-175`), keep the proof link on the left and make the right side a `flex items-center gap-2`:

- every row: `<OrderDetailTrigger order={order.detail} cancel={order.cancel} />`
- `order.cancel` non-null (i.e. `UNPAID`/`CONFIRMED`): `<CancelOrderButton target={order.cancel} size="sm" />` **before** the existing `ConfirmOrderButton`, which stays gated on `status === "UNPAID"`.
- `order.status === "CANCEL"` and `order.detail.contact`: an in-row `Hubungi pelanggan` link button, so the cancelled tab answers the original ask ("on section cancel for each order there is a button to contact the customer") without opening the dialog.

Row order left→right: `Lihat detail`, `Batalkan`, `Konfirmasi Bayar` — quiet to loud.

- [ ] **Step 4: Build the data in the admin page**

`src/app/admin/orders/page.tsx`, after the existing `itemsByOrder` grouping:

```ts
const ids = rows.map((r) => r.id);
const [historyByOrder, contactsByOrder, sessionRows] = await Promise.all([
  listStatusHistory(db, ids),
  resolveCustomerContacts(db, ids),
  db.select({ id: flashSessions.id, name: flashSessions.name })
    .from(flashSessions).where(inArray(flashSessions.id, rows.map((r) => r.sessionId))),
]);
const sessionNames = new Map(sessionRows.map((s) => [s.id, s.name]));
```

A second query for session names, not a join on the orders select: `db.select().from(orders)` returns whole rows, and adding `.leftJoin` would change every `order.x` access below it. Same shape as `itemsByOrder`.

Then per row, inside the existing `rows.map`:

```ts
const contact = contactsByOrder.get(order.id) ?? null;
const waLink = contact ? buildCustomerWaLink(contact.phone, cancelMessageText({
  bookingId: order.bookingId, customerName: contact.name, wasPaid: order.status === "CONFIRMED",
})) : "";
const cancel: CancelOrderTarget | null = isCancellable(order.status) ? {
  orderId: order.id, bookingId: order.bookingId, status: order.status,
  unitCount: (itemsByOrder.get(order.id) ?? []).reduce((n, i) => n + i.qty, 0),
  jubelioSoId: order.jubelioSoId, customerWaLink: waLink,
} : null;
const detail: OrderDetailData = {
  /* …labels formatted here, never a Date… */
  statusLabel: order.status,                                  // admin prints the raw enum (spec §3.1)
  sessionName: sessionNames.get(order.sessionId) ?? null,
  steps: buildStatusSteps({ status: order.status, createdAt: order.createdAt, history: historyByOrder.get(order.id) ?? [] }),
  contact: waLink ? { label: "Hubungi pelanggan", href: waLink } : null,
  contactHint: "Tidak ada nomor WhatsApp untuk pesanan ini — hubungi pelanggan lewat profilnya.",
};
```

- [ ] **Step 5: Gate**

Run: `yarn check && yarn vitest run`
Expected: PASS (no new tests; every decision this task renders was pinned in Tasks 3, 6, 7 and 8).

- [ ] **Step 6: Manual pass, then commit**

**Apply `drizzle/0009_past_tana_nile.sql` before running anything against a database.** From Task
5 onward the checkout INSERT and the confirm UPDATE share a transaction with the history row, so on
a schema without `order_status_history` checkout fails with 409 "Checkout gagal, silakan coba lagi"
and — the worse half — confirm creates the sales order in Jubelio and *then* 500s, leaving a paid SO
with no local link (the 2026-10-28 failure class) that a retry would double. The migration is not
optional at this point in the plan; it is a release gate. It also begins with
`ALTER TYPE "public"."order_status" ADD VALUE 'CANCEL'`, which on older PostgreSQL versions cannot
run inside a transaction block — apply it as its own step, not wrapped in `BEGIN`.

`yarn dev` → `/admin/orders`: open `Lihat detail` on an order created before this feature (stepper shows creation + the muted "Tercatat sebelum riwayat status aktif" step, no invented times); on a fresh order (creation row from checkout present); on a `CANCEL` row (red last step, the note with the released units, `Hubungi pelanggan`); `?status=CANCEL` lands on the new tab; an order with no phone shows the hint instead of a button. Then run Task 11 Step 5's list.

```bash
git add src/app/_components/status-stepper.tsx src/app/_components/order-detail-dialog.tsx src/app/_components/admin-orders-filter.tsx src/app/admin/orders/page.tsx
git commit -m "feat(admin): order detail dialog with a status stepper and cancel action"
```

---

### Task 13: Customer surface

**Files:**
- Modify: `src/app/(storefront)/orders/page.tsx`, `src/app/_components/orders-list.tsx`

**Interfaces:**
- Consumes: `OrderDetailData`, `OrderDetailTrigger` (Task 12); `listStatusHistory`, `buildStatusSteps` (Tasks 4, 6); `buildCsLink` (already in the page, `:42-45`).
- Produces: `TransactionRow` gains `detail: OrderDetailData`. No `cancel` — customers cannot cancel (spec §2, §8.12).

- [ ] **Step 1: Build `detail` in the page**

Same three-query pattern as Task 12 Step 4 (`listStatusHistory`, the session-name map; **no** `resolveCustomerContacts` — the customer surface dials CS, which needs no resolution, spec §8.17). Per row:

```ts
detail: {
  orderId: order.id, bookingId: order.bookingId, status: order.status,
  statusLabel: CUSTOMER_STATUS_LABEL[order.status],       // "Dibatalkan"
  dateLabel: /* the existing toLocaleString value */,
  grandTotalLabel: receipt.grandTotalLabel,
  sessionName: sessionNames.get(sessionId) ?? null,
  jubelioSoId: null,                                       // the storefront select does not read it; keep it out
  steps: buildStatusSteps({ status: order.status, createdAt: order.createdAt, history: historyByOrder.get(order.id) ?? [] }),
  items: receipt.items.map((i) => ({
    id: i.id, name: i.name, qtyPriceLabel: `${i.qty} × ${i.priceLabel}`, subtotalLabel: i.subtotalLabel,
  })),                                        // labels already exist on the receipt row — relabel, do not recompute
  transferProofUrl: order.transferProofUrl, trackingNumber: order.trackingNumber, shipper: order.shipper,
  contact: { label: "Hubungi CS", href: buildCsLink(order.bookingId) },
  contactHint: null,
}
```

`jubelioSoId: null` on purpose — the customer never sees our upstream ids, and the dialog already renders that line conditionally. If showing it would be useful later, that is a separate decision.

The storefront select (`:62-84`) is an explicit column list, so add `sessionId: orders.sessionId` to it for the session-name lookup.

- [ ] **Step 2: Mount the trigger**

`orders-list.tsx:277-279`, the same flex row that holds `ReceiptTrigger`:

```tsx
<div className="flex items-center gap-1.5">
  <OrderDetailTrigger order={row.detail} />
  <ReceiptTrigger order={row} />
</div>
```

`Lihat detail` first: it is the new, broader surface, and the receipt stays where a customer's muscle memory puts it. `TransactionRow` (`:31-41`) gains `detail: OrderDetailData` — imported as a type, so the client island keeps its `import type` discipline.

A `CANCEL` row needs no extra copy on the card: the badge reads `DIBATALKAN`, the pending step is absent, and the dialog carries the rest. Leave the `status === "COMPLETED"` note at `:245-257` alone.

- [ ] **Step 3: Gate**

Run: `yarn check && yarn vitest run`
Expected: PASS.

- [ ] **Step 4: Manual pass, then commit**

`yarn dev` → `/orders` as a customer: `DIBATALKAN` pill appears with a count and filters correctly; the cancelled card's badge reads `DIBATALKAN` (not `CANCEL`); `Lihat detail` opens with `Hubungi CS` in the footer and no `Batalkan`; an old order shows the muted pre-history step; the receipt still opens beside it.

```bash
git add "src/app/(storefront)/orders/page.tsx" src/app/_components/orders-list.tsx
git commit -m "feat(storefront): cancelled-order pill, detail dialog and stepper"
```

---

### Task 14: Remove the cron and the backfill route

Last, so every earlier task's `yarn vitest run` still has its fixtures. `CRON_SECRET` cannot go before this task: `src/app/api/cron/backfill-images/route.ts:28` reads it, and `src/env.js` uses `emptyStringAsUndefined`, so an empty `.env` value would make `z.string()` refuse to boot.

**Files:**
- Delete: `src/app/api/cron/daily-sync/route.ts`, `src/app/api/cron/backfill-images/route.ts`, `src/server/backfill-images.ts`, `tests/backfill-images.test.ts`, `tests/daily-sync-route.test.ts`, `vercel.json`
- Modify: `src/env.js:41,85`, `.env.example:44-48`, `vitest.config.ts:36`, `src/server/order-sync.ts` (drop `runOrderSyncNow`)

**Interfaces:**
- Consumes: Task 10's comment rewrite (already describes one trigger).
- Produces: no `CRON_SECRET` anywhere in `src`, `.env.example` or the test env; `maybeRunOrderSync` is the sync's only entry point.

- [ ] **Step 1: Delete the files**

```bash
git rm src/app/api/cron/daily-sync/route.ts src/app/api/cron/backfill-images/route.ts src/server/backfill-images.ts tests/backfill-images.test.ts tests/daily-sync-route.test.ts vercel.json
```

`vercel.json` holds nothing but the one cron entry (verified 2026-11-01, spec §4.7) — the file goes with the job. If `src/app/api/cron/` is now empty, remove the directory too.

- [ ] **Step 2: Drop `runOrderSyncNow`**

`src/server/order-sync.ts:220-223` — the deleted cron route was its only caller (`maybeRunOrderSync` keeps its single caller, `src/app/admin/orders/page.tsx:56`). Delete the function and its comment; leave `createThrottledSync` and `maybeRunOrderSync` alone.

- [ ] **Step 3: Delete `CRON_SECRET`**

- `src/env.js`: the schema line `CRON_SECRET: z.string(),` (`:41`) and the `runtimeEnv` line (`:85`).
- `.env.example`: the `CRON_SECRET` block at `:44-48`, including whatever comment introduces it.
- `vitest.config.ts`: `CRON_SECRET: "test-cron-secret"` (`:36`).

Leave the historical mentions in `docs/PRD.md`, `docs/jubelio-api-guide.md` and the older specs/plans alone — they describe what was true then. And touch nothing under `src/app/api/jubelio/webhook-sink/`: the sink keeps reading `JUBELIO_WEBHOOK_SINK_TOKEN` and keeps its 503-when-unconfigured answer (spec §5) — it never used `CRON_SECRET`.

- [ ] **Step 4: Prove nothing still reads it**

Run: `grep -rn "CRON_SECRET\|x-cron-secret\|api/cron" src tests .env.example vitest.config.ts vercel.json 2>/dev/null`
Expected: no output (`vercel.json` no longer exists).

- [ ] **Step 5: Full gate**

Run: `yarn vitest run && yarn check`
Expected: the whole suite green, no unresolved imports. `src/env.js` boots without `CRON_SECRET` in both the app and the test env — that is what this step actually proves.

- [ ] **Step 6: Commit**

```bash
git add src/env.js src/server/order-sync.ts .env.example vitest.config.ts
git commit -m "chore: drop the daily-sync cron, the backfill-images route and CRON_SECRET"
```

Step 1's `git rm` already staged the six deletions, so nothing else is needed — but run `git status` before committing and confirm the staged set is exactly those deletions plus these four modifications. Never `git add -A`, never a bare directory: the tree carries unrelated modified files that must not be swept in.

---

## After the last task

1. `yarn vitest run && yarn check` — full suite, clean type/lint.
2. Tell the human partner, in this order: the migration `drizzle/0009_*.sql` still needs **their** apply; and the first sync after deploy will cancel the two live `CONFIRMED` orders (SO 192626, SO 192297 — both already 404 upstream) and release their quota. That is the designed behaviour and they accepted it (spec §1, §3.6), but it lands the moment an admin next opens `/admin/orders`, so it should not be a surprise.
3. Then superpowers:finishing-a-development-branch — and ask before any git operation that touches `main`.
