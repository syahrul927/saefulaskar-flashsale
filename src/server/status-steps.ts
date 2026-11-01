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
  isEndState,
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
   * `"oleh Rina"` | `"oleh admin yang sudah dihapus"` |
   * `"sinkronisasi Jubelio"`.
   */
  actorLabel: string | null;
  note: string | null;
  tone: StepTone;
};

/**
 * Creation step → one step per history row (in the order given — the caller
 * gets them ascending from SQL and re-sorting here would hide a broken
 * `ORDER BY`) → the pre-history current-status step when there are no rows →
 * the pending step while the order is still live.
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

  for (const row of history) {
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

  if (!isEndState(status)) {
    steps.push({
      id: "pending",
      // SHIPPED takes the "Selesai" branch too: it is legacy but a row parked
      // on it can still advance (spec §4.7).
      label: status === "UNPAID" ? "Menunggu pembayaran" : "Selesai",
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
      // `null` (admin deleted, FK set the actor to null) and `""` (an account
      // with no name) both leave us with no person to print, and dropping the
      // step would hide the transition itself. So the step stays and names the
      // actor by what is left of it.
      const name = row.actorName?.trim();
      return name ? `oleh ${name}` : "oleh admin yang sudah dihapus";
    }
    case "checkout":
      // The customer paid through the storefront; no admin touched this one.
      return null;
  }
}

export { buildStatusSteps };
export type { StatusStep };
