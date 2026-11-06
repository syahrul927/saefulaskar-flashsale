# Brand Palette Alignment & Customer-First Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-derive the app's colour system from the supplied logo (orange `#EA580C` / slate `#1F2937`), sweep every surviving brand-yellow class, and split `/auth/login` into a customer page (Google only) plus a new `/auth/staff` route.

**Architecture:** One palette file owns the colours: shadcn semantic tokens in `src/styles/globals.css` are re-derived in light and dark, and the two legacy brand tokens keep their names but change value so the ~20 components that reference them follow for free. The remaining colour decisions are per-class swaps inside components, sorted by what the colour *means* — brand decoration, caution, or merely-pending. Audience separation is a routing change: a pure path→login-page helper in `src/middleware.ts` decides which door a logged-out visitor sees, and the two login pages stop sharing a form.

**Tech Stack:** Next.js 15 App Router, Tailwind v4 (`@theme` / CSS custom properties), shadcn/Base UI components, better-auth (Google OAuth + Jubelio credential login), vitest 5 (node environment — no jsdom; components are imported for pure helpers, and file-content assertions guard the palette), TypeScript 5.8.

**Spec:** `docs/superpowers/specs/2026-11-06-brand-palette-and-customer-first-login-design.md`

**Prerequisite already landed:** `f5d2220 feat(login): brand the login split to the logo's own colours` — the in-flight login work is committed, so this plan's palette diff stands alone.

## Global Constraints

- Every colour pair that carries text must meet WCAG AA (4.5:1 at these sizes). Ratios in this plan were computed 2026-11-06 with an sRGB-relative-luminance script; the hex→oklch conversions are already done — use the literal values given.
- `#EA580C` is a **mark** colour: rules, dots, borders, tints, gradients, large mono digits. Never under white text (3.56:1). Under near-black text it is fine (5.56:1).
- `#C2410C` (`text-brand-action`) is the only orange allowed to sit **under text on paper** (4.68:1 on the `#FFF1E6` tint, 5.18:1 with white text on it).
- `--color-brand-primary-hover` must **lighten** (`#F97316`), never darken: `variant="brand"` is `text-neutral-950` on the fill, and `#C2410C` under near-black text is 3.83:1.
- Legacy yellow dies: no `#FFCC05`, `#EBB800`, `#FF7E33`, and no tailwind `amber-*` class anywhere under `src/`.
- No database changes. Never `pnpm db:push` / `db:migrate`; no schema or migration task exists in this plan.
- Type gate: `COREPACK_ENABLE_STRICT=0 yarn run typecheck` (bare `yarn check` runs yarn 1's builtin and hangs; `yarn run check` cannot exit 0 on this repo's 28-error lint baseline). Tests: `COREPACK_ENABLE_STRICT=0 yarn vitest run`.
- User-facing copy stays Bahasa Indonesia. Buttons keep their existing leading icons — no button is left icon-less.
- Reuse `src/components/ui/*` primitives; add no new component files except the `/auth/staff` page.
- Commit after every task. Message ends with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## Review Focus

The spec implies these; no single task's headline feature exercises them. Each line gets its test in the named task.

1. **A logged-out `/admin` hit must not show a customer page, and a logged-out storefront hit must not show a staff form.** Expected: each audience reaches its own door from a bookmark or an expired session. → Task 7 (`loginPathFor`), Task 8 (in-app redirects).
2. **Sign-out must return the person to the door they can actually use again.** Expected: an admin who signs out lands where they can sign back in, not on a Google-only page. → Task 8.
3. **Caution must not become brand.** After the sweep, an unpaid order or paused session reads red, and nothing that means "act on this" shares orange with the logo. → Task 5.
4. **Orange text must never ship under AA**, including text that was previously amber and text that the token value-swap moves onto paper. → Task 2 and Task 4.
5. **The logo lockup is an opaque-white PNG** — any surface rendering it must be paper/white or it shows a white box. → Task 8 and Task 9 assert the ground; Task 11 confirms in screenshots.

---

## File structure

| File | Role after this plan |
|---|---|
| `src/styles/globals.css` | the only place colours are defined: semantic tokens (light/dark), legacy brand token values, `::selection` |
| `tests/brand-palette.test.ts` | new — pins token values, kills legacy hexes, kills `amber-*`, pins AA text sites |
| `src/components/ui/badge.tsx` | `amber` variant → `orange` (brand tint) |
| `src/app/_components/status-badge.tsx` | `StatusTone` vocabulary: `amber` → `orange`; `PAUSED`/`UNPAID` → `red` |
| `src/app/_components/countdown-timer.tsx` | `paper` tone accent cell becomes brand orange |
| `src/app/_components/product-thumb.tsx`, `product-picker.tsx`, `cart-drawer.tsx`, `product-card.tsx`, `admin/layout.tsx` | decoration + pending sites re-pointed |
| `src/app/_components/filter-pill.tsx`, `payment-panel.tsx`, `orders-list.tsx`, `cancel-order-button.tsx` | caution sites re-pointed to red |
| `src/middleware.ts` | exports `loginPathFor(pathname)` — path → login door |
| `src/app/auth/staff/page.tsx` | new — staff (Jubelio) login |
| `src/app/auth/login/page.tsx` | customer-only: Google, live plate, quiet staff link |
| `src/components/sign-out-button.tsx` | gains `redirectTo` prop |
| `src/app/admin/layout.tsx`, `src/app/_components/use-session-expiry.ts`, `src/app/login/success/page.tsx` | staff doors point at `/auth/staff`; OAuth landing → `/` |
| `src/app/onboarding/page.tsx`, `onboarding-form.tsx`, `src/app/_components/checkout-dialog.tsx` | "default transaction data" notice + WhatsApp labels |

---

## Task 1: Retoken `globals.css`

**Files:**
- Modify: `src/styles/globals.css` (`:root` 18-51, `.dark` 53-85, `@theme inline` 87-142, `::selection` 164-167, header comment 12-17)
- Create: `tests/brand-palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: token values every later task reads — `--color-brand-primary` = `#EA580C`, `--color-brand-primary-hover` = `#F97316`, `--color-brand-secondary` = `#FB923C`, `--color-brand-action` = `#C2410C` (unchanged), `--color-brand-mark`/`--color-brand-ink` unchanged, `--accent`/`--accent-foreground` = the orange tint + `#C2410C`.

