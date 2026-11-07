# Brand Palette Alignment & Customer-First Login — Design

Date: 2026-11-06
Status: builder-check round resolved — both partner questions answered; ready for approval
Source: partner brief (retoken `globals.css` to the supplied logo; make the login page
customer-first), `public/brand/logo-*.png`, browser session
`.superpowers/brainstorm/37063-1793935724/` (4 mockup screens, choices: `login-priority` A,
`palette-primary` B, `login-copy` B, `onboarding-notice` C)

## Intent & why

The owner supplied a real identity for the product — mark orange `#EA580C` on wordmark slate
`#1F2937`, flat, on white. The app still dresses itself in the *previous* brand's yellow
(`--color-brand-primary: #FFCC05` plus yellow-tinted shadcn semantic tokens), so every surface
that carries the logo also carries a competing accent two hues away. The login page was already
moved to brand-orange in the working tree; everything else is still yellow.

The second problem is audience. `/auth/login` was built for the owner: headline "Masuk ke dasbor",
Jubelio email/password as the main event, the customer's only door (Google) demoted to a footnote
under a divider. Customers are the people who actually arrive — from a link in a WhatsApp group,
with no one on hand to explain anything — and they land on a page that reads as staff-only. The
owner's own framing: *"for admin we can tell the guide, but customer, I expect they understand to
login with google directly."*

Success looks like: the app is recognisably the logo's brand without a component-by-component
rewrite, and a first-time customer who has never been told anything knows within one second what
to press.

## Goals

1. **Re-derive the palette in `src/styles/globals.css` only.** Semantic tokens
   (`--primary`, `--accent`, `--secondary`, `--background`, `--card`, `--foreground`,
   `--border`, `--input`, `--ring`, `::selection`, `--sidebar-*`, `--chart-*`) become ink +
   orange in light and dark. The two legacy brand tokens (`--color-brand-primary[-hover]`,
   `--color-brand-secondary`) keep their names and change value, so the ~20 components that
   hardcode them — panel top gradients, live pill, cart dot, discount progress bars, focus
   borders — follow without edits. That value-swap is the partner's stated method: adjust the
   palette, do not touch components. (Relaxed for goal 4 — the full amber sweep puts colour classes
   inside components in scope. Structure, props and copy still are not.)
2. **Split the login page by audience.**
   - `/auth/login` (existing URL) becomes the **customer** page: lockup, headline
     *Masuk untuk belanja*, one supporting line, one full-width `GoogleSignInButton`, a quiet
     "Masuk sebagai staf" link, and nothing else. No steps, no instructions — the partner chose
     the shortest version of the three mockups; trust comes from the live countdown on the ink
     plate, which stays and keeps its `tone="ink"` boxed countdown.
   - `/auth/staff` (new route) takes the **Jubelio email/password** form: paper card, lockup,
     the moved `AuthForm`, submit unchanged (pushes `/admin`), and a quiet link back to the customer
     page. No countdown plate — it is a tool, not a storefront. *(Amended 2026-11-07: the submit
     moved off `variant="mark"` onto `variant="default"` with the rest of the orange fills — see the
     amendment row in "Decided by the partner". The route, the copy and the redirect are unchanged.)*
3. **Point the doors at the right page.** Middleware guards `/admin/*` → `/auth/staff` and other
   protected paths → `/auth/login`; `admin/layout.tsx` and `use-session-expiry.ts` (both
   admin-only) → `/auth/staff`; `SignOutButton` gains a `redirectTo` prop (default `/`) with
   `admin/layout.tsx` passing `/auth/staff`; `/login/success` sends a live session to `/`.
   Customer-facing guards (`(storefront)/orders`, `onboarding`) keep pointing at `/auth/login`.
