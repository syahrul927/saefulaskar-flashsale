# FlashStudio UI Alignment — Mockup "Close Enough" Design

Date: 2026-10-26
Status: draft v2 — visual treatment locked by user after before→after previews (customer + admin tracks); document approval pending
Design source of truth: `docs/design.html` (single-page Alpine mockup, role switcher demo). Prior system design: `docs/superpowers/specs/2026-10-23-flashstudio-design.md` — this doc changes presentation and two data deltas only; all business rules there remain in force.

## 1. Intent & Why

The end user (Saeful Askar) has seen the built admin and customer pages but their verdict is "not close enough" to their mockup. Earlier development did not follow `docs/design.html` carefully, so the app reads as a different product even though features work. This project transplants the mockup's look, chrome, states, and interaction feel onto the existing routes, keeping the real flows the code already enforces.

Success = user opens admin and customer pages and says the app "is the design" — without literally rebuilding every screen's flow.

## 2. Goals, Non-Goals, Anti-Goals

### Goals
- Whole-app visual language matches the mockup: Urbanist + JetBrains Mono typography, brand yellow `#FFCC05` / orange `#FF7E33` tokens, neutral-200 bordered white cards with gradient top bar, tinted rounded-full pulse-dot badges, mono numerals everywhere (prices, SKUs, IDs, countdowns, quantities).
- Customer chrome that doesn't exist at all today: sticky header with logo tile, OFFICIAL SALE badge, Store↔Transactions tab nav, cart button with live count + subtotal. This also fixes a real reachability bug: on desktop the cart drawer currently cannot be opened (`mobile-cart-bar` is `md:hidden`) and `/orders` has no nav link.
- Admin chrome matches mockup: logo tile, pulsing JUBELIO SYNC badge, "Active: <session>" pill, segmented-control nav, `max-w-7xl` containment on header and pages.
- Admin KPI tile row (Products Allocated / Total Quota / Reserved–Bought / Estimated GMV) on the sessions console — data already exists in DB, never rendered.
- Roster as desktop inline-edit table (`md:` and up) + distinct mobile card variant, styled per mockup; ERP picker as real modal (`max-w-3xl`, multi-add with Added/+Add toggle, "N SKUs" counter, running selection count, Done Configuring footer, stock + normal price per row).
- Customer storefront feels urgent like the mockup: gradient-topped urgency banner with boxed Hours:Mins:Secs countdown (amber seconds cell), horizontal-snap category pills, product cards with hover lift + corner badges (category pill, `MIN: n PCS` amber badge), neutral "ALLOCATION SOLD OUT" treatment (not red chip), "n remaining" low-stock callout, quick-add stepper.
- Transactions screen: status filter pills with unpaid count, amber ring + pulse treatment for UNPAID orders, mono line items with per-line totals, rich empty state with CTA back to catalog.
- Checkout recipient step (Tier 3, user-confirmed as real): "Checkout & Aman-kan Pesanan" modal collecting nama / telepon / alamat, **pre-filled from the customer's onboarding contact** (`contacts.contactName`, `phone`, `sAddress`), editable per order, saved as an order-level snapshot.
- Payment & receipt surfaces styled to mockup while keeping the real model (bank transfer + WhatsApp proof upload, no VA gateway, **no payment countdown**): Payment-instructions-style panel (copyable account numbers, WA proof CTA, gentle "selesaikan pembayaran sebelum sesi berakhir" copy) and an Official-Order-Receipt-style view per order (status bar, item table, fee lines, copy order ID).
- Empty/loading/error states across both tracks styled per mockup (icon + copy + CTA, not dashed text box).
- Fix real bug: `admin/sessions/[id]/products/page.tsx` drops `jubelioStock` when mapping rows (`availableStock: null` hardcoded) — roster/picker must show actual stock.