- [ ] **Step 1: Write the failing test** — `tests/brand-palette.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// One source of truth: the palette lives in globals.css. This file pins the
// values the brand is made of and kills the previous brand's yellow.
const css = readFileSync("src/styles/globals.css", "utf8");

describe("brand palette", () => {
  it("defines the logo's two colours as the brand tokens", () => {
    expect(css).toMatch(/--color-brand-primary:\s*#EA580C/);
    expect(css).toMatch(/--color-brand-secondary:\s*#FB923C/);
    expect(css).toMatch(/--color-brand-mark:\s*#EA580C/);
    expect(css).toMatch(/--color-brand-ink:\s*#1F2937/);
    expect(css).toMatch(/--color-brand-action:\s*#C2410C/);
  });

  it("hovers the primary brand fill LIGHTER — darkening fails AA under dark text", () => {
    expect(css).toMatch(/--color-brand-primary-hover:\s*#F97316/);
  });

  it("carries no trace of the legacy saefulaskar yellow", () => {
    for (const legacy of ["#FFCC05", "#EBB800", "#FF7E33"]) {
      expect(css).not.toContain(legacy);
    }
  });

  it("leads with wordmark slate, not yellow, in light mode", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
    expect(root).toMatch(/--primary:\s*oklch\(0\.278 0\.030 256\.8\)/);
    expect(root).toMatch(/--foreground:\s*oklch\(0\.278 0\.030 256\.8\)/);
    expect(root).toMatch(/--accent:\s*oklch\(0\.966 0\.021 60\.8\)/);
    expect(root).toMatch(/--accent-foreground:\s*oklch\(0\.553 0\.174 38\.4\)/);
    expect(root).toMatch(/--ring:\s*oklch\(0\.646 0\.194 41\.1\)/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `COREPACK_ENABLE_STRICT=0 yarn vitest run tests/brand-palette.test.ts`
Expected: FAIL — brand tokens still `#FFCC05`/`#EBB800`/`#FF7E33`, `--primary` still yellow.

- [ ] **Step 3: Rewrite `:root`** to these exact values (hex comment kept for the reader). Ink leads; orange is the accent, never the fill.

```
--background: oklch(0.995 0.003 48.7);   /* #FFFDFC paper — the lockup needs a white-ish ground */
--foreground: oklch(0.278 0.030 256.8);  /* #1F2937 wordmark slate */
--card: oklch(1 0 0);                    /* #FFFFFF — brand PNGs are opaque white */
--card-foreground: oklch(0.278 0.030 256.8);
--popover: oklch(1 0 0);
--popover-foreground: oklch(0.278 0.030 256.8);
--primary: oklch(0.278 0.030 256.8);     /* #1F2937 */
--primary-foreground: oklch(1 0 0);      /* 14.68:1 */
--secondary: oklch(0.960 0.007 67.7);    /* #F5F1ED warm neutral */
--secondary-foreground: oklch(0.278 0.030 256.8);
--muted: oklch(0.969 0.005 67.8);        /* #F7F4F1 */
--muted-foreground: oklch(0.530 0.009 73.7); /* #6F6B66 — 5.29:1 on paper */
--accent: oklch(0.966 0.021 60.8);       /* #FFF1E6 orange tint */
--accent-foreground: oklch(0.553 0.174 38.4); /* #C2410C — 4.68:1 on the tint */
--destructive: oklch(0.577 0.245 27.325);      /* unchanged */
--border: oklch(0.931 0.010 67.7);       /* #EDE7E1 */
--input: oklch(0.903 0.010 72.7);        /* #E3DED8 */
--ring: oklch(0.646 0.194 41.1);         /* #EA580C — 3.56:1, passes 3:1 for a non-text indicator */
--chart-1..5: #1F2937, #C2410C, #EA580C, #F97316, #FDBA74 → oklch(0.278 0.030 256.8), oklch(0.553 0.174 38.4), oklch(0.646 0.194 41.1), oklch(0.705 0.187 47.6), oklch(0.837 0.117 66.3)
--sidebar: oklch(0.969 0.005 67.8); --sidebar-foreground: oklch(0.278 0.030 256.8);
--sidebar-primary: oklch(0.278 0.030 256.8); --sidebar-primary-foreground: oklch(1 0 0);
--sidebar-accent: oklch(0.966 0.021 60.8); --sidebar-accent-foreground: oklch(0.553 0.174 38.4);
--sidebar-border: oklch(0.931 0.010 67.7); --sidebar-ring: oklch(0.646 0.194 41.1);
```

`--radius: 0.5rem` and `@theme` fonts stay as they are.

- [ ] **Step 4: Rewrite `.dark`** — the same brand at night; ink-hued canvas, paper-filled primary, orange as the accent.

```
--background: oklch(0.202 0.014 253.2);  /* #12171D */
--foreground: oklch(0.944 0.010 252.8);  /* #E8EDF3 — 15.30:1 */
--card / --popover: oklch(0.249 0.020 254.9); /* #1B222B */
--card-foreground / --popover-foreground: oklch(0.944 0.010 252.8);
--primary: oklch(0.944 0.010 252.8); --primary-foreground: oklch(0.202 0.014 253.2);
--secondary: oklch(0.282 0.022 254.2);  /* #222A34 */ --secondary-foreground: oklch(0.944 0.010 252.8);
--muted: oklch(0.282 0.022 254.2); --muted-foreground: oklch(0.675 0.028 253.6); /* #8B98A8 — 6.14:1 */
--accent: oklch(0.250 0.032 51.2);      /* #2E1D13 */ --accent-foreground: oklch(0.705 0.187 47.6); /* #F97316 — 5.76:1 */
--destructive: oklch(0.704 0.191 22.216); /* unchanged */
--border: oklch(1 0 0 / 10%); --input: oklch(1 0 0 / 15%);
--ring: oklch(0.705 0.187 47.6);        /* #F97316 */
--chart-1..5: #F97316, #FDBA74, #FB923C, #E8EDF3, #8B98A8 (same oklch strings as Step 3 where they overlap)
--sidebar: oklch(0.249 0.020 254.9); --sidebar-foreground: oklch(0.944 0.010 252.8);
--sidebar-primary: oklch(0.705 0.187 47.6); --sidebar-primary-foreground: oklch(0.278 0.030 256.8);
--sidebar-accent: oklch(0.250 0.032 51.2); --sidebar-accent-foreground: oklch(0.705 0.187 47.6);
--sidebar-border: oklch(1 0 0 / 10%); --sidebar-ring: oklch(0.705 0.187 47.6);
```

