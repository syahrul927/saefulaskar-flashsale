import { Button as ButtonPrimitive } from "@base-ui/react/button"
// SSR entry: Button is used in server components and the icon set's main
// entry relies on React Context, which RSC forbids.
import { CircleNotchIcon } from "@phosphor-icons/react/ssr"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-4xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        ink: "bg-neutral-900 text-white hover:bg-neutral-950 dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-white",
        // No orange-filled variant lives here any more. Partner rulings,
        // 2026-11-07: brand orange is decoration (dots, chips, tints, the focus
        // ring), never a fill under a label; and the CTA fill is the logo's
        // dark. The `default` variant above IS that CTA — `--primary` is
        // #1E3351, the wordmark slate #1F2937 lifted at the same hue so a 36px
        // fill reads navy instead of black, carrying a white label at 12.75:1 —
        // so the former `brand` (#EA580C + near-black, 5.56:1) and `mark`
        // (#C2410C + white, 5.18:1) variants are deleted rather than repainted:
        // two names for one dark fill was the defect. Pinned by
        // tests/cta-fill-ink.test.ts and tests/brand-palette.test.ts.
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  isLoading,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Shows a spinner, disables the button and marks it `aria-busy` while `true`. */
    isLoading?: boolean
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(
        buttonVariants({ variant, size, className }),
        // While a request is in flight the loader is the only glyph. Action
        // buttons now carry a leading icon (Task 11) and `isLoading` does NOT
        // replace children, so without this the icon and the spinner would sit
        // side by side. CSS-only: the DOM is untouched, so nothing else about
        // the loading state (disabled, aria-busy) changes.
        isLoading && "[&_svg:not(.animate-spin)]:hidden",
      )}
      {...props}
      {...(isLoading && { disabled: true, "aria-busy": true })}
    >
      {isLoading && <CircleNotchIcon className="animate-spin" aria-hidden="true" />}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
