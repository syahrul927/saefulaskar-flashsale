import { AuthForm } from "@/components/auth-form";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

export const metadata = {
  title: "Masuk - Saeful Askar",
};

/**
 * Split brand layout:
 * - md+: left 45% yellow brand panel (wordmark, price-tag outline, "-70%"
 *   starburst — flash-sale vernacular), right white panel with the form
 *   sitting directly on the paper, no floating card.
 * - mobile: yellow band on top, white body below, form full-width.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-svh flex-col bg-background md:flex-row">
      {/* ── Brand panel ─────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden bg-primary px-6 pb-14 pt-8 text-primary-foreground md:sticky md:top-0 md:flex md:h-svh md:w-[45%] md:flex-col md:justify-between md:px-12 md:py-12">
        {/* Oversized price-tag outline, ink on yellow — the one decorative
            element. Bleeds off the top-right corner. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute -right-16 -top-16 z-0 h-64 w-64 rotate-12 opacity-25 md:-right-20 md:-top-20 md:h-[26rem] md:w-[26rem] md:opacity-30"
        >
          <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 2.828 0l6.586-6.586a2.426 2.426 0 0 0 0-2.828z" />
          <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
        </svg>

        {/* Wordmark */}
        <header className="relative z-10">
          <p className="font-heading text-xl font-semibold tracking-tight md:text-2xl">
            Saeful Askar
          </p>
        </header>

        {/* "-70%" starburst sticker — flash-sale price flash. SVG only,
            brand ink on brand yellow. */}
        <div className="relative z-10 mt-10 md:mt-0">
          <svg
            aria-hidden="true"
            viewBox="0 0 120 120"
            className="h-28 w-28 text-primary-foreground/90 md:h-40 md:w-40"
          >
            <path
              fill="currentColor"
              d="M60 0l9.4 9.6L82.2 5l5.7 12.4L101.6 14l1.5 13.5L117 32l-2.6 13.3 12.4 6-7.4 11.5 8.6 10.4-11.6 6.9 4 13-13.4 2.2-.8 13.5-13.5-1.4-6.5 12-12.4-5.2-9.9 9.3-9.9-9.3-12.4 5.2-6.5-12-13.5 1.4-.8-13.5-13.4-2.2 4-13L0 73.2l8.6-10.4L1.2 51.3l12.4-6L11 32l13.9-4.5L26.4 14l13.7 3.4L45.8 5l12.8 4.6z"
            />
            <text
              x="60"
              y="56"
              textAnchor="middle"
              fill="oklch(0.852 0.199 91.936)"
              className="font-heading"
              fontSize="30"
              fontWeight="700"
            >
              -70%
            </text>
            <text
              x="60"
              y="76"
              textAnchor="middle"
              fill="oklch(0.852 0.199 91.936)"
              fontSize="10"
              letterSpacing="2"
            >
              FLASH SALE
            </text>
          </svg>
        </div>

        {/* Tagline anchors the panel bottom on desktop */}
        <p className="relative z-10 hidden max-w-xs text-base leading-relaxed opacity-80 md:block">
          Kelola flash sale kamu dengan akun Jubelio.
        </p>
      </section>

      {/* ── Form panel ──────────────────────────────────────────────── */}
      <section className="flex flex-1 flex-col px-6 py-10 md:items-center md:justify-center md:px-12">
        <div className="w-full max-w-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-500">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Masuk ke dasbor
          </h1>
          {/* On mobile the yellow panel is short, so the tagline lives here */}
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground md:hidden">
            Kelola flash sale kamu dengan akun Jubelio.
          </p>

          <div className="mt-8">
            <AuthForm />
          </div>

          <p className="mt-8 border-t border-border pt-4 text-sm text-muted-foreground">
            Pelanggan? Masuk dengan Google untuk mulai belanja.
          </p>

          <div className="mt-4">
            <GoogleSignInButton />
          </div>

          <p className="mt-8 border-t border-border pt-4 text-sm text-muted-foreground">
            Butuh akses? Hubungi admin.
          </p>
        </div>
      </section>
    </main>
  );
}
