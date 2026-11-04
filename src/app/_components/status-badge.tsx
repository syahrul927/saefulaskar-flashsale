import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/server/order-status";

type StatusTone = "amber" | "emerald" | "blue" | "neutral" | "red";

type SessionStatus = "SCHEDULED" | "ACTIVE" | "PAUSED" | "ENDED";

const SESSION_STATUS_TONES = {
  SCHEDULED: "blue",
  ACTIVE: "emerald",
  PAUSED: "amber",
  ENDED: "neutral",
} as const satisfies Record<SessionStatus, StatusTone>;

/**
 * The session-status glossary — the words the console's filter pills already
 * read (final review I-1: a badge under a pill that says "Terjadwal" cannot
 * shout `SCHEDULED`). One map, single source: `session-list-filter.tsx` builds
 * its TABS labels from it and every session badge renders through
 * `sessionStatusLabel`, so there is nothing to drift.
 */
const SESSION_STATUS_LABEL = {
  SCHEDULED: "Terjadwal",
  ACTIVE: "Aktif",
  PAUSED: "Dijeda",
  ENDED: "Selesai",
} as const satisfies Record<SessionStatus, string>;

const ORDER_STATUS_TONES = {
  UNPAID: "amber",
  CONFIRMED: "emerald",
  SHIPPED: "blue",
  COMPLETED: "neutral",
  CANCEL: "red",
} as const satisfies Record<OrderStatus, StatusTone>;

function sessionStatusTone(status: SessionStatus): StatusTone {
  return SESSION_STATUS_TONES[status];
}

/** Bahasa word for a session status — the pill glossary above, never the enum. */
function sessionStatusLabel(status: SessionStatus): string {
  return SESSION_STATUS_LABEL[status];
}

function orderStatusTone(status: OrderStatus): StatusTone {
  return ORDER_STATUS_TONES[status];
}

/** Live states (running session, unpaid order) get a pulsing dot. */
function isPulseStatus(status: string): boolean {
  return status === "ACTIVE" || status === "UNPAID";
}

const TONE_TO_BADGE_VARIANT = {
  amber: "amber",
  emerald: "emerald",
  blue: "blue",
  neutral: "neutral",
  red: "destructive",
} as const;

/**
 * Tinted, uppercase-mono status pill. Pass the Bahasa Indonesia label as
 * children and derive `tone` from `sessionStatusTone` / `orderStatusTone`.
 */
function StatusBadge({
  tone,
  pulse,
  children,
}: {
  tone: StatusTone;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <Badge variant={TONE_TO_BADGE_VARIANT[tone]}>
      {pulse && (
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
      )}
      {children}
    </Badge>
  );
}

export {
  isPulseStatus,
  orderStatusTone,
  SESSION_STATUS_LABEL,
  sessionStatusLabel,
  sessionStatusTone,
  StatusBadge,
};
// `OrderStatus` is re-exported for existing importers; the vocabulary itself
// lives in `@/server/order-status`, derived from the `pgEnum`.
export type { OrderStatus, SessionStatus, StatusTone };
