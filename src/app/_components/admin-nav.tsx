"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// SSR entry: rendered by the admin layout, which is a server component.
import { BroadcastIcon, ClipboardIcon, GearIcon } from "@phosphor-icons/react/ssr";
import { cn } from "cn";

type NavItem = {
  href: string;
  label: string;
  Icon: typeof GearIcon;
  /** Whether the current pathname belongs to this segment. */
  isActive: (pathname: string) => boolean;
};

/** Own segment plus anything nested under it, without swallowing siblings. */
function under(href: string) {
  return (pathname: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Konsol's own territory: `/admin` itself plus the session editor nested
 * under it — and deliberately NOT `under("/admin")`. A prefix match on
 * `/admin` swallows every sibling segment, so the Konsol tab stayed active
 * while the user sat on Pesanan or Jubelio (reported 2026-11-03). The
 * trailing slash is load-bearing: it keeps a future `/admin/sessions-legacy`
 * from counting as Konsol. Exported so the predicate is testable without a
 * DOM harness.
 */
export function isKonsolPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/sessions/");
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/admin",
    label: "Konsol",
    Icon: GearIcon,
    // Session config lives at /admin itself; every other segment owns its label.
    isActive: isKonsolPath,
  },
  {
    href: "/admin/orders",
    label: "Pesanan",
    Icon: ClipboardIcon,
    isActive: under("/admin/orders"),
  },
  {
    // Observation bench for the Jubelio integration — see spec §4.7. Hidden
    // from customers, but reachable from the admin header like everything else.
    href: "/admin/jubelio",
    label: "Jubelio",
    Icon: BroadcastIcon,
    isActive: under("/admin/jubelio"),
  },
];

/**
 * Segmented-control nav for the three admin surfaces. Client component because
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
