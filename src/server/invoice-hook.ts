/**
 * Pure core of the Jubelio invoice-webhook consumer (see the invoice-webhook
 * status design, spec §1–§4.3) — the parse/decision half the route wraps in
 * HTTP. The live evidence: Jubelio pushes a `hook-invoice` event when the
 * faktur is created, carrying `ref_no` (the SO's `salesorder_no`), `invoice_id`
 * and `invoice_no`. For our own internally-created SOs `ref_no` echoes the
 * `SO-000192297` shape; marketplace orders arrive as `SP-…` and are not ours.
 *
 * Everything here is pure — no HTTP, no DB, no imports — so it is testable
 * against live-shaped fixtures (`tests/invoice-hook.test.ts`). Directive-free
 * by construction: it is imported by a webhook route with no React in sight.
 *
 * The tiny id/string helpers are reimplemented locally rather than exported
 * from `jubelio-probe.ts` — that module stays sink-owned; nothing here wants
 * to widen its surface.
 */

export type InvoiceHookEvent =
  | { action: "hook-invoice"; salesorderId: number | null; invoiceId: number | null; invoiceNo: string | null }
  | { action: "other"; actionName: string };

/**
 * `ref_no` → Jubelio SO id. `SO-000192297` → 192297 (owner-verified shape),
 * a bare `"192297"` → 192297 (defensive — the body format is not documented
 * upstream), everything else — including every `SP-…` marketplace number —
 * → null, meaning "not ours, ignore".
 */
export function parseInvoiceHookRef(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const match = /^(?:SO-)?(\d+)$/.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Decides what one parsed webhook body means. A body that is not an object
 * (array, string, null, junk) → null; the route logs it and moves on. The live
 * body is flat — no `{data:…}` envelope — so there is no unwrap step here.
 * `salesorderId: null` on a `hook-invoice` event is not an error: it means
 * "not joined" (missing or marketplace-shaped `ref_no`), which is expected
 * traffic on an account with 184k marketplace orders.
 */
export function parseHookEvent(body: unknown): InvoiceHookEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const action = record.action;
  if (typeof action !== "string" || action === "") {
    return { action: "other", actionName: "" };
  }
  if (action !== "hook-invoice") {
    // Unknown actions (the dashboard may deliver other events to this URL) are
    // passed through untouched so the route can log what actually arrived.
    return { action: "other", actionName: action };
  }
  return {
    action: "hook-invoice",
    salesorderId: parseInvoiceHookRef(record.ref_no),
    invoiceId: positiveInt(record.invoice_id),
    invoiceNo: nonEmptyString(record.invoice_no),
  };
}

/**
 * The hook is a hint; the fetched SO is the evidence (spec §4.3). Whatever the
 * SO reads, it exists and is ours — the only state that changes the route is a
 * cancelled one, which must flow through the cancel service rather than lift
 * the order to COMPLETED.
 */
export function decideHookFlip(internalStatus: string): "flip" | "cancel" {
  return internalStatus.trim().toUpperCase() === "CANCELED" ? "cancel" : "flip";
}

/**
 * Unlike `checkSinkToken`: the sink is an observation bench that stays open
 * until a token is minted; this consumer writes orders, so a configured-token
 * unset means CLOSED — always false (spec §4.1). Once set, the comparison is
 * the same as the sink's: the configured value is trimmed, the provided value
 * is not — a paste with trailing whitespace is a mismatch and fails loudly.
 */
export function checkHookToken(
  provided: string | undefined,
  configured: string | undefined,
): boolean {
  const expected = configured?.trim();
  if (!expected) return false;
  return provided === expected;
}
