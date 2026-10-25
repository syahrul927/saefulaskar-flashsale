/**
 * Rupiah + percent formatting for the admin KPI tiles (design.html:235-253).
 * Kept next to the route that uses them: the storefront already has its own
 * `formatRupiah` copies, and this module adds the compact/percent forms the
 * admin tiles need — nothing here is meant to replace those.
 */

const RUPIAH = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/** One decimal at most, id-ID separators (`1,2` / `12,5`). */
const SHORT = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

/** Full rupiah, e.g. `Rp 1.234.567` — the KPI tile value. */
export function formatRupiah(value: number): string {
  return RUPIAH.format(value);
}

const COMPACT_STEPS = [
  { divisor: 1_000_000_000, suffix: " M" },
  { divisor: 1_000_000, suffix: " jt" },
  { divisor: 1_000, suffix: " rb" },
] as const;

/**
 * Indonesian compact rupiah for tile sub-lines: `Rp 1,2 jt`.
 *
 * Scaled to the largest of miliar / juta / ribu so the number stays readable
 * at a glance, one decimal, rounded half-up by `Intl`. Below a thousand the
 * exact figure is already short, so it stays unabbreviated.
 */
export function formatCompactRupiah(value: number): string {
  for (const step of COMPACT_STEPS) {
    if (Math.abs(value) >= step.divisor) {
      return `Rp ${SHORT.format(value / step.divisor)}${step.suffix}`;
    }
  }
  return formatRupiah(value);
}

/**
 * Whole-percent share for the `claimed/quota (pct%)` sub-line.
 *
 * Returns an em dash when the denominator is zero: a session with no allocated
 * quota has no share to report, and `0%` would read as "nobody claimed"
 * instead of "nothing was allocated".
 */
export function formatClaimPercent(claimed: number, quota: number): string {
  if (quota <= 0) return "—";
  return `${Math.round((claimed / quota) * 100)}%`;
}
