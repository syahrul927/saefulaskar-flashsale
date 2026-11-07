import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Partner ruling, 2026-11-07: an orange FILL under a button label is off-brand
// — orange is decoration (dots, chips, tints, the focus ring), slate is the
// action. Every former `variant="brand"` / `variant="mark"` CTA now uses the
// shadcn `default` variant, which this repo's tokens already wire to brand-ink:
// `--primary` is oklch(0.278 0.030 256.8) == #1F2937 == `--color-brand-ink`
// (both pinned in tests/brand-palette.test.ts), and `--primary-foreground` is
// white, so the label measures 14.68:1 instead of the orange's 5.56:1.
//
// `variant="ink"` (neutral-900 #171717, 15 call sites) deliberately stays: it
// measures 1.22:1 against brand-ink, i.e. indistinguishable next to it, so
// sweeping it is churn rather than a fix.
const button = readFileSync("src/components/ui/button.tsx", "utf8");

describe("CTA fills are brand-ink, never brand-orange", () => {
  it("declares no orange-filled button variant", () => {
    // The invariant, stated once: no `bg-brand-*` may fill a button. A new
    // orange variant is exactly what this test exists to refuse.
    expect(button).not.toMatch(/bg-brand-/);
    expect(button).not.toMatch(/^\s*brand:\s*"/m);
    expect(button).not.toMatch(/^\s*mark:\s*"/m);
  });

  it("wires the default variant to the ink token and white label", () => {
    // Structural, not a colour guess: `default` must read from the semantic
    // pair, so the CTA colour follows `--primary` instead of hardcoding a hex.
    expect(button).toMatch(/default:\s*"bg-primary text-primary-foreground/);
  });

  it("leaves no orange-filled call site anywhere in src", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(`${dir}/${e.name}`)
          : /\.(tsx|ts)$/.test(e.name)
            ? [`${dir}/${e.name}`]
            : [],
      );
    const hits = walk("src")
      .map((f) => ({
        f,
        m: readFileSync(f, "utf8").match(/variant="(brand|mark)"/g),
      }))
      .filter((x) => x.m);
    expect(hits).toEqual([]);
  });

  it("moves exactly the five named CTAs onto the ink fill", () => {
    // Counts, not presence: a sixth `variant="default"` appearing in one of
    // these files would mean a different button was recoloured by accident,
    // and a missing one means a CTA stayed orange. `variant="default"` had 0
    // call sites in src before this change, so these totals are exact.
    const expected: Record<string, number> = {
      "src/app/_components/payment-panel.tsx": 1, // the WhatsApp payment CTA
      "src/app/_components/storefront-header.tsx": 1, // the cart button
      "src/app/_components/orders-list.tsx": 2, // "Lihat Produk Flash" + "Instruksi Pembayaran"
      "src/components/auth-form.tsx": 1, // the staff door's "Masuk"
    };
    for (const [file, count] of Object.entries(expected)) {
      const src = readFileSync(file, "utf8");
      expect((src.match(/variant="default"/g) ?? []).length).toBe(count);
    }
  });

  it("lifts the cart count chip off the dark fill it can no longer outline", () => {
    // The chip is `bg-brand-secondary` (#FB923C) with near-black digits — it
    // reads 8.75:1 on its own fill and separates from brand-ink at 6.49:1.
    // Its old `border-neutral-950` measured 1.35:1 against the slate button it
    // now sits on, i.e. it painted nothing.
    // Scanned with comments stripped and the match anchored to a `className`
    // attribute. Bare `/"[^"]*bg-brand-secondary[^"]*"/` is not enough: between
    // two adjacent string literals the renderer sees one big quote-free run,
    // so a prose comment that merely NAMES both classes (as the `CartButton`
    // doc comment does) satisfies it and the assertion fails on documentation
    // rather than on markup.
    const header = readFileSync(
      "src/app/_components/storefront-header.tsx",
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const chipRe = /className="(?=[^"]*\bbg-brand-secondary\b)[^"]*"/;
    const chip = chipRe.exec(header)?.[0] ?? "";
    expect(chip).toContain("bg-brand-secondary");
    expect(chip).not.toContain("border-neutral-950");
  });
});
