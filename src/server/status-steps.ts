/**
 * The customer-facing status stepper, as data (spec §4.5/§4.6) — no React, no
 * database, so its rules can be unit-tested (`tests/status-steps.test.ts`) and
 * called straight from a server component. Only two imports, both cheap and
 * runtime-clean: `@/lib/format` is dependency-free by contract
 * (`tests/format-boundary.test.ts`) and `./order-status` holds only `import
 * type` sources, so neither drags drizzle or a client library into an RSC
 * render. `StatusHistoryEntry` is imported as a TYPE: the rows come from
 * `listStatusHistory`, which the caller has already read.
 *
 * Nothing here invents a step or a time (spec §4.5). The table records only
 * transitions this app actually observed, so an order older than the feature
 * has no history and gets ONE muted, timestamp-free step naming its current
 * status. A `null` `timestampLabel` means "we do not know when", never a guess
 * — in particular never `orders.updated_at`, which `$onUpdate` rewrites on any
 * write, including a resi backfill that changed no status at all.
 */

import { formatStepTimestamp } from "@/lib/format";

import {
  CUSTOMER_STATUS_LABEL,
  stepLabel,
  type OrderStatus,
} from "./order-status";
import type { StatusHistoryEntry } from "./status-history";

/**
 * Visual weight the dialog gives a step (Task 12 styles all four), not a status —
 * `StatusStep["tone"]` is the same union for any caller that needs it named.
 */
type StepTone = "done" | "cancel" | "pending" | "unknown";

/**
 * One row of the stepper. `id` is the history row's id, or one of the three
 * sentinels `"created"` / `"current"` / `"pending"` for the steps that are not
 * history rows. Every label is Bahasa — the stepper is a customer surface, so
 * it follows the customer vocabulary and never prints the raw enum.
 */
type StatusStep = {
  id: string;
  label: string;
  /** `null` = we do not know when this happened. Never a substitute value. */
  timestampLabel: string | null;
  /**
   * Who is credited, pre-positioned for display, or `null` for nobody:
   * `"oleh Rina"` | `"oleh admin"` (a live admin account with no name) |
   * `"oleh admin yang sudah dihapus"` (the FK nulled the actor) |
   * `"sinkronisasi Jubelio"`. A consumer must render whatever string arrives —
   * this list is documentation, not a contract it may switch on.
   */
  actorLabel: string | null;
  note: string | null;
  tone: StepTone;
};

/**
 * Creation step → one step per history row (in the order given — the caller
 * gets them ascending from SQL and re-sorting here would hide a broken
 * `ORDER BY`) → the pre-history current-status step when there are no rows →
 * the pending step ONLY while the order is still UNPAID. Once it has been paid
 * the list ends: the last customer-visible fact about a paid order is that it
 * is finished (spec §4.6, Ruling 3).
 *
 * One row does not become a step: checkout's `null → UNPAID` creation record,
 * because the step that opens the list already states that transition and
 * carries the timestamp the spec calls authoritative (§4.5).
 */
