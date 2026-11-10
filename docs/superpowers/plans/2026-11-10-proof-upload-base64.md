# Proof-of-Transfer: Base64 in DB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local-disk transfer-proof upload (broken on Vercel) with client-compressed base64 data URIs stored in the `order` table, displayed as inline images.

**Architecture:** Client compresses the picked image to ≤ 500 KB JPEG and POSTs a JSON data URI; the upload route validates and stores it in `order.transfer_proof_data`. List queries select a `hasProof` flag (never the blob); a small read endpoint serves the image on demand; a shared `ProofImage` component renders it. All `<a href>` proof links become `<img>` previews (browsers block `data:` navigation).

**Tech Stack:** Next.js App Router, Drizzle ORM (PostgreSQL), canvas client compression, vitest for pure helpers.

**Spec:** `docs/superpowers/specs/2026-11-10-proof-upload-base64-design.md`

## Global Constraints

- Yarn only (never npm/pnpm/bun). Typecheck/lint: `COREPACK_ENABLE_STRICT=0 yarn run check` (plain `yarn check` runs yarn 1's builtin, not the script).
- Migrations: only `pnpm db:generate` (run via yarn: `yarn db:generate`). NEVER `db:push`/`db:migrate` — the human applies migrations manually. Plan states when to ask.
- Commits land on `main` (pre-authorized for this plan); no push.
- Every user-facing error/success message in Indonesian, matching existing route copy.
- User actions surface sonner toasts; loading state on the upload button while in flight (existing behaviour, keep it).
- Proof display is `<img src>` only — never `<a href>` on a `data:` URI.
- List payloads never include the blob column.

## Review Focus

- A `data:` URI whose base64 payload contains line breaks or is truncated mid-string — validator must reject malformed payloads, not crash or accept (`validateImageDataUri` tests, Task 2).
- Payload exactly at the 500 KB boundary vs 1 byte over — accept vs reject pinned by test (Task 2).
- Wrong-MIME data URIs (`data:text/html`, `data:image/svg+xml`, `image/webp`) — rejected by prefix allowlist, not just size (Task 2).
- One customer requesting another customer's proof, and an anonymous request — both denied by `GET /api/orders/[id]/proof` (only the OWNER role + owner pass). No unit test (DB-bound route); manual verify in Task 9.
- A huge raw file (> 25 MB) picked on a weak phone — client rejects before canvas decode with a clear toast instead of tab-crash. No unit test (browser canvas); manual verify in Task 9.

---

### Task 1: Schema drop+add and mechanical rename

**Files:**
- Modify: `src/server/db/schema.ts:167`
- Modify (mechanical rename only, no behaviour change): `src/app/(storefront)/orders/page.tsx`, `src/app/admin/orders/page.tsx`, `src/app/_components/admin-orders-filter.tsx`, `src/app/_components/order-detail-dialog.tsx`, `src/app/_components/orders-list.tsx`, `src/app/_components/payment-panel.tsx`, `src/server/console-kpi.ts:106`

**Interfaces:**
- Produces: `orders.transferProofData` (drizzle column `transfer_proof_data`, `t.text()`, nullable). All TS references renamed `transferProofUrl` → `transferProofData`; types keep `string | null` semantics this task.

- [ ] **Step 1: Edit schema** — replace line 167 `transferProofUrl: t.text("transfer_proof_url"),` with `transferProofData: t.text("transfer_proof_data"),`. Drop+add (not rename) is deliberate: wipes dead `/uploads/...` values.

- [ ] **Step 2: Generate migration (no apply)**

Run: `yarn db:generate`
Expected: new SQL file under `drizzle/` containing `DROP COLUMN "transfer_proof_url";` and `ADD COLUMN "transfer_proof_data" text;`. Tell the human a migration is ready to apply manually — do not run `db:push`/`db:migrate`.

- [ ] **Step 3: Rename every reference** — mechanical `transferProofUrl` → `transferProofData` (and `transfer_proof_url` → `transfer_proof_data`) across the files listed above. No logic edits.

- [ ] **Step 4: Verify compile-green**

Run: `COREPACK_ENABLE_STRICT=0 yarn run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(orders): rename transfer_proof_url to transfer_proof_data (drop+add)"
```

### Task 2: Pure data-URI validator (TDD)

**Files:**
- Create: `src/lib/proof-image.ts`
- Test: `tests/proof-image.test.ts`

**Interfaces:**
- Produces:
  - `MAX_PROOF_DATA_BYTES = 500 * 1024`
  - `PROOF_MIME_PREFIXES = ["data:image/jpeg;base64,", "data:image/png;base64,"]`
  - `validateImageDataUri(dataUri: string): { ok: true; bytes: number } | { ok: false; error: "MALFORMED" | "TOO_LARGE" }` — pure, isomorphic. `bytes` = decoded payload length.

- [ ] **Step 1: Write failing tests** in `tests/proof-image.test.ts` (vitest, `environment: "node"` default from config):

```ts
import { describe, expect, it } from "vitest";
import { MAX_PROOF_DATA_BYTES, validateImageDataUri } from "@/lib/proof-image";

const jpeg = (payload: string) => `data:image/jpeg;base64,${payload}`;

describe("validateImageDataUri", () => {
  it("accepts a small jpeg data URI and reports decoded byte length", () => {
    const result = validateImageDataUri(jpeg("aGVsbG8=")); // "hello"
    expect(result).toEqual({ ok: true, bytes: 5 });
  });

  it("accepts a png data URI", () => {
    const result = validateImageDataUri("data:image/png;base64,aGVsbG8=");
    expect(result).toEqual({ ok: true, bytes: 5 });
  });

  it("rejects non-image / wrong-type prefixes", () => {
    expect(validateImageDataUri("data:text/html;base64,aGVsbG8=").ok).toBe(false);
    expect(validateImageDataUri("data:image/svg+xml;base64,aGVsbG8=").ok).toBe(false);
    expect(validateImageDataUri("data:image/webp;base64,aGVsbG8=").ok).toBe(false);
  });

  it("rejects missing or non-base64 payloads", () => {
    expect(validateImageDataUri("data:image/jpeg;base64,").ok).toBe(false);
    expect(validateImageDataUri("data:image/jpeg;base64,not@@base64!").ok).toBe(false);
    expect(validateImageDataUri("data:image/jpeg;base64,aGVsbg").ok).toBe(false); // bad padding
    expect(validateImageDataUri("")).ok === false;
  });

  it("accepts a payload exactly at the cap and rejects one byte over", () => {
    // 1 MiB of 'a' chars decodes to 768 bytes ... build exact-size payloads:
    const at = `${jpeg("A".repeat(MAX_PROOF_DATA_BYTES / 3 * 4))}`; // decoded = MAX
    // Simpler: compute payload for exactly MAX decoded bytes:
    // 3 bytes ← 4 base64 chars, so MAX bytes needs (MAX/3)*4 chars when MAX % 3 === 0.
    expect(validateImageDataUri(at)).toMatchObject({ ok: true });
    const over = `${jpeg("A".repeat(MAX_PROOF_DATA_BYTES / 3 * 4 + 4))}`;
    expect(validateImageDataUri(over)).toEqual({ ok: false, error: "TOO_LARGE" });
  });
});
```

Adjust the boundary payloads to valid base64 lengths (multiples of 4 chars, `=` padding allowed) so `decoded === MAX_PROOF_DATA_BYTES` exactly — the assertion is the cap, not the arithmetic.

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run tests/proof-image.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `validateImageDataUri`** in `src/lib/proof-image.ts`. Approach: find the first `,`; check the prefix (up to and including the comma) is in `PROOF_MIME_PREFIXES`; validate the remainder against `/^[A-Za-z0-9+/]*={0,2}$/` with length % 4 === 0 and at least 1 char; size it without full decode: `bytes = payload.length / 4 * 3 - (padding chars)`; reject `bytes > MAX_PROOF_DATA_BYTES`. Pure — no Buffer (must work in browser later if reused).

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run tests/proof-image.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/proof-image.ts tests/proof-image.test.ts
git commit -m "feat(proof): pure data-URI validator for transfer proofs"
```

### Task 3: Upload route → JSON data URI; delete disk path

**Files:**
- Modify: `src/app/api/orders/[id]/upload-proof/route.ts`
- Delete: `src/server/upload.ts`
- Modify: `src/app/_components/proof-upload-button.tsx`

**Interfaces:**
- Consumes: `validateImageDataUri` (Task 2).
- Produces: `POST /api/orders/[id]/upload-proof` accepts JSON `{ imageData: string }` (a data URI), responds `Response.json({ ok: true })`. Client sends JSON.

- [ ] **Step 1: Rewrite the route** — same session/owner guards and Indonesian messages; replace the multipart block:
  - Parse body: `const body = await request.json().catch(() => null)`; reject non-object/missing `imageData` string with `400` `"Format kiriman tidak valid. Coba unggah lagi."`.
  - `const validation = validateImageDataUri(body.imageData)`; on `MALFORMED` → `400` `"Format bukti transfer tidak dikenal. Unggah ulang foto JPG atau PNG."`; on `TOO_LARGE` → `413` `"Ukuran gambar terlalu besar (maks 500 KB setelah kompresi)."`.
  - `await db.update(orders).set({ transferProofData: body.imageData }).where(eq(orders.id, id))`; return `Response.json({ ok: true })`.
  - Update the docblock: JSON data URI, no disk.

- [ ] **Step 2: Delete `src/server/upload.ts`** — `saveProof`, `validateProof`, `MAX_PROOF_BYTES`, `ALLOWED_PROOF_TYPES` are all dead (only the route imported them).

- [ ] **Step 3: Switch the client to JSON** in `proof-upload-button.tsx`: keep the loading state/toasts/`router.refresh()`; replace the `FormData` fetch with:

```ts
const res = await fetch(`/api/orders/${orderId}/upload-proof`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ imageData: await compressToDataUri(file) }),
});
```

`compressToDataUri` is defined in Task 4 — for this task import it from `@/lib/compress-image` and keep the call site exact so Task 4 only fills the module. If the file picked is over the raw cap, `compressToDataUri` throws a `ProofTooLargeError`; wrap the call and toast `"Gambar terlalu besar (maks 25 MB)."`.

- [ ] **Step 4: Verify compile-green**

Run: `COREPACK_ENABLE_STRICT=0 yarn run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(orders): store transfer proof as base64 data URI in DB"
```

### Task 4: Client compression module

**Files:**
- Create: `src/lib/compress-image.ts` (browser-only; no unit test — canvas APIs)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `compressToDataUri(file: File): Promise<string>` — resolves to a `data:image/jpeg;base64,...` URI ≤ 500 KB.
  - `class ProofTooLargeError extends Error` — thrown when `file.size > MAX_RAW_PROOF_BYTES`.
  - `MAX_RAW_PROOF_BYTES = 25 * 1024 * 1024`.

- [ ] **Step 1: Implement** `compressToDataUri`:
  - If `file.size > MAX_RAW_PROOF_BYTES`, throw `ProofTooLargeError`.
  - Load into `createImageBitmap(file)`. Long edge ≤ 1500 px (`MAX_EDGE`).
  - Loop scales `[1, 0.75, 0.5, 0.35]` × qualities `0.82` stepping `−0.12` down to floor `0.34`: draw to offscreen canvas, `canvas.toBlob(..., "image/jpeg", q)`; first blob ≤ 500 KB wins → read as data URI (`FileReader` or `URL.createObjectURL` + XHR is overkill; use `FileReader.readAsDataURL`) and resolve. If nothing fits even at the smallest scale/floor, resolve the smallest attempt anyway (server validator is the backstop).
  - `revokeObjectURL`/GC: no object URLs retained.

- [ ] **Step 2: Verify compile-green**

Run: `COREPACK_ENABLE_STRICT=0 yarn run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/compress-image.ts
git commit -m "feat(proof): client-side canvas compression to 500KB jpeg data URI"
```

### Task 5: On-demand proof read endpoint

**Files:**
- Create: `src/app/api/orders/[id]/proof/route.ts`

**Interfaces:**
- Produces: `GET /api/orders/[id]/proof` → `Response.json({ ok: true, imageData: string })`. Guards: signed-in; owner (`order.customerId === auth.user.id`) **or** `auth.user.role === "OWNER"` (same role check as `src/app/admin/layout.tsx:32`). Else `403` `"Anda tidak bisa melihat bukti transfer untuk pesanan ini."`; missing order `404` `"Pesanan tidak ditemukan"`; anonymous `401` following `upload-proof/route.ts` wording.

- [ ] **Step 1: Implement the route** — `export const runtime = "nodejs"`; mirror the session/order lookup shape of `src/app/api/orders/[id]/upload-proof/route.ts:19-38`; select only `transferProofData`; respond `404` `"Bukti transfer belum diunggah."` when the column is null.

- [ ] **Step 2: Verify compile-green**

Run: `COREPACK_ENABLE_STRICT=0 yarn run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/orders/\[id\]/proof
git commit -m "feat(orders): owner/admin read endpoint for proof data URI"
```

### Task 6: `ProofImage` component

**Files:**
- Create: `src/app/_components/proof-image.tsx` (`"use client"`)

**Interfaces:**
- Consumes: `GET /api/orders/[id]/proof` (Task 5).
- Produces: `ProofImage({ orderId, variant, className }: { orderId: string; variant: "thumb" | "full"; className?: string })` — client component. On mount, fetch the endpoint; render `Skeleton` (from `@/components/ui/skeleton`) while loading, `<img src={imageData} alt="Bukti transfer" />` on success (thumb: `h-12 w-12 rounded object-cover`; full: `max-h-[50vh] w-auto rounded-lg` — merge with `className`), small muted text `"Gagal memuat bukti transfer."` on error.

- [ ] **Step 1: Implement** — `useEffect` fetch, `useCallback`-free simple state machine (`loading | error | imageData`); re-fetch only when `orderId` changes.

- [ ] **Step 2: Verify compile-green**

Run: `COREPACK_ENABLE_STRICT=0 yarn run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/_components/proof-image.tsx
git commit -m "feat(proof): shared ProofImage component with on-demand fetch"
```

### Task 7: Storefront — trim payload, inline proof display

**Files:**
- Modify: `src/app/(storefront)/orders/page.tsx:62,179,190`
- Modify: `src/app/api/orders/route.ts:266-308` (GET handler select + response)
- Modify: `src/app/_components/payment-panel.tsx:36-60` (`OrderProofRow`, `findOrderProof`) and footer (`~390-404`)
- Modify: `src/app/_components/orders-list.tsx:43,268-298,437`
- Modify: `src/app/_components/order-detail-dialog.tsx:50,157-166`

**Interfaces:**
- Consumes: `ProofImage` (Task 6), `orders.transferProofData` (Task 1).
- Produces:
  - `TransactionRow`/detail payloads carry `hasProof: boolean` instead of `transferProofData: string | null` (types in `orders-list.tsx`, `order-detail-dialog.tsx` `OrderDetailData`, `payment-panel.tsx` `OrderProofRow`).
  - `findOrderProof` returns `{ orderId, uploaded }` with `uploaded = row.hasProof === true`; `OrderProofRow = { id?: unknown; bookingId?: unknown; hasProof?: unknown }`.

- [ ] **Step 1: Trim `GET /api/orders`** (`route.ts` GET, `.select()` at line 267): replace `.select()` with an explicit column list = every `orders` column currently spread **except** `transferProofData`, plus `hasProof: sql<boolean>`is not null(${orders.transferProofData})`` (import `sql` from `drizzle-orm`). The spread at `route.ts:305-308` then carries `hasProof`, not the blob — this is the 4 s poll's payload.

- [ ] **Step 2: Trim the storefront page** — line 62: swap the selected column for `hasProof` the same way; lines 179/190: `transferProofData: order.transferProofData` → `hasProof: order.hasProof`. Update `OrderDetailData` (order-detail-dialog) and `TransactionRow` (orders-list) type fields accordingly: `hasProof: boolean`.

- [ ] **Step 3: Update `findOrderProof`** in `payment-panel.tsx` to the new `OrderProofRow` + `hasProof === true` rule. This feeds the panel's poll — same pure function, new field.

- [ ] **Step 4: Replace proof links with images**
  - `orders-list.tsx` (`:268-283`): keep the "Bukti terkirim —" line; replace the `<a href>` "lihat" with a plain `<button className="underline underline-offset-4">lihat</button>` that opens the row's existing detail dialog (same handler the row uses to open it). CTA gating at `:296` and `initialUploaded` at `:437` switch to `hasProof`.
  - `order-detail-dialog.tsx` (`:157-166`): replace the `<a>` block with `{order.hasProof && <ProofImage orderId={order.orderId} variant="full" />}`.
  - `payment-panel.tsx` footer (`~390-404`): replace the "Lihat bukti transfer" `<a>` with `{order.hasProof ? <ProofImage orderId={order.id} variant="full" /> : <span>Belum ada bukti transfer</span>}` (keep the span branch; use whatever field carries the order id in that scope).

- [ ] **Step 5: Verify compile-green + unit tests**

Run: `COREPACK_ENABLE_STRICT=0 yarn run check && yarn vitest run`
Expected: 0 errors, tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(storefront): inline proof images, hasProof flag instead of blobs in lists"
```

