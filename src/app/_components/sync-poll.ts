/**
 * Pure decision core for the admin orders sync island (`sync-controls.tsx`).
 * Deliberately directive-free — no `"use client"`, no React — so the node-env
 * Vitest suite imports it directly (`tests/sync-poll.test.ts`); every piece of
 * browser behavior in the island is a thin composition of these two functions.
 */

/** Poll cadence for the silent background sweep: 10 seconds. */
export const POLL_INTERVAL_MS = 10_000;

/**
 * One poll tick runs only when the admin is actually looking at the tab and
 * no previous fetch is still in flight. A sweep can take longer than one
 * interval (one upstream read per linked SO), so the in-flight guard keeps a
 * slow run from stacking a second overlapping fetch every 10 s; the
 * visibility guard keeps a background tab from polling forever with nobody
 * watching.
 */
export function shouldPollTick(input: {
  visible: boolean;
  inFlight: boolean;
}): boolean {
  return input.visible && !input.inFlight;
}

/**
 * Local clock for the "Diperbarui HH.mm.ss" label, hand-assembled with
 * `padStart` — the same determinism rationale as `formatStepTimestamp`
 * (`src/lib/format.ts`): an `id-ID` `format()` renders the clock with dots on
 * this Node and colons on some engines, so joining the parts ourselves makes
 * `14.32.05` the only possible output. `getHours()` is 24-hour by definition,
 * so the h23 clock needs no option.
 */
export function formatLastSyncLabel(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(
    date.getSeconds(),
  )}`;
}
