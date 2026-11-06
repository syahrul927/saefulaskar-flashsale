"use client";

import { useState, type ReactNode } from "react";

import { FilterPill } from "./filter-pill";
import { SESSION_STATUS_LABEL, type SessionStatus } from "./status-badge";

/**
 * Session status tabs (spec decision 2): the console list arrives as
 * pre-rendered server nodes — the same ReactNode-as-prop island pattern as
 * `AdminOrdersFilter` — so filtering is instant and never re-queries.
 * No `emphasis` on these pills: red is the orders "unpaid" signal; the
 * session list stays quiet.
 */
type Tab = "ALL" | SessionStatus;

// The labels come from `SESSION_STATUS_LABEL` — the same glossary the row
// badges render through (final review I-1: pill and badge must read the same
// word; here it is literally the same string, keyed by the enum value).
const TABS: [Tab, string][] = [
  ["ALL", "Semua"],
  ...(Object.entries(SESSION_STATUS_LABEL) as [SessionStatus, string][]),
];

function SessionListFilter({
  rows,
  counts,
}: {
  rows: { id: string; status: SessionStatus; node: ReactNode }[];
  counts: Record<Tab, number>;
}) {
  const [tab, setTab] = useState<Tab>("ALL");

  const visible = rows.filter((r) => tab === "ALL" || r.status === tab);

  return (
    <div>
      <div
        role="group"
        aria-label="Filter status sesi"
        className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-neutral-100 bg-neutral-50/70 px-4 py-3 dark:border-border dark:bg-neutral-900/40"
      >
        {TABS.map(([t, label]) => (
          <FilterPill
            key={t}
            label={label}
            count={counts[t]}
            active={tab === t}
            onClick={() => setTab(t)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="p-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
          Tidak ada sesi pada filter ini.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-border">
          {visible.map((r) => r.node)}
        </ul>
      )}
    </div>
  );
}

export { SessionListFilter };
