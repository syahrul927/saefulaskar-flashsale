/**
 * Shared rupiah formatting — the one copy of the id-ID Intl config (pinned by
 * `tests/admin-format.test.ts`). Deliberately dependency-free: server
 * components import this module, and under RSC every top-level import would be
 * evaluated there too (see `tests/format-boundary.test.ts`). Client-only
 * companions (`copyToClipboard`, `CopyChip`) live in
 * `src/app/_components/copy-chip.tsx`.
 */

// Decimal-only: the symbol + spacing of `style:"currency"` come from each
// runtime's bundled CLDR data — Node rendered `Rp 0` while some browsers
// render `Rp0`, so a server render and its client hydration disagreed
// (storefront header cart total mismatch). Assembling "Rp " + grouped number
// by hand is deterministic across engines, same as formatCompactRupiah.
const NUMBER = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 0,
});

/** Full rupiah, e.g. `Rp 1.234.567` — plain ASCII space, never NBSP. */
export function formatRupiah(value: number): string {
  return `Rp ${NUMBER.format(value)}`;
}
