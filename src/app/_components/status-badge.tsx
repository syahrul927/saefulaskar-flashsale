import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

type StatusTone = "amber" | "emerald" | "blue" | "neutral" | "red";

type SessionStatus = "SCHEDULED" | "ACTIVE" | "PAUSED" | "ENDED";
type OrderStatus = "UNPAID" | "CONFIRMED" | "SHIPPED" | "COMPLETED" | "CANCEL";

const SESSION_STATUS_TONES = {
  SCHEDULED: "blue",
  ACTIVE: "emerald",
  PAUSED: "amber",
  ENDED: "neutral",
} as const satisfies Record<SessionStatus, StatusTone>;

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
  sessionStatusTone,
  StatusBadge,
};
export type { OrderStatus, SessionStatus, StatusTone };
