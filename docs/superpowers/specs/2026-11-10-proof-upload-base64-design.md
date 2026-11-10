# Transfer-Proof Upload: Base64 in DB (Drop Local-Disk Storage)

**Date:** 2026-11-10
**Status:** Approved design (brainstorm, 2026-11-10)

## Intent and Why

Production upload of transfer proofs fails. Root cause: `saveProof`
(`src/server/upload.ts`) writes the uploaded file to
`process.cwd()/public/uploads`. Vercel's serverless filesystem is
read-only (and ephemeral even where writable), so every production
upload fails, and any stored `/uploads/...` URL dies on redeploy.

Fix: stop writing files entirely. The client compresses the chosen
image to ≤ 500 KB, converts it to a base64 data URI, and the API stores
the data URI directly in the database. Display code changes to inline
`<img>` previews: `<a href>` links cannot navigate to `data:` URIs
(browsers block it), which was found in the builder check.

## Goals

- Upload works on Vercel (no local-disk dependency).
- Client-side compression to a hard 500 KB cap so request bodies stay
  far under Vercel's ~4.5 MB limit and DB rows stay small (~≤ 700 KB).
- Keep existing guards: signed-in owner of the order, JPEG/PNG only.
- Proof displays as an inline image (thumbnail in lists, full-size in
  dialogs) — replacing today's `<a href>` links, which cannot navigate
  to `data:` URIs.
- List views stay light: queries select a has-proof flag, never the
  blob; the full image loads on demand only.

## Non-Goals

- No external storage (S3, UploadThing, Cloudinary, Vercel Blob).
- No image CDN or transformation service.
- No server-side compression — compression is client-only.
- No backfill of old rows: existing `/uploads/...` URLs are already
  dead in production; leave them as-is.

## Design

### 1. Client compression (in `proof-upload-button.tsx` or a helper module)

On file selection, before any network call:

1. Decode the picked image (JPG or PNG) into an offscreen canvas,
   scaled so the long edge is ≤ 1500 px.
2. Encode as JPEG, quality 0.82. PNG inputs also become JPEG —
   receipts are photographs; transparency is not worth keeping.
3. If the encoded blob exceeds 500 KB, re-encode at progressively
   lower quality (step down, e.g. −0.12 per attempt) until it fits.
   Very large inputs may also need a smaller long edge; the loop may
   scale down further as needed.
4. Read the final blob as a data URI
   (`data:image/jpeg;base64,...`).

Client MIME check (accept attr) stays; a pre-compression size sanity
cap (e.g. reject > 25 MB raw) avoids canvas memory blowups — exact
value is a builder call.

### 2. API change (`src/app/api/orders/[id]/upload-proof/route.ts`)

- Request is **JSON**: `{ imageData: string }` (a data URI). Multipart
  handling is removed.
- Validation (server, replacing `validateProof` usage):
  - String starts with `data:image/jpeg;base64,` (or png) — prefix
    allowlist, and the base64 payload must decode.
  - Decoded byte length ≤ 500 KB plus small headroom (headroom exact
    value is a builder call; keep it small, e.g. a few KB).
  - Owner + signed-in guards unchanged. Error messages stay in
    Indonesian, matching existing style.
- Store the full data URI on the order.

### 3. Schema change: drop + add

`orders.transfer_proof_url` → **drop, then add** `orders.transfer_proof_data`
(`t.text()`). Not a rename: the human chose drop+add so old rows'
dead `/uploads/...` values are wiped — dead "bukti terkirim" badges
disappear and unpaid orders get their upload CTA back. Migration via
`pnpm db:generate` only — the human applies it manually (project rule;
never `db:push`/`db:migrate`). All `transferProofUrl` references in
app code become `transferProofData` (schema, queries in storefront
orders page, admin orders page, `console-kpi`, and the components
below).

Note: drop+add loses existing proofs. Accepted — they are unreadable
in production anyway (files gone with serverless restarts).

### 4. Payload shaping: lists stay light