### Task 8: Admin — trim payload, inline proof display

**Files:**
- Modify: `src/app/admin/orders/page.tsx:66` (`.select()`), `:241,257`
- Modify: `src/app/_components/admin-orders-filter.tsx:51,233-241`

**Interfaces:**
- Consumes: `ProofImage` (Task 6), `hasProof` pattern (Task 7).
- Produces: `AdminOrderRow.transferProofUrl: string | null` → `hasProof: boolean`; admin page select explicit minus blob plus flag.

- [ ] **Step 1: Trim the admin query** — replace `.select()` (page line 66) with the same explicit-minus-blob-plus-`hasProof` list as Task 7 Step 1; row mapping at `:241,257` carries `hasProof`.

- [ ] **Step 2: Replace the proof link** in `admin-orders-filter.tsx` (`:233-241`): replace the `{order.transferProofUrl ? <a>…Lihat bukti transfer</a> : <span>…</span>}` block with `{order.hasProof ? <div className="flex items-center gap-2"><ProofImage orderId={order.orderId} variant="thumb" /><button className="text-sm text-primary underline-offset-4 hover:underline" onClick={/* open this row's detail dialog */}>Lihat bukti transfer</button></div> : <span>Belum ada bukti transfer</span>}`. The detail dialog (already rendered per row via `detail: OrderDetailData`, which Task 7 gave `hasProof` + the full-size `ProofImage`) is the full view; wire the button to the same open-dialog path the row's detail affordance uses.

- [ ] **Step 3: Verify compile-green**

Run: `COREPACK_ENABLE_STRICT=0 yarn run check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): inline proof thumbnails, trimmed order list payload"
```

### Task 9: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** consumes everything.

- [ ] **Step 1: Apply migration** — ask the human to run the generated migration (Task 1) against the dev DB.
- [ ] **Step 2: Run the app** (`yarn dev`) and walk the flow in the browser: upload an oversized photo (expect compression, success toast, badge flips), upload > 25 MB file (expect the 25 MB toast, no crash), view proof as customer (detail dialog image renders), view as admin (thumb + full view), confirm `GET /api/orders` response and the admin list payload contain no base64 blobs (browser devtools network tab). Verify an anonymous `curl` to `GET /api/orders/[id]/proof` returns 401.
- [ ] **Step 3: Report** — surface any failure found; fix through a follow-up task before shipping.
