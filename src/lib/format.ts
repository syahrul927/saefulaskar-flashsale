/**
 * Shared rupiah + step-timestamp formatting — the one copy of the id-ID Intl
 * configs (pinned by `tests/admin-format.test.ts` and
 * `tests/format-step-timestamp.test.ts`). Deliberately dependency-free: server
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

// Same hand-assembly reason as formatRupiah: `format()` of a whole `id-ID`
// date-time renders the clock as `19.04` on some runtimes and `19:04` on
// others, so a server render would disagree with its client hydration. Taking
// the parts and joining them ourselves makes `28 Okt 2026, 19.04` the only
// possible output. `hourCycle: "h23"` keeps the 24-hour clock explicit — the
// default for `id-ID` — instead of trusting CLDR to agree.
const STEP_TIME = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * The one shape the status stepper prints for a moment in an order's life —
 * `28 Okt 2026, 19.04`. Called from a server component, and its result is what
 * crosses to the client, so no `Date`/locale work is repeated on hydration.
 */
export function formatStepTimestamp(date: Date): string {
  const p = Object.fromEntries(
    STEP_TIME.formatToParts(date).map((x) => [x.type, x.value]),
  );
  return `${p.day} ${p.month} ${p.year}, ${p.hour}.${p.minute}`;
}