Shipping ~700 KB data URIs in list payloads (and the 4 s poll in
`payment-panel.tsx`) is rejected. Instead:

- **List/detail queries** (`(storefront)/orders/page.tsx`,
  `admin/orders/page.tsx`, `GET /api/orders`) select a derived
  has-proof flag (e.g. `hasProof: sql<boolean>`or a small `select` on
  `isNotNull(...)`), never the blob column.
- **On-demand fetch:** a small read endpoint, e.g.
  `GET /api/orders/[id]/proof`, returns `{ imageData }` for one order.
  Guards: signed-in owner **or** admin (admins view proofs in the
  admin console today). Detail surfaces (order-detail dialog,
  admin proof view) fetch it when opened, showing a `Skeleton` while
  loading.
- The components below consume the flag for badges/CTA gating, and the
  on-demand endpoint for the actual image.

### 5. Consumers — display changes (builder check findings)

Today all proof display is `<a href>` links, which silently fail with
`data:` URIs (browsers block top-level navigation to them). Replace
with inline `<img>` previews:

- `src/app/_components/admin-orders-filter.tsx` — thumbnail in the
  admin list row (small, e.g. `h-12` rounded), click opens full-size
  view (existing dialog pattern).
- `src/app/_components/order-detail-dialog.tsx` — full-size inline
  `<img>` in the dialog, fetched on demand.
- `src/app/_components/orders-list.tsx` — keep badge + "lihat" affordance,
  now opening the image (thumbnail or full view via the detail dialog);
  upload CTA gating uses the has-proof flag.
- `src/app/_components/payment-panel.tsx` — uploaded-flag derivation
  switches to the has-proof flag.
- `src/server/console-kpi.ts` — KPI count switches to the renamed
  column (`isNotNull(orders.transferProofData)`); no payload impact.

Exact preview component shape (shared `ProofImage` component vs.
per-site markup) is a builder call — shared component preferred.

### 6. Cleanup

- Delete `saveProof` and the disk-write path from
  `src/server/upload.ts` (validation constants/logic move or reshape
  to the JSON/data-URI checks above).
- `public/uploads` is no longer written or referenced by new uploads.

## Constraints

- Vercel serverless: read-only FS, ~4.5 MB request body cap.
- Project rules: yarn only; migrations via `pnpm db:generate` with
  human-applied execution; sonner toasts on success/failure (existing
  behaviour in `ProofUploadButton` already does this).
- Browsers block top-level navigation to `data:` URIs — proof display
  must be `<img src>`, never `<a href>`.
- List payloads must not carry blobs (perceived-performance rules;
  4 s poll would re-ship them).

## Decisions Made (with the human)

- Compression, not validation-only: approved.
- Cap: 500 KB compressed; base64 headroom small — builder settles
  exact number.
- Column: **drop + add** `transfer_proof_data`, wiping dead URLs
  (rename rejected) — human applies migration.
- PNG → JPEG conversion: Claude's call, accepted in playback.
- Proof display: inline image preview (thumbnail in lists, full-size
  in dialogs) replacing `<a href>` links.
- Payload shaping: trim lists — has-proof flag in list queries, blob
  fetched on demand via a small read endpoint.
- Accept that drop+add loses existing (already dead) proofs.

## Left to the Builder

- Exact compression fallback loop shape (quality steps vs. scale
  steps, or both) to reliably land under 500 KB.
- Raw-input sanity cap before canvas decode (suggest ~25 MB).
- Server headroom value over 500 KB.
- Whether compression helper lives inline in the component or a
  separate `src/lib/` module (separate module + unit-testable pure
  helpers preferred).
- Shape of the derived has-proof flag in Drizzle selects.
- Shared `ProofImage` component design (thumbnail/full-size variants,
  Skeleton while fetching).
- Read endpoint guards: exact admin-role check to mirror how admin
  pages authorize today.
- Test strategy for the pure validation logic and, if practical, the
  compression helper.
