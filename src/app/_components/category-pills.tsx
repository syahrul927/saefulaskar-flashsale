"use client";

import { cn } from "cn";

/** Sentinel pill id meaning "no filter" (existing id scheme for `active`). */
const ALL_PILL_ID = "All";

export type CategoryPill = {
  id: string;
  label: string;
};

/**
 * A product's category mapped to its pill bucket — null/blank categories all
 * collapse into "Umum" (storefront D-rule; mirrors `categoryText` in the
 * Jubelio picker). Exported so the grid filter and the pills can never drift.
 */
function pillIdFor(category: string | null): string {
  const trimmed = category?.trim();
  if (!trimmed) return "Umum";
  return trimmed;
}

/**
 * Pills for the storefront filter row: "Semua" first, then one pill per
 * distinct category in order of FIRST APPEARANCE, nulls bucketed under
 * "Umum" — guarantees no product is unreachable by the filter.
 */
function derivePills(products: { category: string | null }[]): CategoryPill[] {
  const pills: CategoryPill[] = [{ id: ALL_PILL_ID, label: "Semua" }];
  const seen = new Set<string>();

  for (const product of products) {
    const id = pillIdFor(product.category);
    if (seen.has(id)) continue;
    seen.add(id);
    pills.push({ id, label: id });
  }

  return pills;
}

export type CategoryPillsProps = {
  pills: CategoryPill[];
  active: string;
  onSelect: (id: string) => void;
};

/**
 * Horizontal snap-scroll filter row (design.html:502-515) — mockup pill
 * treatment: full-round, ink fill when active, single quiet row (no wrap).
 */
function CategoryPills({ pills, active, onSelect }: CategoryPillsProps) {
  return (
    <div className="flex overflow-x-auto no-scrollbar snap-x gap-2">
      {pills.map((pill) => (
        <button
          key={pill.id}
          type="button"
          onClick={() => onSelect(pill.id)}
          aria-pressed={active === pill.id}
          className={cn(
            "shrink-0 snap-start whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition",
            active === pill.id
              ? "border-neutral-900 bg-neutral-900 font-bold text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
              : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900 dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:text-foreground",
          )}
        >
          {pill.label}
        </button>
      ))}
    </div>
  );
}

export { ALL_PILL_ID, CategoryPills, derivePills, pillIdFor };
