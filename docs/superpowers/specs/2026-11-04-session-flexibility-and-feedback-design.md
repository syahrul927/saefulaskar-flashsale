# Session Flexibility & Feedback Response — Design

Date: 2026-11-04
Status: ready for partner approval (builder-check round resolved — see Rulings)
Source: `docs/feedback.md` (admin dry-run testing), `docs/assets/` (brand guide)

## Intent & why

Admins dry-ran the flash-sale app and filed 3 errors, 4 enhancements, 3 notes. The
core pain: **all session and product config is frozen the moment a session leaves
SCHEDULED** (spec §5.9), so a typo or stock change found during a live sale forces
killing and recreating the session. Secondary pain: the app leaks internal codes
(`PAUSED_BLOCK`, English 409 strings, generic "Aksi gagal") to users and mixes
English and Bahasa across surfaces. Branding is placeholder — the owner has now
supplied the real identity.

Success looks like: an admin can fix a product mid-sale without anxiety about
placed orders, every failure tells a human what to do next, and the whole app reads
as one product: "Flash Sale Grosir", all Bahasa, icons on actions.

## Goals

1. **Edit products while ACTIVE/PAUSED.** Unlock product POST/PUT/DELETE guards
   currently requiring `SCHEDULED` (`src/app/api/sessions/[id]/products/route.ts`,
   `.../products/[itemId]/route.ts`). Editable while session live: `flashPrice`,
   `sessionQuota`, `minOrder`, `category`, `type`; add products; remove products.
2. **Safety rules for mid-session edits.**
   - Placed orders are immutable by design: `order_item` snapshots price/sku/name/
     subtotal per line — a price or name edit only affects future carts. Keep it so.
   - Quota floor: `sessionQuota` can never be set below `claimed` (already sold).
     Reject with a Bahasa message naming the floor (e.g. "Minimal N (sudah terjual)").
   - **Remove = hide, not delete.** New per-product visibility state: hidden rows
     leave the storefront instantly; the DB row stays (order_items FK has no
     cascade — row deletion with orders would fail); existing orders remain valid.
     Admin roster keeps hidden rows, marked, with re-show.
   - Order-placement path must re-check hidden: a cart holding a just-hidden product
     gets a clear Bahasa rejection, not a crash or silent success.
3. **Single Save on the product page (feedback: "only one button").**
   - Replace per-row Simpan with one page-level Save; it flushes all dirty rows.
   - Dirty rows are visually flagged (tint + "belum disimpan" marker) until saved.
   - Instant actions (Tambah, hide/show, undo) keep their own per-button loading —
     this also resolves the "loading not apply for all button" complaint.
4. **Error UX, both levels.**
   - Reactive: every API error answers Bahasa, human, actionable. No raw enums
     toasted (`PAUSED_BLOCK`, `OVERLAP`), no English 409 strings leaking. Toast says
     what failed and what to do next.
   - Proactive: impossible actions are not offered — delete button only on
     SCHEDULED rows, Aktifkan blocked with inline reason while a PAUSED session
     exists, Tambah disabled at stok 0. Stok "—" (unknown) stays addable: unknown
     ≠ zero.
5. **Stepper end-state.** Customer-facing final step reads **"Selesai"** (step label
   and status badge), replacing "Dibayar — sales order dibuat" / "Dikonfirmasi" for
   customers. Rationale (partner-confirmed): from the customer's view the lifecycle
   ends at payment + sales-order creation; shipping is handled outside the app.
   Admin surfaces may keep enum labels where useful, but see Goal 6 — nothing raw.
6. **Bahasa sweep.** Every user-visible string on admin + storefront in Bahasa:
   buttons, badges, toasts, empty states, dialogs. Supersedes the old "admin keeps
   raw-enum labels" precedent.
7. **Icons on action buttons.** Every state-changing button gets a lucide icon in
   shadcn house style (Aktifkan, Jeda, Lanjutkan, Akhiri, Hapus, Simpan, Tambah…).
8. **Brand replacement — everywhere.** "Flash Sale Grosir" lockup and square icon
   (`docs/assets/Logo dengan tulisan Flash Sale Grosir@2x.png`,
   `docs/assets/Logo aplikasi (persegi)@2x.png`, colour/icon variants in
   `docs/assets/Variasi warna dan tampilan ikon@2x.png`) replace current naming in
   admin nav, storefront header, login, and app metadata/favicon. Owner decision.

