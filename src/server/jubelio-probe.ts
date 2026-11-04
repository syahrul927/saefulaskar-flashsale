/**
 * Pure core of the Jubelio webhook sink (see `docs/PRD.md` §4.7) — the
 * observation half of the rig, answering the question upstream never
 * documents: what does a Jubelio webhook POST actually contain? The sink
 * records the request verbatim (headers + body) so the payload shape is read
 * from reality instead of guessed from a spec that has been wrong about
 * `payment_method`, the SO list, and webhook registration.
 *
 * The snapshot-diff half of the bench (two SO reads compared key by key) was
 * retired 2026-11-04: production sync already reads each linked SO on the
 * admin orders page, so the diff panels answered a question nothing asks.
 *
 * Everything here is pure — no HTTP, no DB — so it is testable against
 * live-shaped fixtures (`tests/jubelio-probe.test.ts`).
 */

/** Cap on what we store of an inbound body. A public sink must not be a disk. */
export const SINK_MAX_BODY_BYTES = 64 * 1024;

/** Cap on stored headers — a request can carry hundreds of them. */
const MAX_STORED_HEADERS = 40;

const REDACTED = "[redacted]";

/**
 * Header names we refuse to keep. Chosen so the sink cannot become a credential
 * vault: this endpoint is public, unauthenticated (Jubelio will not set custom
 * headers for us) and its contents are readable by any admin.
 *
 * `signature` is deliberately NOT in here — whether a request is signed at all
 * is exactly one of the things we are trying to learn, and a signature is not
 * a reusable secret.
 */
const CREDENTIAL_HEADER =
  /(authorization|cookie|secret|token|password|passwd|credential|api[-_]?key|apikey|access[-_]?key|auth)/i;

/**
 * Path-segment credential check. The sink is registered as a plain callback URL
 * in Jubelio's dashboard, which offers no place to add a header, so the secret
 * rides in the path.
 *
 * The token is optional on purpose: unset env leaves the sink OPEN to any path
 * segment so the bench works before anyone mints a secret. Setting
 * `JUBELIO_WEBHOOK_SINK_TOKEN` is the hardening step — from then on only the
 * exact token passes, and the old open URL stops storing.
 */
export function checkSinkToken(
  provided: string | undefined,
  configured: string | undefined,
): boolean {
  const expected = configured?.trim();
  if (!expected) return true;
  // Exact compare, no normalisation of the incoming value: a paste that carries
  // trailing whitespace is a mismatch, and must fail loudly rather than write
  // captures nobody can explain.
  return provided === expected;
}

export function redactHeaders(
  input: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  for (const [name, value] of Object.entries(input)) {
    if (count >= MAX_STORED_HEADERS) break;
    const key = name.toLowerCase();
    out[key] = CREDENTIAL_HEADER.test(key) || value === undefined ? REDACTED : value;
    count += 1;
  }
  return out;
}

export type CapturedBody = {
  /** Parsed JSON, or null when the body was not JSON (or was cut mid-object). */
  body: unknown;
  rawBody: string;
  truncated: boolean;
  /** Byte length of the ORIGINAL body, so a truncation is still measurable. */
  byteLength: number;
};

/**
 * Stores what arrived in two forms: parsed (queryable) and raw (the truth). A
 * body we had to cut is never presented as parsed JSON, because a truncated
 * slice either fails to parse or — worse — parses into something Jubelio never
 * sent.
 */
export function captureBody(text: string, contentType: string | null): CapturedBody {
  const byteLength = new TextEncoder().encode(text).length;
  const truncated = byteLength > SINK_MAX_BODY_BYTES;
  const rawBody = truncated ? sliceBytes(text, SINK_MAX_BODY_BYTES) : text;
  if (truncated) {
    return { body: null, rawBody, truncated: true, byteLength };
  }
  const looksJson = /json/i.test(contentType ?? "") || /^\s*[[{]/.test(text);
  if (!looksJson) return { body: null, rawBody, truncated: false, byteLength };
  try {
    return { body: JSON.parse(text), rawBody, truncated: false, byteLength };
  } catch {
    return { body: null, rawBody, truncated: false, byteLength };
  }
}

/** UTF-8-safe cut, so a truncation cannot split a multi-byte character. The
 * ellipsis is paid for out of the budget, so the result never exceeds `max`. */
function sliceBytes(text: string, max: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max) return text;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const budget = Math.max(0, max - 1);
  const cut = decoder.decode(bytes.slice(0, budget));
  return `${cut.slice(0, budget)}…`;
}

export type CaptureRefs = {
  salesorderId: number | null;
  invoiceId: number | null;
  refNo: string | null;
};

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

/** First row when an envelope holds a list — a bulk event still has a shape. */
function unwrap(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const inner = record.data;
  if (Array.isArray(inner)) {
    return inner.length > 0 && inner[0] && typeof inner[0] === "object"
      ? (inner[0] as Record<string, unknown>)
      : null;
  }
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return record;
}

/**
 * The three keys that would let a webhook be joined back to a local order:
 * `salesorder_id` (what we store on confirm), `invoice_id` (the faktur), and
 * `ref_no` (our booking id, if Jubelio echoes it). Whatever the real payload
 * looks like, this is what the capture list surfaces first — if all three are
 * null, the event is unjoinable and the webhook approach dies here.
 */
export function detectCaptureRefs(raw: unknown): CaptureRefs {
  const row = unwrap(raw);
  if (!row) return { salesorderId: null, invoiceId: null, refNo: null };
  return {
    salesorderId: positiveInt(row.salesorder_id ?? row.salesorderId ?? row.id),
    invoiceId: positiveInt(row.invoice_id ?? row.invoiceId),
    refNo: nonEmptyString(row.ref_no ?? row.refNo),
  };
}
