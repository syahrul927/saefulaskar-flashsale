import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// One source of truth: the palette lives in globals.css. This file pins the
// values the brand is made of and kills the previous brand's yellow.
const css = readFileSync("src/styles/globals.css", "utf8");

describe("brand palette", () => {
  // Every pattern here is written to survive the repo's own formatter, because
  // `format:check` is red at baseline (189 files) so a `format:write` run is a
  // likely cleanup — and prettier rewrites `src/styles/globals.css` in three
  // ways that are not product changes (measured on a copy, not guessed):
  //   1. it lowercases hex declarations — `#EA580C` → `#ea580c`;
  //   2. it strips a trailing zero in an `oklch()` component — `0.030` → `0.03`;
  //   3. it explodes any declaration whose trailing comment passes 80 columns
  //      onto three lines, so the single literal space between components goes.
  // A case-sensitive hex or a literal ` ` would redden 11 assertions in this
  // file with the palette untouched — the same false-red
  // tests/transactional-labels.test.ts guards against for the tailwind sorter.
  // Hence `/i` on every hex and `\s+`/`\s*` around every component.
  it("defines the logo's two colours as the brand tokens", () => {
    expect(css).toMatch(/--color-brand-primary:\s*#EA580C/i);
    expect(css).toMatch(/--color-brand-secondary:\s*#FB923C/i);
    expect(css).toMatch(/--color-brand-mark:\s*#EA580C/i);
    expect(css).toMatch(/--color-brand-ink:\s*#1F2937/i);
    expect(css).toMatch(/--color-brand-action:\s*#C2410C/i);
  });

  it("hovers the primary brand fill LIGHTER — darkening fails AA under dark text", () => {
    expect(css).toMatch(/--color-brand-primary-hover:\s*#F97316/i);
  });

  it("carries no trace of the legacy saefulaskar yellow", () => {
    for (const legacy of ["#FFCC05", "#EBB800", "#FF7E33"]) {
      expect(css.toLowerCase()).not.toContain(legacy.toLowerCase());
    }
  });

  it("leads with wordmark slate, not yellow, in light mode", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
    // `0\.030|0\.03` is one number in two spellings (prettier's is the short
    // one), so the alternation buys format tolerance and gives up nothing.
    expect(root).toMatch(
      /--primary:\s*oklch\(\s*0\.278\s+(?:0\.030|0\.03)\s+256\.8\s*\)/,
    );
    expect(root).toMatch(
      /--foreground:\s*oklch\(\s*0\.278\s+(?:0\.030|0\.03)\s+256\.8\s*\)/,
    );
    expect(root).toMatch(/--accent:\s*oklch\(\s*0\.966\s+0\.021\s+60\.8\s*\)/);
    expect(root).toMatch(
      /--accent-foreground:\s*oklch\(\s*0\.553\s+0\.174\s+38\.4\s*\)/,
    );
    expect(root).toMatch(/--ring:\s*oklch\(\s*0\.646\s+0\.194\s+41\.1\s*\)/);
  });
});

describe("brand orange as text", () => {
  // #EA580C / #FB923C on paper is 3.51:1 / 2.23:1 — a mark colour must never
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
      // The lookbehind exempts a sanctioned `dark:text-brand-*` companion:
      // this rule is about brand orange painted on light paper.
      expect(readFileSync(file, "utf8")).not.toMatch(
        /(?<!dark:)text-brand-(primary|secondary|mark)\b/,
      );
    }
  });
});

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
    expect(picker).not.toMatch(/from-amber-50/); // :207, :242 thumb gradients
    expect(picker).not.toMatch(/border-amber-200 bg-amber-50 px-2/); // :157 cellInput
    expect(picker).not.toMatch(/text-amber-700/); // :209, :244 initial letters
  });

  it("keeps the letter tile's end stop pale enough for its glyph to hold AA", () => {
    // Not an absence check: the centred initial sits mid-gradient, and at
    // `to-brand-secondary/25` that ground composites to ≈4.35:1 under
    // `text-brand-action` — under the 4.5:1 bar these letters (text-base/lg,
    // below the 18.66px bold exemption) have to clear. `/15` measures ~4.6:1.
    const tiles = [
      "src/app/_components/product-thumb.tsx",
      "src/app/_components/product-picker.tsx",
    ];
    for (const file of tiles) {
      expect(readFileSync(file, "utf8")).toMatch(
        /from-brand-primary\/10 to-brand-secondary\/15/,
      );
    }
  });

  it("grounds the cart tile on paper so its fallback letter clears 4.5:1", () => {
    // The frame ground, not the type, is what puts this glyph under the bar:
    // the drawer passes `letterClass="text-lg"` (18px font-black), below the
    // 18.66px bold large-text exemption, so it needs 4.5:1. `bg-neutral-100`
    // (#F5F5F5) measures 4.22–4.25 for `text-brand-action` through the `/15`
    // gradient; on the row's own white the same glyph measures 4.58–4.60.
    const cart = readFileSync("src/app/_components/cart-drawer.tsx", "utf8");
    const frame =
      /overflow-hidden rounded-lg border border-neutral-200\/80[^"]*"/;
    expect(cart).toMatch(frame);
    expect(cart.match(frame)![0]).not.toContain("bg-neutral-100");
    // Split so a `prettier-plugin-tailwindcss` reorder of that class string
    // cannot redden the suite: the pin is that both grounds are present.
    // The `dark:bg-card` half is Task 4b's frame decision, not an AA claim: on
    // `.dark --card` (#1B222B, globals.css:60) the same `text-brand-action`
    // glyph measures 3.09:1, so 4.5:1 holds on the paper/white grounds this
    // title names and not there. `.dark` is unreachable in this app —
    // globals.css:5 defines the variant, nothing ever applies the class
    // (`<html>` at src/app/layout.tsx:40), no provider — so the latent ships.
    expect(cart.match(frame)![0]).toContain("bg-white");
    expect(cart.match(frame)![0]).toContain("dark:bg-card");
  });
});

