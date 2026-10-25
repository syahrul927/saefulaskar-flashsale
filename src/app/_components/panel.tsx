import type { ReactNode } from "react";

import { cn } from "cn";

/**
 * Card shell with brand gradient top bar and an uppercase header band.
 * Use for dashboard/admin sections; `count` is the right-aligned mono pill.
 */
function Panel({
  title,
  count,
  dot,
  children,
  className,
}: {
  title: string;
  count?: number | string;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-border dark:bg-card",
        className,
      )}
    >
      <div className="h-0.5 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-secondary" />
      <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50/70 px-4 py-3">
        {dot && <span className="h-2 w-2 rounded-full bg-brand-secondary" />}
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-950">
          {title}
        </h3>
        {count != null && (
          <span className="ml-auto font-mono text-[10px] text-neutral-500">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export { Panel };
