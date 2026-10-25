"use client";

import { cn } from "cn";

export type CategoryPillsProps = {
  categories: string[];
  active: string;
  onSelect: (category: string) => void;
};

function CategoryPills({ categories, active, onSelect }: CategoryPillsProps) {
  const pills = ["All", ...categories.filter(Boolean)];
  return (
    <div className="flex w-full flex-wrap gap-2">
      {pills.map((category) => (
        <button
          key={category}
          type="button"
          onClick={() => onSelect(category)}
          aria-pressed={active === category}
          className={cn(
            "h-8 shrink-0 rounded-3xl border px-3.5 text-sm font-medium whitespace-nowrap transition-all",
            active === category
              ? "border-transparent bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {category}
        </button>
      ))}
    </div>
  );
}

export { CategoryPills };
