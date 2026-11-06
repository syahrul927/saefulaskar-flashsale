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
      expect(css.toLowerCase()).not.toContain(legacy.toLowerCase());
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
      expect(readFileSync(file, "utf8")).not.toMatch(/text-brand-(primary|secondary|mark)\b/);
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
    expect(picker).not.toMatch(/from-amber-50/); // :205, :240 thumb gradients
    expect(picker).not.toMatch(/border-amber-200 bg-amber-50 px-2/); // :156 cellInput
    expect(picker).not.toMatch(/text-amber-700/); // :207, :242 initial letters
  });
});
