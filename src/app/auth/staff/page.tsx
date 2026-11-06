import Link from "next/link";

import { AuthForm } from "@/components/auth-form";

export const metadata = {
  title: "Masuk sebagai staf — Flash Sale Grosir",
};

/**
 * Staff door — the Jubelio email/password form, on its own route, so a
 * customer arriving from a WhatsApp link never has to read past a form that
 * isn't theirs.
 *
 * Paper ground, no live-sale plate: this is a tool, not a storefront, and
 * `logo-lockup.png` is an opaque white export, so a light surface is the only
 * place the lockup can sit without showing a box. Heading and sub-line repeat
 * the customer page's typography, so the two doors read as one product.
 */
export default function StaffLoginPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:[animation-duration:500ms]">
        <header>
          {/* Brand lockup — the supplied export carries mark + name together.
              Plain `<img>`: `images.unoptimized` is on, `next/image` adds
              nothing. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-lockup.png"
            alt="Flash Sale Grosir"
            className="w-40 md:w-44"
          />
        </header>

        <h1 className="mt-8 font-heading text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          Masuk sebagai staf
        </h1>
        {/* Contrast, measured on this branch's paper (`--background` #FFFDFC):
            `--muted-foreground` #6F6B66 = 5.21:1, `neutral-600` #525252 =
            7.71:1 — both clear the 4.5:1 this 14px sub-line needs, so
            `text-muted-foreground` would pass here as well. `neutral-600` is
            the look this page ships with, not an accessibility requirement. */}
        <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          Pakai email dan password akun Jubelio kamu.
        </p>

        <div className="mt-7">
          <AuthForm />
        </div>

        {/* One quiet link back to the customer door — wayfinding, not a
            competing call to action. */}
        <p className="mt-8 border-t border-border pt-4 text-sm text-neutral-600 dark:text-neutral-400">
          <Link
            href="/auth/login"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Bukan staf? Masuk dengan Google
          </Link>
        </p>
      </div>
    </main>
  );
}