- [ ] **Step 5: Update `@theme inline` brand values and `::selection`, then the header comment.**

```
--color-brand-primary: #EA580C;
--color-brand-primary-hover: #F97316;
--color-brand-secondary: #FB923C;
```
`--color-brand-mark/-ink/-action/-action-hover` stay. `::selection` becomes `background: oklch(0.837 0.117 66.3)` (`#FDBA74`) with `color: oklch(0.278 0.030 256.8)` (8.70:1). Rewrite the block comment at lines 12-17, which still advertises "ink + yellow accent (saefulaskar.com yellow #FFCC05)", to describe slate-ink-led + orange-mark accent, and re-point each token's trailing comment at its new meaning so the file stops lying.

- [ ] **Step 6: Run the test to verify it passes**, then the type gate.

Run: `COREPACK_ENABLE_STRICT=0 yarn vitest run tests/brand-palette.test.ts && COREPACK_ENABLE_STRICT=0 yarn run typecheck`
Expected: test PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/styles/globals.css tests/brand-palette.test.ts
git commit -m "feat(palette): re-derive tokens from the logo's orange and slate"
```

---

## Task 2: AA-fix the orange text sites

**Files:**
- Modify: `src/app/_components/product-card.tsx:138`, `src/app/_components/cart-drawer.tsx:249`, `src/app/_components/kpi-tiles.tsx:116`, `src/app/admin/page.tsx:164`
- Modify: `tests/brand-palette.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `--color-brand-action`.
- Produces: the rule later tasks copy — small text on paper that wants brand orange is always `text-brand-action`.

- [ ] **Step 1: Write the failing test** — append to `tests/brand-palette.test.ts`

```ts
describe("brand orange as text", () => {
  // #EA580C / #FB923C on paper is 3.56:1 / ~2.3:1 — a mark colour must never
  // become a label. These four sites are the token-only cases the value-swap
  // in globals.css cannot fix, so they are pinned here.
  const paperTextSites = [
    "src/app/_components/product-card.tsx",
    "src/app/_components/cart-drawer.tsx",
    "src/app/_components/kpi-tiles.tsx",
    "src/app/admin/page.tsx",
  ];

  it("never paints small text with the mark colours", () => {
    for (const file of paperTextSites) {
      // The lookbehind keeps a *sanctioned* `dark:text-brand-primary` companion
      // from tripping a rule about light-mode paper text.
      expect(readFileSync(file, "utf8")).not.toMatch(/(?<!dark:)text-brand-(primary|secondary|mark)\b/);
    }
  });
});
```

- [ ] **Step 2: Run it** — `COREPACK_ENABLE_STRICT=0 yarn vitest run tests/brand-palette.test.ts`
  Expected: FAIL (all four still use `text-brand-secondary` / `text-brand-primary`).

- [ ] **Step 3: Swap each of the four** to `text-brand-action`, changing nothing else on the element. `kpi-tiles.tsx:116` is a `valueClassName` prop and `admin/page.tsx:164` a conditional class — same string swap in both.

- [ ] **Step 4: Run test + typecheck.** Expected: PASS, 0 errors.

- [ ] **Step 5: Commit** `fix(palette): keep brand orange off small text so it holds AA`

---

## Task 3: Status tone vocabulary — `orange` for brand, `red` for caution

**Files:**
- Modify: `src/components/ui/badge.tsx:21-22`
- Modify: `src/app/_components/status-badge.tsx:6,13,32,58`
- Modify: `src/app/admin/layout.tsx:55`, `src/app/_components/product-card.tsx:98`
- Modify: `tests/status-badge.test.ts`

**Interfaces:**
- Consumes: Task 1's tint + `brand-action`.
- Produces: `StatusTone = "orange" | "emerald" | "blue" | "neutral" | "red"` (no `amber`), badge `orange` variant, and the tone map Tasks 4-6 rely on.

**Deviation from spec builder call #12 — flag at review.** The spec said `UNPAID` could stay a neutral chip in the *storefront* list while caution went red. This plan sets `UNPAID → "red"` in the one shared `ORDER_STATUS_TONES` map instead, because `status-badge.tsx` is the single source of the tone (that is what makes the badge and the filter pill agree, per the glossary comment at `:17-23`) and a per-surface override would reintroduce exactly the drift that comment exists to prevent. Cost: an unpaid row reads red on the customer's own order list, not neutral. The "merely pending" tier is not lost — it lives in the picker's dirty/pending-sync cells, which go neutral in Task 6. If the partner wants the storefront exception, implement it as an optional `tone` override prop on the customer `OrdersList` call site and drop the `UNPAID` line from this task's test.

- [ ] **Step 1: Write the failing test** — in `tests/status-badge.test.ts`, change the two existing assertions `sessionStatusTone("PAUSED")` (`:26`) and `orderStatusTone("UNPAID")` (`:34`) from `"amber"` to `"red"`, add `TONE_TO_BADGE_VARIANT` to the import from `@/app/_components/status-badge`, and append:

```ts
describe("status tones after the brand sweep", () => {
  // `amber` was both the old brand colour and the warning colour. It leaves the
  // vocabulary entirely: `orange` is brand decoration, `red` is caution.
  it("has no amber tone left to render", () => {
    expect(TONE_TO_BADGE_VARIANT).not.toHaveProperty("amber");
    expect(TONE_TO_BADGE_VARIANT).toMatchObject({ orange: "orange", red: "destructive" });
  });

  it("keeps the pulse on live states", () => {
    expect(isPulseStatus("ACTIVE")).toBe(true);
    expect(isPulseStatus("UNPAID")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it** — `COREPACK_ENABLE_STRICT=0 yarn vitest run tests/status-badge.test.ts` → FAIL.

- [ ] **Step 3: Make the edits.**
  - `badge.tsx`: rename variant key `amber` → `orange`; value becomes `"rounded-full border border-brand-primary/30 bg-brand-primary/10 font-mono text-[10px] font-bold text-brand-action"` (`#C2410C` on a 10% orange tint over paper ≈ 4.6:1 — the same pair Task 1 set for `--accent-foreground`).
  - `status-badge.tsx`: `StatusTone` union `"amber"` → `"orange"`; `SESSION_STATUS_TONES.PAUSED` → `"red"`; `ORDER_STATUS_TONES.UNPAID` → `"red"`; `TONE_TO_BADGE_VARIANT.orange: "orange"` (the `red` entry already maps to `destructive`).
  - Callers: `admin/layout.tsx:55` and `product-card.tsx:98` (MOQ) pass `tone="orange"` — both are brand decoration, not status.
  - Add `TONE_TO_BADGE_VARIANT` to the export block at `status-badge.tsx:88-95` so the test can read it.
  - Update the doc comments that name amber (`status-badge.tsx:52`, `badge.tsx:21-22`; `filter-pill.tsx:9-11` is handled in Task 5).