### Non-Goals
- Not a 1:1 pixel replica. Layouts, radii, typography, badges, spacing tokens, and states match; incidental differences in content density remain acceptable.
- No role-switcher demo chrome — admin and customer tracks stay separate apps/sections as today.
- No VA number, courier/tracking display, or simulate-payment buttons — fulfillment is Jubelio's; no data source.
- No real product images — Jubelio feed returns none (`docs/jubelio-api-guide.md`); keep letter-tile placeholders but style them as designed image frames (`aspect-square`, brand-tinted letter tile) so transplanting images later is drop-in.
- No re-architecture: admin keeps session list → new/edit/products sub-pages; guarded status transitions and "only SCHEDULED editable" rules stay; per-row Simpan save stays (mockup's implicit save conflicts with server validation).

### Anti-Goals
- Breaking working flows (ordering, proof upload, Jubelio SO creation, cron sync) while restyling.
- Making the app English — user said copy stays Bahasa Indonesia.
- Losing dark mode (app has `.dark` tokens) or shadcn accessibility (keyboard, focus rings) in the transplant.
- Replacing the real payment model with the mockup's fake one because it looked nicer.

## 3. Constraints

- Stack: Next.js App Router + Tailwind v4 (`src/styles/globals.css` `@theme`) + shadcn UI (`src/app/_components/ui/`) + tRPC/API routes + Drizzle/pg. Fonts loaded in `src/app/layout.tsx`.
- Reuse shadcn base components; extend variants rather than fork. New dashboard pages keep standard page padding (`flex-1 space-y-6 p-4 md:p-6`).
- Project perceived-performance rules apply to every touched surface: `isLoading` Button on API-triggered actions, Skeleton placeholders for pending data, sonner toast for every action outcome, never block navigation on data.
- DB: only `pnpm db:generate`; human applies migrations manually. Use yarn, never npm/pnpm/bun.
- Keep Better Auth session handling, cron routes, and API contracts stable except the additive checkout fields.
- Mobile-first: storefront primary surface is phone (mockup header is `maximum-scale=1`, bottom-anchored cart); admin desktop table + mobile card variants both required.

## 4. Decisions Made With The User (Locked)

1. **Transplant look, keep flows** — admin keeps current structure (list + sub-pages, guarded transitions); mockup's single-console/free-status-switch is demo fiction.
2. **Close enough, not 1:1** — ranked by visible impact; texture consistency beats pixel diffs.
3. **Bahasa Indonesia copy**, styled with mockup's uppercase + tracking-wider heading treatment where it fits Indonesian labels (section headings, badge text, empty-state titles). Sentence-case stays for body/descriptions.
4. **Checkout recipient form is a real requirement** — name/address collected at checkout, pre-filled from onboarding contact as defaults.
5. **Tier 2 data wins included**: KPI tiles, `jubelioStock` fix, "n remaining", picker row stock/normal-price display, `type` column.
6. **VA/courier/tracking, real images, role switcher, single-console restructure: excluded** (user did not object when listed).
7. **No payment countdown** — user ruled (a): keep prior spec's no-timer decision; mockup's 15-min payment timer is dropped, urgency timer only for session end.
8. **Treatment confirmed visually** — before→after previews of customer chrome/cards/countdown/checkout-prefill and admin header/KPI/roster-table/picker-modal shown in brainstorm session; user locked both tracks as drawn (previews saved under `.superpowers/brainstorm/*/content/preview-*.html`). The previews are the reference for tone of Indonesian labels + token usage; the mockup `docs/design.html` remains layout source of truth.

## 5. Builder's Calls (defaults — confirm if wrong)

- **Dark mode**: keep `.dark` support; map brand tokens so yellow stays yellow, neutral surfaces invert sanely. Mockup is light-only; builder adapts.
- **Token naming**: add `--brand-primary`, `--brand-primary-hover`, `--brand-secondary` + `@theme inline` `--color-brand-*` entries; map shadcn `--primary` to brand yellow surfaces where mockup uses `bg-brand-primary`, keep ink (`neutral-950`) for the mockup's dark-button contexts (`bg-neutral-950` → e.g. `btn-ink` variant on Button). Replace current oklch approximations with exact hex-derived oklch.
- **Fonts**: `Urbanist` (400–800) via `next/font/google` → `--font-sans`; `JetBrains_Mono` (400–700) → `--font-mono`. Drop Geist/Outfit/Inter entirely.
- **Radius scale**: cards `rounded-2xl`→ keep `--radius: 0.5rem`-ish base with `rounded-xl` controls, `rounded-full` badges. Remove ad-hoc `rounded-4xl`/`rounded-3xl` uses in favor of scale.
- **Icons**: mockup uses Heroicons-outline stroke SVGs; app has `@phosphor-icons/react` — use Phosphor at regular weight `strokeWidth`-matched size as the single icon set (don't add a second icon library); replace the "✅" emoji on `/orders` with a real icon.
- **Badge system**: new `StatusBadge` component wrapping shadcn Badge: variants = amber/emerald/blue/red/neutral tints (`bg-*-50 text-*-900 border-*-200`) + mono text + optional `animate-pulse` dot. Used on both tracks for session status, order status, JUBELIO SYNC, OFFICIAL SALE, MOQ.
- **Card system**: shared `Panel` treatment = white card, `border-neutral-200`, soft shadow, 2px `bg-gradient-to-r from-brand-primary via-brand-secondary` top bar, dot + uppercase title header row, `bg-neutral-50/70` section headers with mono `N` counters.
- **Countdown**: `countdown-timer.tsx` reworked to boxed H:M:S cells with labels + colon separators, seconds cell amber-tinted; reused in urgency banner and pay-window panel.
- **Order snapshot columns**: add nullable `recipientName`, `recipientPhone`, `recipientAddress` to `orders` (fallback read = contact record for old orders); API accepts them, Jubelio SO uses snapshot values.
- **`type` column**: `sessionProducts.type` text, default `'single'`, options `single | variable | bundle` (labels: "Single SKU" / "Variable" / "Bundle Pack"), admin-editable in roster row; storefront shows mockup's type chip when `variable`/`bundle`.
- **Pay window**: DECIDED (user) — no payment countdown anywhere. Prior spec decision 12 stands: stock claimed at checkout, nothing auto-expires, admin cancels stale UNPAID manually. The mockup's 15-min MM:SS timer is demo prop — transplant the payment panel's look, omit the timer. No boxed-countdown usage in payment/receipt surfaces; `countdown-timer` rework serves the session urgency banner only.
- **KPI row + "AKTIF:" pill scope (builder's call)**: bind to the same session the storefront resolves (earliest-created ACTIVE), one shared server helper used by admin header, admin KPI tiles, and roster strip; hidden/`—` when zero ACTIVE sessions.
- **Category dropdown (builder's call)**: options = fixed taxonomy list ∪ distinct existing `sessionProducts.category` values (legacy free-text remains selectable until re-saved); empty/null category renders as "Umum" so storefront pills never lose products. Real taxonomy to be supplied by user later if the placeholder list misses.
- **Customer header placement**: new `src/app/(storefront)`-less approach — render shared `StorefrontHeader` client component inside `storefront-view.tsx` and `/orders` (and reuse cart-context-driven cart button); avoids route-group refactor.
- **Copy translation set**: builder writes Indonesian strings mirroring mockup intent ("Keranjang Flash", "Bayar Sekarang", "Instruksi Pembayaran", "Struk Pesanan", "Terjual Habis", "Lihat Produk" …); tone = mockup's punchy urgency, uppercase allowed.

## 6. Per-Screen Change Map

### Shared foundation (`src/app/layout.tsx`, `src/styles/globals.css`)
Fonts, brand tokens, radius scale, selection color, thin scrollbar styling, StatusBadge + Panel + Countdown primitives. Everything below consumes these; visual consistency lives or dies here.

### Admin track
| Screen | Changes |
|---|---|
| `admin/layout.tsx` | Mockup header: logo tile (bolt), JUBELIO SYNC pulse badge, Active-session pill, segmented nav (Sesi/Pesanan), sticky blur, max-w-7xl |
| `admin/page.tsx` | KPI tile row above session list; Panel treatment + StatusBadge on cards; uppercase section heads |
| `sessions/new` + `[id]/edit` | Panel-wrapped `session-form.tsx` per "Live Session Parameters" styling (dot+title header, field labels uppercase-micro); keep save flow |
| `sessions/[id]/products` + `product-picker.tsx` | Desktop inline-edit table + mobile card roster (keep per-row Simpan); amber Min Order inputs; mono numerics; trash-icon row action; show real `jubelioStock`; `type` select; category dropdown w/ fixed list; header band "N Produk Aktif" counter; empty state icon+CTA; KPI strip reuse for session context |
| ERP picker | Modal form factor per mockup: search w/ inline magnifier + mono placeholder, "N SKU" live counter, rows show letter-tile image frame + SKU chip + stock (emerald bold) + normal price (mono), Added ✓ / + Add toggle, footer "N dipilih" + dark "Selesai" button |
| `admin/orders/page.tsx` | Panel + StatusBadge + mono numerics; keep features; status filter chips styled like customer transactions |

### Customer track
| Screen | Changes |
|---|---|
| New `StorefrontHeader` | Sticky white/95 blur header: logo tile, OFFICIAL SALE badge (no Jubelio mentions), Store↔Transaksi tab links, cart button with count + subtotal, opens `CartDrawer` on all breakpoints |
| `storefront-view.tsx` | Urgency banner (gradient top, boxed countdown, session name uppercase); category pills horizontal-snap, active = ink bg; grid `grid-cols-1 sm:2 lg:3 xl:4`; rich empty state |
| `product-card.tsx` | `aspect-square` image frame (styled letter tile), corner category pill + amber MOQ badge, hover lift/zoom, mono price + struck normal price, "sisa n" low-stock callout (orange), sold-out = neutral overlay + mono "SOLD OUT Habis" chip + disabled button, ink quick-add button + stepper |
| `cart-drawer.tsx` | Right slide-over on `md:`, bottom sheet on mobile (keep), Panel header "Keranjang Flash" w/ count, item rows w/ image frame + mono, discount/savings lines surfaced, ink full-width checkout CTA |
| New `CheckoutForm` step | Modal/panel per mockup §"Checkout & Aman-kan Pesanan": pre-filled nama/telepon/alamat from contact, editable, breakdown summary, submit = existing POST + new snapshot fields; Button isLoading + sonner on outcome |
| Payment surface | Restyle existing bank-info/proof panel as "Instruksi Pembayaran": copyable account rows, WA proof CTA, order status live-poll skeleton — no countdown (Decision 7) |
| New receipt view | "Struk Pesanan" per order (modal or `/orders` expand): status bar, item table w/ mono totals, fee lines (ongkir promo "Gratis"), copy-order-ID, proof upload CTA when UNPAID |
| `orders/page.tsx` | Tabs header, status filter pills w/ unpaid count, UNPAID amber ring + pulse dot card, line items w/ images/totals, rich empty state → "Lihat Produk Flash" CTA; replace ✅ emoji |
| `mobile-cart-bar.tsx` | Keep as-is structurally; restyle to mockup (ink pill, mono subtotal) |

### Data/schema delta (drizzle)
- `orders`: `recipientName`, `recipientPhone`, `recipientAddress` (nullable text)
- `sessionProducts`: `type` (text, default 'single')
- Fix stock mapping in `admin/sessions/[id]/products/page.tsx`
- API: `POST /api/orders` accepts recipient fields (zod-validated, optional — server falls back to contact); trpc/session update accepts `type`
- Generate migration with `pnpm db:generate` only; human applies.

## 7. What's Left to the Builder

Component decomposition, exact file layout, animation details (mockup has none beyond pulse), focus/a11y wiring, string copy polish within Indonesian constraint, table→cards breakpoint tuning, whether receipt is modal vs route, category dropdown option list source (start hardcoded per mockup: Elektronik, Fashion, dll — from mockup's list), and test coverage per repo conventions. Plan step: `superpowers:writing-plans`.

## 8. Verification Approach

- Side-by-side check against `docs/design.html` sections per screen (light + dark, mobile + desktop widths).
- Flows exercised end-to-end untouched: login → onboarding → storefront browse → cart → checkout (prefill + edit) → order created → payment panel → proof upload → admin sees order → session roster edit → ERP picker add.
- `pnpm lint`/typecheck/build green; no runtime errors in browser console on touched pages.