function buildStatusSteps(input: {
  status: OrderStatus;
  createdAt: Date;
  /** Ascending, as `listStatusHistory` returns it. Not re-sorted here. */
  history: readonly StatusHistoryEntry[];
}): StatusStep[] {
  const { status, createdAt, history } = input;

  const steps: StatusStep[] = [
    {
      // Hardcoded rather than `stepLabel(null, status)`, which happens to
      // return the same words: this step is a stepper concept, not a
      // transition label, and it must read "Pesanan dibuat" whatever the
      // order has since become. Time comes from `orders.created_at` — the one
      // column that cannot be rewritten behind our back.
      id: "created",
      label: "Pesanan dibuat",
      timestampLabel: formatStepTimestamp(createdAt),
      actorLabel: null,
      note: null,
      tone: "done",
    },
  ];

  // The `null → UNPAID` row checkout writes restates the creation step this
  // array already opened, and `orders.created_at` is the timestamp spec §4.5
  // treats as authoritative for it ("`checkout` history rows are optional, but
  // creation must still render as a step"). Skipped as a step, never as a row:
  // the audit record stays in the table.
  const transitions = history.filter((row) => row.fromStatus !== null);

  for (const row of transitions) {
    steps.push({
      id: row.id,
      label: stepLabel(row.fromStatus, row.toStatus),
      timestampLabel: formatStepTimestamp(row.createdAt),
      actorLabel: actorLabelFor(row),
      note: row.note,
      // Cancel is the one transition the dialog must make unmistakable, and
      // it reads the same however it was reached (spec §4.6).
      tone: row.toStatus === "CANCEL" ? "cancel" : "done",
    });
  }

  // RAW `history`, not `transitions`: a fresh order has only the checkout row,
  // so filtering first would make `transitions.length === 0` true and print the
  // "predates the feature" step for an order whose history is complete. The
  // muted step is a claim about the TABLE being empty.
  if (history.length === 0) {
    steps.push({
      id: "current",
      label: CUSTOMER_STATUS_LABEL[status],
      // No timestamp, and specifically not `updated_at`: we genuinely do not
      // know when this order reached this status.
      timestampLabel: null,
      actorLabel: null,
      note: "Tercatat sebelum riwayat status aktif",
      // A pre-history cancellation still says who did NOT do it: nobody. Its
      // tone is the cancel red, not the unknown grey, so the dialog ends on
      // the fact that matters.
      tone: status === "CANCEL" ? "cancel" : "unknown",
    });
  }

  // The placeholder is a promise about the FUTURE, so it can only be made when
  // one is owed: an order that has not been paid yet. CONFIRMED used to fall
  // through to a "Selesai" placeholder below the paid step, which both claimed
  // the order was finished twice and left a grey dot hanging after it.
  //
  // Deliberately NOT `!isEndState(status)`: CONFIRMED and SHIPPED are not end
  // states — an admin may still cancel a CONFIRMED order and a legacy SHIPPED
  // row can still advance (spec §4.7) — but the customer has nothing left to
  // wait for, and this stepper speaks to the customer (Ruling 3). The two
  // questions are different and must stay spelled differently in this file.
  if (status === "UNPAID") {
    steps.push({
      id: "pending",
      label: "Menunggu pembayaran",
      timestampLabel: null,
      actorLabel: null,
      note: null,
      tone: "pending",
    });
  }

  return steps;
}

/**
 * Who the dialog credits for a history row. Sync is credited to the sync even
 * though its row carries no actor — saying "sinkronisasi Jubelio" is what keeps
 * a Jubelio-side deletion from looking like something a person did here.
 *
 * The switch is exhaustive over `StatusHistorySource` on purpose: a fourth
 * source in the schema becomes a build error here instead of an unattributed
 * step.
 */
function actorLabelFor(row: StatusHistoryEntry): string | null {
  switch (row.source) {
    case "sync":
      return "sinkronisasi Jubelio";
    case "admin": {
      // Two different empties, kept apart because the seam documents them as
      // two facts (`status-history.ts:69-75`). `null` is the FK having zeroed
      // `actor_user_id` when the admin was deleted, so the person is gone and
      // the row says so. A blank name on a row that still points at an account
      // means only "this account has no name" — printing "sudah dihapus" there
      // would report a deletion that never happened.
      if (row.actorName === null) return "oleh admin yang sudah dihapus";
      const name = row.actorName.trim();
      return name ? `oleh ${name}` : "oleh admin";
    }
    case "checkout":
      // The customer paid through the storefront; no admin touched this one.
      // Today the only checkout row is the creation record, which never reaches
      // this function (filtered above) — the branch stays because attribution
      // for a checkout-sourced TRANSITION must be decided here, not defaulted,
      // and dropping it would break the exhaustiveness that catches a new
      // source.
      return null;
  }
}

export { buildStatusSteps };
export type { StatusStep };