## Non-goals

- Session-level config (name, start/end times) stays frozen once ACTIVE — only
  product config unlocks.
- No hard-delete of products in ACTIVE sessions — hide is the mechanism.
  Hard-delete remains for SCHEDULED cleanup.
- Nothing was named as anti-goal; partner confirmed scope as written ("nothing
  else for now").

## Prerequisite bug (not a design decision)

Session delete always fails: `session-actions.tsx` calls
`DELETE /api/sessions/{id}/delete`, but the DELETE handler lives at
`/api/sessions/[id]` — no `/delete` route exists, so every delete 404s into the
generic toast. Fix as a labelled prerequisite commit, via systematic-debugging,
before the feature work.

## Constraints

- Per project CLAUDE.md: shadcn primitives from `src/app/_components/ui/`; every
  API-triggered button uses `isLoading`; success + failure both surface `sonner`
  toasts; new dashboard pages use the standard page padding.
- Quota/stock truth comes from the cached Jubelio v2 stock map (`getStockMap`);
  hidden-product state is local only — no Jubelio write-back.
- Migrations: `pnpm db:generate` only; human applies.
- Do not read the brand PNGs into context; reference by path and inspect via
  screenshot or the human.

## Rulings (builder-check round, partner-agreed 2026-11-04)

1. **Re-add while ACTIVE/PAUSED = un-hide only.** The products POST is an upsert
   that currently resets `flashPrice → originalPrice`, `minOrder → 1`,
   `category → ""`, and re-derives quota from the stock map. That reset must NOT
   run on an existing hidden row during a live session — re-adding only clears the
   hidden flag and touches nothing else. (SCHEDULED keeps today's reset semantics.)
   Stock snapshot refresh is not implicit; it rides on ruling 2's quota edit.
2. **Quota edit refreshes `jubelio_stock`.** Checkout validates against the stored
   `session_products.jubelio_stock` snapshot, so an admin raising quota must not
   leave the snapshot below it: a mid-session quota change also refreshes
   `jubelioStock` from the live `getStockMap` value for that item. If the map
   misses (unknown stock), allow the edit and warn the admin ("stok belum
   tentu") — unknown ≠ zero, consistent with the picker's "—" rule.
3. **Customer status vocabulary.** Badges + stepper for customers:
   `UNPAID → "Belum Bayar"`, `CONFIRMED → "Selesai"` (terminal — the pending
   placeholder step disappears once paid), `COMPLETED → "Selesai"` too (sync
   progress never reads as a regression), `CANCEL → "Dibatalkan"` (wins over
   Selesai when it happens). Touches `stepLabel`, `CUSTOMER_STATUS_LABEL`,
   the stepper builder, and their tests.
4. **Brand scope = marks + name only — MY CALL from "ok all".** Swap logo lockup,
   square icon, app name, metadata/favicon across admin/storefront/login. The
   existing theme (yellow `--brand-primary`, Urbanist/JetBrains Mono, bolt tile
   replacement aside) is NOT re-skinned in this project. Partner to veto if a
   full re-skin was meant.
5. **Assets = supplied rasters — MY CALL.** Favicon/app-icon from raster downscale
   is acceptable; builder verifies transparency and picks the guide's variant per
   chrome (light admin nav vs dark storefront) during implementation, asking the
   owner for a transparent/alternate export only if a real clash appears.

## What's left to the builder

- API shape of batch-save (one endpoint receiving all dirty rows vs concurrent PUTs
  per row) — must stay failure-explicit: a row that fails (e.g. quota floor) names
  itself and keeps its dirty flag while others save.
- Exact dirty-tint treatment and hidden-row presentation in the roster.
- Icon mapping per button.
- The Bahasa glossary for recurring terms (Simpan, Tambah, Sembunyikan,
  Tampilkan lagi, Sesi, Stok…) so the sweep is consistent, not ad-hoc.
- Where the single Save sits (sticky footer vs top bar) and unsaved-changes warning
  on navigation.
- Hidden-product check placement in the order path (client cart rules + server
  guard — do both).
- `PAUSED_BLOCK` / `OVERLAP` message copy and whether the session list pre-computes
  "can activate" for the proactive layer.
