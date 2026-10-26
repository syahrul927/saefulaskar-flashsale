"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// SSR entry: rendered by the admin layout, which is a server component.
import { ClipboardIcon, GearIcon } from "@phosphor-icons/react/ssr";
import { cn } from "cn";

type NavItem = {
  href: string;
  label: string;
  Icon: typeof GearIcon;
  /** Whether the current pathname belongs to this segment. */
  isActive: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/admin",
    label: "Konsol",
    Icon: GearIcon,
    // Session config lives under /admin/* — only the order queue is separate.
    isActive: (pathname) => !pathname.startsWith("/admin/orders"),
  },
  {
    href: "/admin/orders",
    label: "Pesanan",
    Icon: ClipboardIcon,
    isActive: (pathname) => pathname.startsWith("/admin/orders"),
  },
];

/**
 * Segmented-control nav for the two admin surfaces. Client component because
 * the active segment needs the live pathname; the header around it stays a
 * server component. Labels collapse to icons below `sm` so the rail fits a
 * phone without clipping the status chrome.
 */
function AdminNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className={cn("flex items-center", className)}>
      <div className="flex items-center gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 text-[11px] sm:text-xs dark:border-border dark:bg-neutral-900">
        {NAV_ITEMS.map(({ href, label, Icon, isActive }) => {
          const active = isActive(pathname);

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              /* Labels collapse below `sm` — keep an accessible name. */
              aria-label={label}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition sm:px-3.5 sm:py-1.5",
                active
                  ? "bg-neutral-900 font-bold text-white shadow-sm dark:bg-neutral-50 dark:text-neutral-900"
                  : "font-semibold text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export { AdminNav };