4. **De-yellow the hardcoded `amber-*` classes** (26 sites, 9 files) — the partner chose the full
   sweep (C): nothing on screen keeps the old brand yellow, and caution keeps a colour of its own.
   Split, site by site:

   | kind | sites | becomes |
   |---|---|---|
   | decoration | `countdown-timer.tsx:48` (paper-tone accent cells), `product-thumb.tsx:35`, `product-picker.tsx:156,205,207,240,242` (no-photo placeholder tiles + initial letter), `filter-pill.tsx:50,51` (live count dot/ping), `badge.tsx:21` (`amber` variant as used by `admin/layout.tsx:55` live pulse and `product-card.tsx:98` MOQ badge), `cart-drawer.tsx:183` | brand orange tokens — fills/tints use `brand-primary`/the accent tint, small text on paper uses `brand-action` (5.2:1) |
   | caution | `payment-panel.tsx:288,292,294` (proof awaiting), `orders-list.tsx:150,207,209,226` (awaiting payment), `cancel-order-button.tsx:54` (confirm dialog), `filter-pill.tsx:44,62` (unpaid pill + count chip), `product-picker.tsx:475,503,1554,1680` (dirty / pending-sync cells), `status-badge.tsx:13,32` (`PAUSED`, `UNPAID` → amber) | `destructive` red for late/at-risk; a neutral ink chip for merely-waiting-on-customer (builder call #12) |

   `status-badge.tsx` already carries a `red` tone, so the caution side is a mapping change;
   `badge.tsx` needs an `orange`/`mark` variant added beside `emerald`/`blue`/`neutral` so the
   decoration side has somewhere to land. Comment at `filter-pill.tsx:9` describing the amber count
   chip gets corrected with the swap.
5. **Say what onboarding data is for.** `src/app/onboarding/page.tsx`: sub-line reworded to state
   that this becomes the default for every order (ship address, PIC, WhatsApp), the phone label
   renamed to "No. WhatsApp", and a short note above the submit button repeating that it can be
   changed per order at checkout. Lightest of the three weights offered — no callout block, no
   per-field helper text.

## Non-goals

- **No schema change, no migration.** The `contact` table keeps its 5 fields; the phone number
  *is* the WhatsApp number. No new columns, no `db:generate`.
- No component restructuring, and no new components beyond the `/auth/staff` page. `AuthForm`
  moves URL, not shape. Component edits are limited to **colour classes** (goals 1's four AA text
  sites and goal 4's amber sweep) — layout, structure, copy of unrelated components and props
  stay put.
- No `--radius`, font, spacing or motion changes. `--font-urbanist` / `--font-jetbrains-mono` stay.
- No admin dashboard redesign beyond what the token swap does to it for free.
- No email/password or magic-link sign-in for customers. `emailAndPassword` stays commented out —
  Jubelio is the credential source of truth and Google is the customer path.

## Anti-goals

- Yellow surviving anywhere as a brand colour — including a palette that looks orange in the
  tokens and still renders `#FFCC05` through a hardcoded class nobody re-pointed.
- A customer page that needs an explanation from staff to be used.
- An admin who has to hunt for the form they have used for months, or lose a bookmark.
- Any text-bearing surface that fails WCAG AA.

## Constraints

- **Contrast maths is fixed by the logo, not by taste** (verified with an oklab-relative-luminance
  script, 2026-11-06): `#EA580C` under white text is **3.56:1** — fails AA, fine as a rule, dot,
  ring or large digit. `#C2410C` under white text is **5.18:1** ✓. `#EA580C` under near-black text
  is **5.56:1** ✓. `#1F2937` under white is **14.68:1** ✓. `#C2410C` on tint `#FFF1E6` is
  **4.68:1** ✓. `#F97316` on dark `#12171D` is **6.43:1** ✓.
  *(Amended 2026-11-07: the button fill is no longer `#1F2937` but `#1E3351`, the same hue lifted so
  a 36 px control reads navy instead of black — **12.75:1** under white. Both numbers stay here
  because the slate is still the text colour and the login plate; only the fill moved.)*
- **Orange as *text* on paper is the one case the value-swap cannot reach.** `--color-brand-secondary`
  and `--color-brand-primary` are used as fill/gradient *and* as text colour on paper at small sizes —
  `product-card.tsx:138` (`sisa …`, 10px), `cart-drawer.tsx:249` (`Hemat …`), `kpi-tiles.tsx:116` and
  `admin/page.tsx:164`. `#FB923C` on white is ≈2.3:1 and `#EA580C` is 3.56:1, so a token-only swap
  ships text that fails AA. Ruled (see builder call #10): the four text sites move to
  `text-brand-action` (#C2410C, 5.18:1) and the token values stay bright for the graphics that use
  them. That is a 4-class edit inside the "adjust the palette, not the components" method, not a
  restructure — the partner should still see it listed.
- **Hover on an orange fill must lighten, not darken.** *(Amended 2026-11-07: no labelled control
  fills with orange any more, so this no longer describes a button. It still binds any orange
  surface that gets a hover, and it is why `--color-brand-primary-hover` stays `#F97316`.)* The
  reasoning is unchanged: darkening to `#C2410C` under near-black text is **3.83:1** (fails —
  re-measured 2026-11-07 as **3.82:1**), so hover moves up the ramp instead — `#F97316` is
  **7.06:1** under the same near-black — unlike the yellow it replaces. For the record, the deleted `variant="brand"` was `bg-brand-primary text-neutral-950
  hover:bg-brand-primary-hover`.
- **`logo-lockup.png` and `logo-square.png` are opaque white** (see memory
  `brand-logo-asset-constraints`). Any surface the lockup sits on must be white/paper, which is
  why the staff page and the customer form panel stay light and the plate stays dark-with-text-white.
- Middleware is a cookie-presence check only — it cannot know role, so the staff/customer split
  must be made on **path**, not on who is asking.
- `/auth/*` is already outside the middleware matcher, so `/auth/staff` is public with no matcher edit.
- The working tree already carries the login redesign (`auth/login/page.tsx`, `auth-form.tsx`,
  `button.tsx` `mark` variant, `countdown-timer.tsx` `tone="ink"`, 12 new brand tokens in
  `globals.css`) uncommitted. Per memory `clean-diffs-over-uncommitted-streak`, land that as a
  labelled prerequisite commit before this work starts, so the palette diff stays readable.
- Repo rules: yarn via `COREPACK_ENABLE_STRICT=0 yarn run …`, never `db:push`/`db:migrate`,
  shadcn primitives in `src/app/_components/ui/` / `src/components/ui/` before writing new ones.

## Decided by the partner

| Question | Choice |
|---|---|
| How far should the admin form be hidden? | **A** — Google is the whole customer page; staff form on its own route, quiet link |
| Which palette? | **B** — ink leads, orange only as marks (not A "everything orange", not C "orange for money") |
| Login copy weight | **B** — nothing but the button; no numbered steps |
| Redirect split | Accepted as proposed (staff doors → `/auth/staff`, customer doors → `/auth/login`, `/login/success` → `/`) |
| Onboarding notice weight | **C** — sub-line + one note above submit, "No. WhatsApp" label |
| Button fill colour (amendment, 2026-11-07) | **brand-ink, never orange.** Partner: *"use orange as button looks bad idea, I want to use brand-ink instead as button for the button that use orange current implementation. then for the text on the button change to white."* This vetoes builder call #1 below: the 5 orange sites (4 `variant="brand"` + the staff door's `variant="mark"`) became `variant="default"` — `--primary` with a white label — and both orange-fill variants were deleted rather than repainted. Orange survives only as decoration: dots, chips, tints, rules, the focus ring, and orange *text* via `brand-action`. The 15 `variant="ink"` (neutral-900) sites were ruled out of scope: #171717 measures **1.22:1** against the `#1F2937` fill of that moment (**1.41:1** against today's navy), so converting them changes nothing a person can see. Pinned by `tests/cta-fill-ink.test.ts`. |
| CTA fill value (second amendment, 2026-11-07) | **`--primary` is the logo's navy, lifted: `oklch(0.32 0.06 256.8)` = `#1E3351`.** The first amendment landed the fill at the sampled wordmark slate `#1F2937`, and the partner immediately reported *"kayaknya warna brand ink ada yang salah. yang muncul warna hitam"* — the button read black. Measurement found no wiring defect: the fill painted exactly `rgb(31,41,55)`, identical to `bg-brand-ink`, and the logo wordmark re-samples to the same. The real cause is area-dependent hue perception: `#1F2937` sits at L\* 16.3 with only B−R 24 of blue tint, which the eye resolves as navy across the login plate's 500×327 px but collapses to black in a 36 px control. Asked which navy they meant, the partner said *"Navy I mentioned was the same navy on the login page"*, then *"I want to change primary color to that navy"* — so the fill moved, at the same hue, to L\* 21.0 / B−R 51. `#1E3351` under white measures **12.75:1** (AAA, down 2.93 points from 14.68:1, still far over the 4.5:1 bar). `--foreground` and `--color-brand-ink` keep the logo-exact slate: copy and the plate should be sampled values, only the *fill* needed the lift. One-token change, so the 20 button sites and the other `bg-primary` controls (checkbox, switch, calendar) move together. Pinned in `tests/brand-palette.test.ts`. |

## Left to the builder (my calls, listed for veto)

1. **The 4 `variant="brand"` payment CTAs keep an orange fill** (`payment-panel.tsx`,
   `storefront-header.tsx`, `orders-list.tsx` ×2). Palette B makes every *default* button slate;
   these are already explicitly brand-filled for money actions, and near-black text on `#EA580C`
   is AA. Turning them ink would be strictly-more-B and would leave no orange on any button.
   **VETOED 2026-11-07** — see the amendment row in "Decided by the partner". Leaving no orange on
   any button turned out to be the outcome the partner wanted, not a cost: my reasoning was that
   AA-passing was enough to keep the fill, and it was wrong on taste, not on maths. All 4, plus the
   staff door's `variant="mark"`, now read `variant="default"`.
2. **`--color-brand-primary-hover` lightens to `#F97316`** (constraint above), and
   `--color-brand-secondary` → `#FB923C` so the `from-brand-primary via-brand-secondary` gradients
   read as one hue family instead of a two-brand clash.
3. **Dark mode canvas shifts from neutral to ink-hued** (`--background` ≈ `#12171D`,
   `--card` ≈ `#1B222B`) so dark mode is the same brand at night, with `#F97316` as the dark-mode
   orange. Dark `--primary` = paper fill with ink text, mirroring the approved mock.
4. **`default` (slate) and the existing `variant="ink"` (neutral-900) stay distinct** rather than
   merging — 15 call sites chose `ink` deliberately.
5. **`product-picker.tsx` `cellInputAmberClass` moves from the `amber-*` tailwind scale to the
   orange tint tokens.** It is a brand highlight on a special cell, not a warning state. (Now
   covered by the goal 4 sweep, which also moves the caution sites to red — see call #12.)
6. **`/auth/login` metadata title and the plate's owner-facing copy change** ("Buat dan aktifkan
   sesi baru begitu kamu masuk ke dasbor" is owner talk on a customer page). Plate copy is
   buyer talk: live status, countdown, one line about wholesale price and limited quota. Exact
   wording is the builder's, must stay Bahasa, must not promise a discount that isn't live.
7. **Google-not-configured fallback**: when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are absent,
   the customer page renders an unavailable line instead of a dead button, and keeps the staff
   link. The button otherwise behaves as today (`callbackURL="/onboarding"`).
8. **Checkout's recipient phone field gets the same "No. WhatsApp" label** for consistency with
   onboarding — the partner was asked and did not answer, so this is reversible at review.
9. **`/auth/staff` keeps no plate and no countdown**; one quiet link back to `/auth/login`, and
   it stays non-indexed by omission (no `robots` work in scope).
10. **Four `text-brand-*` sites become `text-brand-action`** (`product-card.tsx:138`,
    `cart-drawer.tsx:249`, `kpi-tiles.tsx:116`, `admin/page.tsx:164`) — the constraint above. Every
    other brand-token use stays as written and follows the value swap.
11. **Dark mode gets correct *semantic* tokens, not theme-reactive brand tokens.** `.dark` is
    unreachable today (nothing sets a theme class, no provider, no toggle, and
    `@custom-variant dark` only matches a `.dark` ancestor), so the `.dark` block is translated
    faithfully for when it is wired up, and the static hexes in `@theme inline` are *not* restructured
    into per-theme vars — that would touch all ~30 brand call sites for a surface nobody can reach.
    Consequence, stated plainly: in a hypothetical dark mode, decorative gradients keep
    `#EA580C`/`#FB923C` rather than the mock's lighter `#F97316`. Dark is verified by injecting
    `.dark` in devtools on the four approved surfaces, not by shipping a toggle.
12. **Caution splits into two tiers, not one red.** Option C said warnings go red; blanket red
    would make a routine "waiting on the customer" order read as a failure and paint the admin
    list alarming. Ruled: `destructive` red for late/at-risk (unpaid filter pill + the two
    awaiting-payment callouts, `PAUSED`, cancel-confirm dialog); a neutral ink chip for merely
    pending (dirty/pending-sync picker cells, `UNPAID` in the storefront list). Reversible if the
    partner would rather have uniform red.
13. **`badge.tsx` gains an `orange` variant** in the same shape as `emerald`/`blue`/`neutral`
    (orange tint fill, `text-brand-action` text, orange border); the `amber` variant is deleted
    once its two decoration consumers (`admin/layout.tsx:55` live pulse, `product-card.tsx:98`
    MOQ) point at it, so nothing keeps using a variant named after a colour that is no longer in
    the brand. `status-badge.tsx` tone map follows: `PAUSED` → red, decoration callers → orange.

## Partner questions from the builder-check round (both answered)

1. ~~How far does "yellow that must go" reach into hardcoded `amber-*` classes?~~
   **Answered (2026-11-06): option C — sweep all ~30 sites, and caution states move to red so the
   warning signal keeps a colour of its own.** Recorded as goal 4 with the per-site split; the
   "adjust `globals.css` only" method is explicitly relaxed for colour classes.
2. ~~What does the review pass run against?~~ **Answered (2026-11-06): dev already has a live
   session.** No seeding step, no rows written by the plan. The verification pass runs against
   the existing local data — the live plate branch, storefront grid, product cards and admin
   KPIs all render for real, which is what makes the palette checkable at all.

## Ruled out by the reviewer (no action)

- The middleware path split is safe as specified — all staff UI lives under `/admin`, and
  `/auth/*` is already outside the matcher.
- `useSessionExpiry` is genuinely admin-only: `order-detail-dialog.tsx` renders a
  `CancelOrderButton` on the customer list, but `orders-list.tsx:46` shows no `cancel` target is
  ever passed there, so the staff redirect cannot reach a customer.

## What stays open for the plan

- Exact oklch values per token (the file uses oklch; the hex numbers here are the targets to
  convert, and light/dark pairs must be generated consistently rather than hand-guessed).
- Whether `STAFF`-role users need a landing better than today's (`admin/layout.tsx` requires
  `role === "OWNER"`, so a STAFF signing in at `/auth/staff` bounces to `/`). Pre-existing
  behaviour — keep it, note it.
- Verification pass: `COREPACK_ENABLE_STRICT=0 yarn run typecheck` as the green gate (never
  `yarn run check` — `next lint` short-circuits on a 28-error baseline), `yarn vitest run` for the
  45 files, then screenshots of `/auth/login`, `/auth/staff`, storefront, admin dashboard, an
  order dialog and `/onboarding` in light and dark, checked against the palette mockups. Dev
  already holds a live session, so the plate's live branch, the countdown cells, product cards and
  KPI tiles all render for real. Also capture the two caution surfaces (an unpaid row in
  `/orders`, the payment callout) and the admin live badge + MOQ badge, since those are the ones
  the amber sweep changes. A `grep -rn "amber-" src` returning nothing is the anti-goal's cheap
  mechanical check.