describe("caution stays out of the brand colour", () => {
  // States that mean "act on this" — unpaid, awaiting payment, a cancel that
  // costs money. They take the red caution recipe, never the old brand yellow
  // and never the new brand orange (which is decoration). `storefront-header`
  // joins the scan so Task 4's active-tab icon swap gets pinned: that task's
  // own grep only looked for `amber-`, which the file never had.
  const caution = [
    "src/app/_components/filter-pill.tsx",
    "src/app/_components/payment-panel.tsx",
    "src/app/_components/orders-list.tsx",
    "src/app/_components/cancel-order-button.tsx",
    "src/app/_components/storefront-header.tsx",
  ];

  it("reads unpaid/awaiting states as red, never amber or brand orange", () => {
    for (const file of caution) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/amber-/);
      expect(src).not.toMatch(/(?<!dark:)text-brand-(primary|secondary|mark)\b/);
    }
    expect(readFileSync("src/app/_components/filter-pill.tsx", "utf8")).toMatch(/bg-red-500/);

    // Positive recipe pins for the three files the loop above cannot see. An
    // absence scan is satisfied by `bg-emerald-*`, `bg-neutral-*` or a plain
    // grey tint just as well as by red, so reverting one of these caution
    // surfaces to a non-red tone kept Review Focus 3 ("an unpaid order or
    // paused session reads red") false with the suite green. Each asserts the
    // recipe that file's own caution string carries today, token-by-token
    // inside ONE quoted class string so a `prettier-plugin-tailwindcss`
    // reorder cannot redden the suite — the same de-frail idiom as
    // tests/transactional-labels.test.ts:32.
    //   payment-panel.tsx:288        the "selesaikan pembayaran" banner
    //   orders-list.tsx:150          the unpaid row's own tint + ring
    //   cancel-order-button.tsx:56   the shared `unpaid` WARN tone
    const panel = readFileSync("src/app/_components/payment-panel.tsx", "utf8");
    const list = readFileSync("src/app/_components/orders-list.tsx", "utf8");
    const cancelBtn = readFileSync(
      "src/app/_components/cancel-order-button.tsx",
      "utf8",
    );

    expect(panel).toMatch(
      /"(?=[^"]*\bborder-red-200\b)(?=[^"]*\bbg-red-100\b)[^"]*"/,
    );
    expect(list).toMatch(
      /"(?=[^"]*\bborder-red-300\b)(?=[^"]*\bbg-red-50\/20\b)(?=[^"]*\bring-red-200\b)[^"]*"/,
    );
    expect(cancelBtn).toMatch(
      /"(?=[^"]*\bborder-red-200\b)(?=[^"]*\bbg-red-100\b)(?=[^"]*\btext-red-700\b)[^"]*"/,
    );
  });

  it("paints the active storefront tab icon the action orange, not the light brand", () => {
    const header = readFileSync("src/app/_components/storefront-header.tsx", "utf8");
    expect(header).toMatch(/text-brand-action/);
    expect(header).not.toMatch(/(?<!dark:)text-brand-secondary\b/);
  });
});

describe("no old-brand yellow survives in components", () => {
  // Regression guard, not a TDD driver: the sweep was already clean when this
  // widened — `yellow-` matches nothing under src, and no stylesheet mentions
  // amber — so this pins the anti-goal (the old brand's yellow coming back in
  // any flavour, in any source) rather than a live defect. The trailing dash is
  // what keeps the two sanctioned history notes (status-badge.tsx:8,
  // src/components/ui/button.tsx:18) out of the hits.
  it("leaves zero amber-* or yellow-* classes under src/", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(`${dir}/${e.name}`)
          : /\.(tsx|ts|css)$/.test(e.name)
            ? [`${dir}/${e.name}`]
            : [],
      );
    const hits = walk("src")
      .map((f) => ({ f, m: readFileSync(f, "utf8").match(/amber-|yellow-/g) }))
      .filter((x) => x.m);
    expect(hits).toEqual([]);
  });
});
