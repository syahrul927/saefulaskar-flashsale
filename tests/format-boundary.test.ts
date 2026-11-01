import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Server components (admin/page, admin/orders/page, (storefront)/orders/page)
// import `formatRupiah` from `@/lib/format`. Under RSC, evaluating that module
// executes ALL of its imports even when only the formatter is called — and
// `@phosphor-icons/react`'s main entry needs `React.createContext`, which the
// vendored RSC react build does not export ("createContext is not a function",
// dev-only crash on first request; `next build` never evaluates these dynamic
// pages). This test pins the shared formatter module dependency-free so the
// split (pure format.ts vs client copy-chip.tsx) cannot silently regress.
const source = readFileSync(
  fileURLToPath(new URL("../src/lib/format.ts", import.meta.url)),
  "utf8",
);

describe("src/lib/format.ts module boundary", () => {
  it("has no imports or re-exports (stays RSC-safe)", () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*export\s[^=]*\bfrom\b/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });

  it("still exports formatRupiah", () => {
    expect(source).toMatch(/export function formatRupiah/);
  });
});
