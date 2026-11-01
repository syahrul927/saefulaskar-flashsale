"use client";

import type { StatusStep } from "@/server/status-steps";

/**
 * The status history, drawn as a vertical stepper (spec §4.6, mockup option A
 * in `stepper-home.html`). Purely a renderer: `buildStatusSteps` already
 * decided which steps exist, what each says and who it credits, and it never
 * invents a time — so this file's only job is to keep that decision legible.
 *
 * Two rules it must not break, both Review Focus items:
 * - a step with `timestampLabel: null` renders NO time and no `—` placeholder.
 *   A dash reads as "we checked and found nothing"; here the honest statement
 *   is that we do not know when (Review Focus 5);
 * - the note line prints whatever the seam produced, including the sync's and
 *   the admin's different wordings, because the stepper is the only place an
 *   admin sees why an order cancelled.
 */

const DOT_TONE = {
  done: "bg-neutral-900 dark:bg-neutral-100",
  // The one step that must be unmistakable at a glance, whichever door wrote it.
  cancel: "bg-red-600",
  pending: "bg-neutral-300 dark:bg-neutral-700",
  // "We have no record" is grey for a reason: it is not an event.
  unknown: "bg-neutral-300 dark:bg-neutral-700",
} as const;

const LABEL_TONE = {
  done: "text-neutral-950 dark:text-neutral-50",
  cancel: "text-red-700 dark:text-red-400",
  pending: "text-neutral-400 dark:text-neutral-500",
  unknown: "text-neutral-400 dark:text-neutral-500",
} as const;

function StatusStepper({ steps }: { steps: readonly StatusStep[] }) {
  return (
    <ol className="mt-2">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        // Either half may be absent, and the separator only appears when both
        // are — "oleh admin" alone must not read as a cut-off time.
        const meta =
          [step.timestampLabel, step.actorLabel]
            .filter((v): v is string => v !== null && v !== "")
            .join(" · ") ?? "";
        return (
          <li key={step.id} className="relative pb-4 pl-6 last:pb-0">
            {!isLast && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-[8px] top-4 w-px bg-neutral-200 dark:bg-border"
              />
            )}
            <span
              aria-hidden="true"
              className={`absolute left-1 top-1 h-2.5 w-2.5 rounded-full ${DOT_TONE[step.tone]}`}
            />
            <p
              className={`text-[13px] font-semibold ${LABEL_TONE[step.tone]}`}
            >
              {step.label}
            </p>
            {meta !== "" && (
              <p className="mt-0.5 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                {meta}
              </p>
            )}
            {step.note && (
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                {step.note}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export { StatusStepper };
