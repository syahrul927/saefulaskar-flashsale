import Link from "next/link";

import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { CountdownTimer } from "@/app/_components/countdown-timer";
import { cn } from "cn";
import { db } from "@/server/db";
import { getPrimaryActiveSession } from "@/server/session-query";
import { env } from "@/env";

export const metadata = {
  title: "Masuk — Flash Sale Grosir",
};

// The plate reads the live session, so the page can't be prerendered.
export const dynamic = "force-dynamic";

type LiveSale = { name: string; endTime: string };

// The warning is per process, not per render: this page is `force-dynamic`, so
// a bare call would log on every customer page view of an unconfigured deploy.
let warnedAboutGoogle = false;

/**
 * The session customers are looking at right now — the same earliest ACTIVE row
 * the storefront serves. Read defensively: this page is the way into the app,
 * so a cold DB or a migration mid-flight must never turn into a login that
 * won't render. The plate then falls back to its "nothing live" copy.
 */
async function getLiveSale(): Promise<LiveSale | null> {
  try {
    const session = await getPrimaryActiveSession(db);
    if (!session?.endTime) return null;

    return {
      name: session.name || session.sessionName,
      endTime: session.endTime.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * The customer door — Google is the whole page. A buyer arriving from a
 * WhatsApp link has one thing to do here: sign in with the account they
 * already have. Shop staff have their own door at /auth/staff, linked quietly
 * at the foot of the column, so the page never shows a customer a form or a
 * word that isn't theirs.
 *
 * Built on the two colours the new logo is made of: slate ink (#1F2937, its
 * wordmark) and mark orange (#EA580C) on paper white.
 *
 * - Sign-in sits on the LEFT on paper white. `logo-lockup.png` is an opaque
 *   white export, so a light ground is the only place it can sit without showing
 *   a box — which is also why the wordmark leads the page in reading order.
 * - The right plate is brand-ink, sticky, and carries the one live thing: the
 *   same boxed countdown the storefront banner shows (`tone="ink"`), so a buyer
 *   sees the clock they would be racing against before they even sign in.
 * - Below `lg` the task comes first and the plate becomes a footer strip, so the
 *   dark panel never pushes the sign-in down the screen. The split waits for
 *   `lg` because a 42% column at tablet width can't hold four countdown cells
 *   (Hari/Jam/Menit/Detik) without pushing the page sideways.
 */
export default async function LoginPage() {
  const live = await getLiveSale();

  // Same two keys `server/better-auth/config.ts` gates the Google provider on:
  // with either missing the provider isn't registered, so the button would fail
  // at runtime. Say so in buyer language instead of offering a dead button.
  const googleConfigured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  if (!googleConfigured && !warnedAboutGoogle) {
    warnedAboutGoogle = true;
    const missing = [
      env.GOOGLE_CLIENT_ID ? null : "GOOGLE_CLIENT_ID",
      env.GOOGLE_CLIENT_SECRET ? null : "GOOGLE_CLIENT_SECRET",
    ].filter(Boolean);
    console.warn(
      `Google sign-in unavailable on /auth/login — missing ${missing.join(", ")}`,
    );
  }

  return (
    <main className="flex min-h-svh flex-col bg-background lg:flex-row">
      {/* ── Sign-in panel (paper) ───────────────────────────────────── */}
      <section className="flex flex-1 flex-col px-6 py-10 md:justify-center md:px-12 xl:px-16">
        <div className="w-full max-w-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:[animation-duration:500ms]">
          {/* Brand lockup — the supplied export carries mark + name together.
              Plain `<img>`: `images.unoptimized` is on, `next/image` adds
              nothing. */}
          <header>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-lockup.png"
              alt="Flash Sale Grosir"
              className="w-40 md:w-44"
            />
          </header>

          <h1 className="mt-8 font-heading text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Masuk untuk belanja
          </h1>
          {/* `neutral-600` rather than the muted token: secondary copy at 14px
              needs 4.5:1, and muted grey on paper is 3.2:1. */}
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Cukup akun Google kamu — tidak perlu password baru atau form
            pendaftaran.
          </p>

          <div className="mt-7">
            {googleConfigured ? (
              <GoogleSignInButton />
            ) : (
              <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                Pendaftaran lewat Google belum dibuka. Hubungi toko untuk akses
                belanja.
              </p>
            )}
          </div>

          {/* Wayfinding for shop staff, not a second call to action. */}
          <p className="mt-8 border-t border-border pt-4 text-sm text-neutral-600 dark:text-neutral-400">
            <Link
              href="/auth/staff"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              Masuk sebagai staf
            </Link>
          </p>
        </div>
      </section>

      {/* ── Live sale plate (brand ink) ─────────────────────────────── */}
      <aside
        aria-label="Flash sale yang sedang berjalan"
        className="flex flex-col gap-8 bg-brand-ink px-5 py-10 text-white sm:px-6 md:px-12 lg:sticky lg:top-0 lg:h-svh lg:w-[42%] lg:justify-between lg:gap-0 xl:px-14"
      >
        {/* Status — the one animated thing on the page, and it earns it: it
            marks a live sale, not decoration. */}
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
            {live ? (
              <span className="absolute inset-0 rounded-full bg-brand-mark/70 motion-safe:animate-ping motion-safe:[animation-duration:2.4s]" />
            ) : null}
            <span
              className={cn(
                "relative size-2.5 rounded-full",
                live ? "bg-brand-mark" : "bg-white/30",
              )}
            />
          </span>
          <p className="text-sm font-semibold text-white/85">
            {live ? "Sale sedang aktif" : "Belum ada sale aktif"}
          </p>
        </div>

        {/* The countdown, bracketed by a rule in the logo's orange — the accent
            has one job here: point at the thing that is running out. The
            closing line lives inside this branch: with no session there is no
            clock running, and the plate must not promise one. A fragment, not a
            wrapper div, so the sticky `lg:justify-between` column keeps its
            three slots — status, countdown, tagline — exactly as before. */}
        {live ? (
          <>
            <div className="border-l-2 border-brand-mark pl-4 sm:pl-5">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-white/55">
                Sesi berakhir dalam
              </p>
              <CountdownTimer
                endTime={live.endTime}
                variant="boxed"
                tone="ink"
                size="lg"
                className="mt-3"
              />
              <p className="mt-3.5 max-w-[15rem] truncate text-sm font-medium text-white/70">
                {live.name}
              </p>
            </div>
            <p className="max-w-xs text-[15px] leading-relaxed text-white/70">
              Harga grosir dengan kuota terbatas. Selagi hitungannya masih
              berjalan.
            </p>
          </>
        ) : (
          <div className="border-l-2 border-white/20 pl-4 sm:pl-5">
            <h2 className="font-heading text-lg font-semibold tracking-tight">
              Belum ada sale yang berjalan
            </h2>
            <p className="mt-1.5 max-w-[16rem] text-sm leading-relaxed text-white/60">
              Buka lagi halaman ini nanti, atau tanya toko lewat WhatsApp kapan
              belanja dibuka.
            </p>
          </div>
        )}
      </aside>
    </main>
  );
}