- [ ] **Step 4: Run test + typecheck.** Typecheck is the real guard here: `StatusTone` and the `satisfies Record<…>` clauses must reject any leftover `"amber"` with a compile error. Verified 2026-11-06: the only `tone="amber"` call sites in `src/` are `admin/layout.tsx:55` and `product-card.tsx:98`, and no file passes `variant="amber"` to `Badge` directly — so those two plus the tone map are the whole consumer set.

- [ ] **Step 5: Commit** `refactor(ui): status tones become orange (brand) and red (caution)`

---

## Task 4: Amber sweep — brand decoration

**Files:**
- Modify: `src/app/_components/countdown-timer.tsx:48`
- Modify: `src/app/_components/product-thumb.tsx:35`
- Modify: `src/app/_components/product-picker.tsx:156,205,207,240,242`
- Modify: `src/app/_components/cart-drawer.tsx:183`
- Modify: `src/app/_components/storefront-header.tsx:71` (added by Task 2's report: the active-tab icon is a **state indicator**, and `#FB923C` on paper is ~2.3:1 — under the 3:1 WCAG bar for non-text. → `text-brand-action`.)
- Modify: `tests/brand-palette.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 tokens; Task 3's `orange` badge tone.
- Produces: the decoration recipe other tasks reuse — tint fill + `text-brand-action` text.

- [ ] **Step 1: Write the failing test** — append to `tests/brand-palette.test.ts`

`product-picker.tsx` is shared with Task 6 (which owns 4 of its 9 amber sites), so this task cannot assert that file is amber-free — it asserts only the decoration forms it owns. Task 6 closes the file out completely.

```ts
describe("brand decoration no longer uses the old yellow scale", () => {
  // Files this task owns outright — every amber site in them is decoration.
  const owned = [
    "src/app/_components/countdown-timer.tsx",
    "src/app/_components/product-thumb.tsx",
    "src/app/_components/cart-drawer.tsx",
    "src/app/_components/storefront-header.tsx",
  ];

  it("paints the paper countdown, placeholder tiles and the MOQ line in brand orange", () => {
    for (const file of owned) {
      expect(readFileSync(file, "utf8")).not.toMatch(/amber-/);
    }
    expect(readFileSync("src/app/_components/countdown-timer.tsx", "utf8")).toMatch(
      /accent:\s*"border-brand-mark\/30 bg-brand-primary\/10 text-brand-action"/,
    );
  });

  it("re-points the picker's placeholder gradient and special-cell tint, leaving Task 6's sites", () => {
    const picker = readFileSync("src/app/_components/product-picker.tsx", "utf8");
    expect(picker).not.toMatch(/from-amber-50/); // :205, :240 thumb gradients
    expect(picker).not.toMatch(/border-amber-200 bg-amber-50 px-2/); // :156 cellInput
    expect(picker).not.toMatch(/text-amber-700/); // :207, :242 initial letters
  });
});
```

- [ ] **Step 2: Run it** → FAIL on every `amber-` hit.

- [ ] **Step 3: Swap, one recipe for all of them.** Fills/tints/borders use `brand-primary`/`brand-mark` with alpha; any text uses `text-brand-action`.

| site | becomes |
|---|---|
| `countdown-timer.tsx:48` `paper.accent` | `border-brand-mark/30 bg-brand-primary/10 text-brand-action` (mirrors the `ink` tone at `:54`, so one device speaks one colour) |
| `product-thumb.tsx:35` tile | `bg-gradient-to-br from-brand-primary/10 to-brand-secondary/15` + `text-brand-action` — **`/15`, not `/25`**: at `/25` the composited ground under the centred letter is ≈4.35:1 and `#C2410C` needs 4.5:1 at these sizes (Task 4 review, measured at the gradient midpoint) |
| `product-picker.tsx:205,240` thumbs | same gradient pair (`/10` → `/15`), letters `text-brand-action` |
| `product-picker.tsx:156` `cellInputAmberClass` | `border-brand-primary/30 bg-brand-primary/10 … text-brand-action`, `focus:border-brand-mark` kept |
| `cart-drawer.tsx:183` "Min. pesan" | `text-brand-action` (9px text — the mark colours cannot carry it) |
| `storefront-header.tsx:71` active-tab icon | `text-brand-action` — a state indicator needs 3:1 for non-text, `#FB923C` on paper is ~2.3:1 |

- [ ] **Step 4: Run test + typecheck.** Expected: PASS.

- [ ] **Step 5: Commit** `fix(palette): brand decoration moves from amber to logo orange`

---

## Task 4b: Cart tile ground so the fallback letter holds AA

Found by Task 4's fix-round re-review, after Task 4 was already approved: the `/15`
gradient composites over whatever ground the caller's frame paints, and the two
`ProductThumb` call sites differ.

| call site | frame ground | letter size | glyph ratio | verdict |
|---|---|---|---|---|
| `product-card.tsx:83` | `bg-neutral-100` (#F5F5F5) | default `text-5xl` (48px) | ≈4.2:1, large-text bar 3:1 | passes |
| `cart-drawer.tsx:168` | `bg-neutral-100` (#F5F5F5) | `letterClass="text-lg"` (18px `font-black`) | ≈4.23:1, bar 4.5:1 | **fails** |

`text-lg` is 18px, under the 18.66px (14pt) bold large-text exemption, so this one
glyph needs 4.5:1 and does not get it. The picker's own tiles are unaffected — their
`bg-neutral-100` lives on the `<img>` branch (`product-picker.tsx:200`, `:235`), a
photo-loading backdrop with no text, while the tile branch paints its gradient
straight on the row ground (paper #FFFDFC → 4.59:1).

The fix is the **ground**, not the type: `text-*` size, weight and the mandated `/15`
gradient all stay. The row this tile sits in already writes `bg-white dark:bg-card`,
so the frame takes the semantic pair rather than a bare `bg-white` that would flash
white on an ink card.

**Files:**
- Modify: `src/app/_components/product-picker.tsx:1556` — the dead `hover:bg-muted`
- Modify: `src/app/_components/cart-drawer.tsx:168` — on that one frame div,
  `bg-neutral-100` → `bg-background dark:bg-card`. Leave `:210`'s `bg-neutral-100`
  (an icon-button holder, no brand text) and every other file's `bg-neutral-100`
  alone — this is not a repo-wide grey sweep.
- Modify: `tests/brand-palette.test.ts` (append to the `brand decoration no longer
  uses the old yellow scale` describe — Task 4 owns that block and is finished, so
  this is the only remaining edit that file takes)

- [ ] **Step 1: Write the failing test.** The pin has to target the frame, because
  `bg-neutral-100` appears elsewhere in the same file:

```ts
it("grounds the cart tile so its fallback letter clears 4.5:1", () => {
  const cart = readFileSync("src/app/_components/cart-drawer.tsx", "utf8");
  const frame = /overflow-hidden rounded-lg border border-neutral-200\/80[^"]*"/;
  expect(cart).toMatch(frame);
  expect(cart.match(frame)![0]).not.toContain("bg-neutral-100");
  expect(cart.match(frame)![0]).toContain("bg-background dark:bg-card");
});
```

- [ ] **Step 2: Run it** → FAIL (the frame still says `bg-neutral-100`).
- [ ] **Step 3: Swap the class** at `cart-drawer.tsx:168`, and correct the frame's
  two-line comment above it (`:166-167`) if it implies a grey recess.
- [ ] **Step 4:** `COREPACK_ENABLE_STRICT=0 yarn vitest run && COREPACK_ENABLE_STRICT=0 yarn run typecheck` → pass, 0 errors.
- [ ] **Step 5: Commit** `fix(palette): cart tile frame goes paper so its fallback letter holds AA`

**Also in this task — two findings from Task 6's review, batched here because this is
the only dispatch left that touches `tests/brand-palette.test.ts`:**

- `product-picker.tsx:1556` — `hover:bg-muted` is a **dead hover**. `--secondary` is
  `#F5F1ED` and `--muted` is `#F7F4F1` (one point of lightness, `globals.css:31,33`),
  and under `.dark` the two tokens are literally the same value (`oklch(0.282 0.022
  254.2)` at `:66` and `:68`), so the `+ Tambah` affordance shows no response at all in
  dark. Replace it with `hover:bg-neutral-200 dark:hover:bg-neutral-700` — the precedent
  `copy-chip.tsx:43` already sets — and leave the rest of the string alone. Ink
  `text-secondary-foreground` on `#E5E5E5` is ≈11:1. This **supersedes** the class
  Task 6's brief mandated verbatim: the implementer had no latitude there, the plan did.
- Widen the guard in `tests/brand-palette.test.ts`: the walk matches only `/amber-/g`
  over `.ts`/`.tsx`, so the old brand returns as `yellow-400` or an `@apply amber-…` in a
  stylesheet and the suite stays green — the anti-goal is "yellow surviving anywhere as a
  brand colour", not "no `amber-` token". Take `/amber-|yellow-/g` and add `.css` to the
  extension list. Both are **green on arrival** (`grep -rn "yellow-" src` → 0; no amber
  in `src/**/*.css`), so name them as regression guards, not TDD drivers — Task 5's
  `storefront-header` pin set that wording precedent.

Not changed, ruled deliberately: `walk` uses `e.isDirectory()`, which skips symlinked
directories (latent — nothing under `src` is a symlink), and `expect(hits).toEqual([])`
already names the offending file, which is what a future regressor needs.

Deferred, not fixed here: `product-card.tsx:83` keeps `bg-neutral-100` because its
48px letter qualifies as large text (3:1 bar). If the whole system should agree on a
paper ground for tile frames, that is a two-line change the final review may rule on
— no accessibility requirement compels it today.

---

## Task 5: Amber sweep — caution becomes red

**Files:**
- Modify: `src/app/_components/filter-pill.tsx:9-11,44,50,51,62`
- Modify: `src/app/_components/payment-panel.tsx:288,292,294`
- Modify: `src/app/_components/orders-list.tsx:150,207,209,226`
- Modify: `src/app/_components/cancel-order-button.tsx:54`
- Modify: `src/app/_components/session-list-filter.tsx:12` (doc comment only — found by Task 3: it still says "amber is the orders unpaid signal", which is false after Task 3 moved `UNPAID` to red. One sentence, no code.)
- Modify: `src/app/_components/storefront-header.tsx:106-107` (doc comment only — "brand-yellow rail button" while the code reads `variant="brand"` on `bg-brand-secondary`; found by Task 4)
- Modify: `tests/brand-palette.test.ts` (append, **and one amendment to the existing Task 2 block**): the `describe("brand orange as text")` scan becomes `/(?<!dark:)text-brand-(primary|secondary|mark)\b/` (plan amendment `e7579db`), and this task's appended block also covers `storefront-header.tsx` — asserting it now carries `text-brand-action` and no light `text-brand-secondary`, because Task 4's icon swap has no other guard (that file never contained `amber-`, so an absence-of-amber assertion there is vacuous).

**Interfaces:**
- Consumes: Task 3's tone map (`UNPAID`/`PAUSED` already render red through `destructive`).
- Produces: the caution recipe — `border-red-200 bg-red-100 text-red-700` (5.30:1), dark companions `dark:border-red-900 dark:bg-red-950/40 dark:text-red-300`, matching the `failed` branch already in `product-picker.tsx:475`.

- [ ] **Step 1: Write the failing test** — append to `tests/brand-palette.test.ts`

```ts
describe("caution stays out of the brand colour", () => {
  const caution = [
    "src/app/_components/filter-pill.tsx",
    "src/app/_components/payment-panel.tsx",
    "src/app/_components/orders-list.tsx",
    "src/app/_components/cancel-order-button.tsx",
  ];

  it("reads unpaid/awaiting states as red, never amber or brand orange", () => {
    for (const file of caution) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/amber-/);
      expect(src).not.toMatch(/(?<!dark:)text-brand-(primary|secondary|mark)\b/);
    }
    expect(readFileSync("src/app/_components/filter-pill.tsx", "utf8")).toMatch(/bg-red-500/);
  });
});
```

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Swap.** The unpaid emphasis pill (`filter-pill.tsx:44`), its ping dot and count dot (`:50`,`:51`), and the count chip (`:62` → `bg-red-500 text-neutral-950`, 5.26:1); the two awaiting-payment callouts (`payment-panel.tsx:288-294`, `orders-list.tsx:207-226`), the flagged-row tint (`orders-list.tsx:150`), and the cancel-confirm tone (`cancel-order-button.tsx:54`). Fix the `filter-pill.tsx:9-11` doc comment that documents "amber-400 count chip" and "amber tint on the pill" while it is edited.

- [ ] **Step 4: Run test + typecheck.** Expected: PASS.

- [ ] **Step 5: Commit** `fix(palette): caution states move from amber to red`

---

## Task 6: Amber sweep — pending becomes neutral, and the guard closes

**Files:**
- Modify: `src/app/_components/product-picker.tsx:477,505,1556,1682` (line numbers re-measured after Task 4's two comment lines shifted the file by +2; locate by string regardless)
- Modify: `src/app/_components/product-picker.tsx:469` — the `/** Amber "belum disimpan" marker … */` doc comment must be restated once the marker is neutral (a stale colour comment counts as a defect here)
- Modify: `src/app/_components/product-picker.tsx:495` (`Row background treatment: amber tint while a draft is unsaved, …`) and `:580` (`/** Row has unsaved edits (amber) or failed the last flush (red). */`) — same defect. The `amber-` guard regex needs the hyphen, so prose like this can never fail the test; the only defence is restating it. All three comments describe the *same* two chips and must read "neutral"/"muted" once the swap lands.
- Modify: `src/app/_components/product-card.tsx:37` — `aspect-square amber letter-tile frame (Task 7 RosterThumb treatment …)` is stale since Task 4 swept the thumb gradient to brand orange. Same defect class as the picker comments; no scan can catch it.
- Modify: `tests/brand-palette.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: repo-wide `amber-` absence, asserted once and forever.

- [ ] **Step 1: Write the failing test** — append to `tests/brand-palette.test.ts`

```ts
import { readdirSync } from "node:fs";

describe("no old-brand yellow survives in components", () => {
  it("leaves zero amber-* classes under src/", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(`${dir}/${e.name}`)
          : /\.(tsx|ts)$/.test(e.name)
            ? [`${dir}/${e.name}`]
            : [],
      );
    const hits = walk("src")
      .map((f) => ({ f, m: readFileSync(f, "utf8").match(/amber-/g) }))
      .filter((x) => x.m);
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it** → FAIL, listing `product-picker.tsx`.

- [ ] **Step 3: Swap the four pending/dirty sites to neutral ink**, because "not saved yet" is neither danger nor brand: `DirtyChip`'s not-failed branch (`:477`) and the footer count chip (`:1682`) → `border-border bg-muted text-muted-foreground` (5.29:1); the dirty row tint (`:505`) → `bg-muted/60`; the `+ Tambah` affordance (`:1556`) → `border-border bg-secondary text-secondary-foreground hover:bg-muted`. Then restate the `:469` comment.

- [ ] **Step 4: Run the whole file and the suite.**

Run: `COREPACK_ENABLE_STRICT=0 yarn vitest run && COREPACK_ENABLE_STRICT=0 yarn run typecheck`
Expected: 329+ tests pass (7 pre-existing `.claude/skills` glob failures are known baseline), typecheck 0 errors.

- [ ] **Step 5: Commit** `fix(palette): unsaved-draft states go neutral; amber is gone from src`

---

## Task 7: One path → one login door

**Files:**
- Modify: `src/middleware.ts` (helper above `middleware`, `:50`)
- Create: `tests/middleware-staff-path.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loginPathFor(pathname: string): string` — exported, used by `middleware()` in this task and reusable by any later server-side guard. Returns `"/auth/staff"` for `/admin` and anything under it, `"/auth/login"` for everything else.

- [ ] **Step 1: Write the failing test** — `tests/middleware-staff-path.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { loginPathFor } from "@/middleware";

// Middleware can only see a cookie's presence, never a role, so the audience
// split has to be made on the path the visitor asked for.
describe("loginPathFor", () => {
  it("sends staff surfaces to the staff door", () => {
    expect(loginPathFor("/admin")).toBe("/auth/staff");
    expect(loginPathFor("/admin/orders")).toBe("/auth/staff");
    expect(loginPathFor("/admin/jubelio")).toBe("/auth/staff");
  });

  it("sends customer surfaces to the customer door", () => {
    expect(loginPathFor("/orders")).toBe("/auth/login");
    expect(loginPathFor("/onboarding")).toBe("/auth/login");
  });

  it("does not mistake a customer path that merely contains the word", () => {
    expect(loginPathFor("/administrator-guide")).toBe("/auth/login");
    expect(loginPathFor("/orders/admin-notes")).toBe("/auth/login");
  });
});
```

- [ ] **Step 2: Run it** → FAIL (`loginPathFor` is not exported).

- [ ] **Step 3: Implement `loginPathFor(pathname: string): string` in `src/middleware.ts`** — match `/admin` exactly or with a following `/` (not `startsWith("/admin")` alone, which the third test pins), and use it at the redirect: `new URL(loginPathFor(request.nextUrl.pathname), request.url)`. Extend the guard's doc comment to say the two doors exist and why the decision is path-based.

- [ ] **Step 4: Run test + the existing middleware test + typecheck.**

Run: `COREPACK_ENABLE_STRICT=0 yarn vitest run tests/middleware-staff-path.test.ts tests/middleware-session-cookie.test.ts && COREPACK_ENABLE_STRICT=0 yarn run typecheck`
Expected: both PASS, 0 errors.

- [ ] **Step 5: Commit** `feat(auth): path-based login door for staff vs customer`

---

## Task 8: `/auth/staff` and the in-app staff redirects

**Files:**
- Create: `src/app/auth/staff/page.tsx`
- Modify: `src/components/auth-form.tsx` (no shape change — new home only), `src/app/admin/layout.tsx:30,73`, `src/app/_components/use-session-expiry.ts:23`, `src/components/sign-out-button.tsx:11,25`, `src/app/login/success/page.tsx:21`
- Create: `tests/login-audience-split.test.ts`

**Interfaces:**
- Consumes: Task 7's `/auth/staff` target must exist before Task 9 links to it.
- Produces: `SignOutButton({ className?: string; redirectTo?: string })` with default `"/"`; the staff page's heading text "Masuk sebagai staf".

- [ ] **Step 1: Write the failing test** — `tests/login-audience-split.test.ts`

This file covers the **staff side only**. The customer-page assertions (`/auth/login` must lose `AuthForm`) are appended here by Task 9, which is the task that removes it — a task's test cannot go green on work a later task has not done yet.

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const staff = readFileSync("src/app/auth/staff/page.tsx", "utf8");

describe("login audiences stay separated", () => {
  it("puts the Jubelio form on the staff page, on a white ground", () => {
    expect(staff).toMatch(/AuthForm/);
    expect(staff).toMatch(/logo-lockup\.png/);
    expect(staff).toMatch(/bg-background/); // paper: the lockup export is opaque white
    expect(staff).toMatch(/\/auth\/login/);
  });

  it("points every staff door at the staff page", () => {
    expect(readFileSync("src/app/admin/layout.tsx", "utf8")).toMatch(/redirect\("\/auth\/staff"\)/);
    expect(readFileSync("src/app/_components/use-session-expiry.ts", "utf8")).toMatch(
      /"\/auth\/staff"/,
    );
  });

  it("sends a live session arriving at the old OAuth landing straight to the storefront", () => {
    const success = readFileSync("src/app/login/success/page.tsx", "utf8");
    expect(success).toMatch(/redirect\("\/"\)/); // the spec's "live session → /"
    // ...and keeps the customer door for the no-session case: this is a
    // customer-facing guard, which the spec says stays on /auth/login.
    expect(success).toMatch(/redirect\("\/auth\/login"\)/);
  });

  it("returns a signed-out admin to the door they can use again", () => {
    expect(readFileSync("src/components/sign-out-button.tsx", "utf8")).toMatch(
      /redirectTo = "\/"/,
    );
    expect(readFileSync("src/app/admin/layout.tsx", "utf8")).toMatch(/redirectTo="\/auth\/staff"/);
  });
});
```

- [ ] **Step 2: Run it** → FAIL (no staff page; redirects still `/auth/login`).

- [ ] **Step 3: Create `src/app/auth/staff/page.tsx`** — an async-free server component: `export const metadata = { title: "Masuk sebagai staf — Flash Sale Grosir" }`, `<main className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10">`, a `max-w-sm` column holding the `<img src="/brand/logo-lockup.png" alt="Flash Sale Grosir" className="w-40" />`, `h1` "Masuk sebagai staf", sub-line "Pakai email dan password akun Jubelio kamu.", `<AuthForm />`, and a quiet `Link href="/auth/login"` reading "Bukan staf? Masuk dengan Google". No countdown plate. Same heading/sub typography as the current customer page (`font-heading text-2xl md:text-3xl`, `text-sm text-neutral-600 dark:text-neutral-400`).

- [ ] **Step 4: Move the staff doors.** `admin/layout.tsx:30` → `redirect("/auth/staff")`; `use-session-expiry.ts:23` → `router.push("/auth/staff")`.

- [ ] **Step 4b: Turn `login/success/page.tsx` into a redirect shim.** Read the file before editing: its line 21 is the **no-session** branch (`if (!session) redirect("/auth/login")`), and the "Login Berhasil" card renders only when a session *does* exist. The spec's sentence is *"`/login/success` sends a live session to `/`"*, so the change is an inversion, not a string swap: add `redirect("/")` for the live-session case and **keep** `redirect("/auth/login")` for the no-session case (a customer-facing guard, which the spec says keeps pointing at the customer door). That makes the card, its `Card*` imports, its `<SignOutButton />` and its `metadata` unreachable — delete them, so the page is `getSession()` + two guards and never returns JSX. Nothing in the repo links to this URL (`grep -rn "login/success" src tests` finds no producer; Google OAuth lands on `/onboarding`), so it is reachable only from an old bookmark, and no test or screen depends on the card.

- [ ] **Step 5: Give `SignOutButton` its `redirectTo` prop** — `function SignOutButton({ className, redirectTo = "/" }: { className?: string; redirectTo?: string })`, `router.push(redirectTo)`; `admin/layout.tsx:73` passes `redirectTo="/auth/staff"`; `/login/success` keeps the default. Update the hook's/file's comments that claim sign-out "returns to login".

- [ ] **Step 6: Run test + typecheck.** Expected: PASS, 0 errors.

- [ ] **Step 7: Commit** `feat(auth): staff login at /auth/staff, staff doors point there`

---

## Task 9: Customer login page — Google is the whole page

**Files:**
- Modify: `src/app/auth/login/page.tsx` (headline/sub/Form block 72-95, staff link, plate copy 141-155, metadata 9)

**Interfaces:**
- Consumes: Task 8's `/auth/staff`; Task 1's `bg-brand-ink` / `brand-mark` plate tokens (already in use).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test** — append to `tests/login-audience-split.test.ts` (the staff-side block already there is Task 8's and should still pass):

```ts
const login = readFileSync("src/app/auth/login/page.tsx", "utf8");

describe("customer page is Google-only", () => {
  it("keeps the Jubelio form off the customer page", () => {
    expect(login).not.toMatch(/AuthForm/);
    expect(login).toMatch(/GoogleSignInButton/);
    expect(login).toMatch(/\/auth\/staff/); // the quiet staff link
  });

  it("keeps the lockup on a white ground", () => {
    // logo-lockup.png is an opaque white export — a dark panel shows a white box
    expect(login).toMatch(/bg-background|bg-white|bg-card/);
  });
});
```

Run: `COREPACK_ENABLE_STRICT=0 yarn vitest run tests/login-audience-split.test.ts`
Expected: FAIL — `login` still matches `/AuthForm/`.

- [ ] **Step 2: Rewrite the form panel** — drop the `AuthForm` import and usage; `h1` becomes "Masuk untuk belanja"; sub-line becomes one sentence saying only that a Google account is needed (no new password, no registration form); `<GoogleSignInButton />` sits immediately under it at full width; below everything, the quiet `Link href="/auth/staff"` "Masuk sebagai staf". Delete the old "Pelanggan? Masuk dengan Google…" divider copy and the "Butuh akses? Hubungi admin." line — both are superseded.

- [ ] **Step 3: Add the unconfigured fallback.** Read `env.GOOGLE_CLIENT_ID`/`env.GOOGLE_CLIENT_SECRET` in this server component; when either is missing render a short Bahasa line (e.g. "Pendaftaran lewat Google belum dibuka. Hubungi toko untuk akses belanja.") in place of the button, keep the staff link, and `console.warn` once with the missing variable names. Import `env` from `@/env`.

- [ ] **Step 4: Flip the plate copy to buyer talk.** Keep the live dot, the `Sesi berakhir dalam` label, `CountdownTimer variant="boxed" tone="ink" size="lg"` and the session name. Replace the no-session branch's owner instruction ("Buat dan aktifkan sesi baru begitu kamu masuk ke dasbor") with buyer copy — heading like "Belum ada sale yang berjalan", one line saying to check back or ask the store on WhatsApp. Keep the closing line about wholesale price and limited quota; do not promise a discount that is not live.

- [ ] **Step 5: Update `metadata.title`** to "Masuk — Flash Sale Grosir" (it currently says "Masuk" already — confirm no dasbor wording survives anywhere in the file), and rewrite the file's long header doc comment, which still describes the page as the owner's dashboard door with the Jubelio form as its subject.

- [ ] **Step 6: Run test + typecheck + full suite.**

Run: `COREPACK_ENABLE_STRICT=0 yarn vitest run && COREPACK_ENABLE_STRICT=0 yarn run typecheck`
Expected: `login-audience-split` PASS, 0 type errors.

- [ ] **Step 7: Commit** `feat(login): customer page leads with Google`

---

## Task 10: Onboarding says what the data is for; WhatsApp gets named

**Files:**
- Modify: `src/app/onboarding/page.tsx:38-39`
- Modify: `src/app/onboarding/onboarding-form.tsx:97`
- Modify: `src/app/_components/checkout-dialog.tsx:100-101,218`
- Create: `tests/transactional-labels.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: label strings the verification screenshots are read against.

- [ ] **Step 1: Write the failing test** — `tests/transactional-labels.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The phone number IS the WhatsApp number, and onboarding data is the default
// every order starts from. Both facts have to be on screen, not in a guide.
describe("transactional data is explained where it is entered", () => {
  it("names the default-order purpose on the onboarding page", () => {
    const page = readFileSync("src/app/onboarding/page.tsx", "utf8");
    expect(page).toMatch(/default/i);
    expect(page).not.toMatch(/Kami butuh beberapa data untuk mendaftarkan/);
  });

  it("repeats it above the submit button", () => {
    expect(readFileSync("src/app/onboarding/onboarding-form.tsx", "utf8")).toMatch(
      /tiap checkout|setiap pesanan/,
    );
  });

  it("calls the number WhatsApp in onboarding and checkout", () => {
    for (const f of ["src/app/onboarding/onboarding-form.tsx", "src/app/_components/checkout-dialog.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/WhatsApp/);
      expect(src).not.toMatch(/No\. Telf|No\. Telepon/);
    }
  });
});
```

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Onboarding page sub-line** (`page.tsx:38-39`) becomes one Bahasa sentence carrying the purpose: the data is the default for every order — ship address, PIC, WhatsApp — and can still be changed per order at checkout.

- [ ] **Step 4: Form changes** — `onboarding-form.tsx:97` label → `No. WhatsApp`; immediately above the submit `<Button>` add a light note (`text-xs text-muted-foreground leading-relaxed`) repeating that the data fills in automatically at every checkout and can be changed there.

- [ ] **Step 5: Checkout label** — `checkout-dialog.tsx:218` → `No. WhatsApp`; validation message at `:100-101` (`"No. telepon minimal 6 karakter."`) → `"Nomor WhatsApp minimal 6 karakter."`. Field order, limits and payload keys do not change.

- [ ] **Step 6: Run test + typecheck + suite.** Expected: PASS.

- [ ] **Step 7: Commit** `feat(onboarding): state that profile data is the order default`

---

## Task 11: Verification pass

**Files:** none (no commit of code; screenshots land in `.playwright-mcp/` or are attached to the PR/summary).

**Interfaces:**
- Consumes: all tasks.
- Produces: the visual sign-off the spec's anti-goals need.

- [ ] **Step 1: Mechanical gates.**

Run: `COREPACK_ENABLE_STRICT=0 yarn run typecheck && COREPACK_ENABLE_STRICT=0 yarn vitest run && grep -rn "amber-\|#FFCC05\|#EBB800\|#FF7E33" src | wc -l`
Expected: typecheck 0 errors, suite green, the grep count is `0`.

- [ ] **Step 2: Start the dev server** — `COREPACK_ENABLE_STRICT=0 yarn run dev` (background). Dev DB already holds a live session, so the live plate, product cards and KPIs render for real.

- [ ] **Step 3: Screenshot these surfaces in light**, via chrome-devtools or playwright MCP: `/auth/login` (signed out), `/auth/staff`, `/` storefront with the countdown and a product card showing "sisa" + progress bar **plus its MOQ badge**, `/orders` with an unpaid row (red, not amber) and its "Belum dibayar" filter pill, the payment callout (`payment-panel`) and the order-detail dialog, `/admin` dashboard (KPI tiles + the live "JUBELIO SYNC" badge), `/onboarding`. Compare against `.superpowers/brainstorm/37063-1793935724/content/palette-primary.html` option B.

- [ ] **Step 3b: Confirm the two things this plan deliberately does not change.** The four `variant="brand"` payment CTAs keep their orange fill with near-black text (5.56:1) — spec builder call #1, so flag it as a regression if you see them go slate. And a `STAFF`-role account signing in at `/auth/staff` still bounces to `/` (`admin/layout.tsx` requires `role === "OWNER"`) — pre-existing behaviour, kept, worth one line in the report.

- [ ] **Step 4: Same six in dark** — inject `document.documentElement.classList.add('dark')` in devtools (`.dark` is not reachable in the app today; this is a check of the token block only, not a feature).

- [ ] **Step 5: Walk the two doors by hand.** Logged-out `/admin` → `/auth/staff`. Logged-out `/orders` → `/auth/login`. Sign out from `/admin` → `/auth/staff`. Google button → `/onboarding` → submit → `/`. Check the checkout dialog's phone field prefilled from the contact row and labelled "No. WhatsApp".

- [ ] **Step 6: Confirm the lockup shows no white box** on `/auth/login` and `/auth/staff` (both must sit on paper/white) and that the plate stays `bg-brand-ink` with white text.

- [ ] **Step 7: Report** — list what was checked, which screenshots were compared, and any surface that still reads yellow.
