"use client";

import { useState } from "react";

import { authClient } from "@/server/better-auth/client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * "Masuk dengan Google" — customer OAuth entry (spec §4.1). Signs in via
 * better-auth, then lands on `callbackURL` (default `/onboarding`, which
 * redirects to `/` when the customer already has a contact row).
 */
function GoogleSignInButton({
  callbackURL = "/onboarding",
  label = "Masuk dengan Google",
}: {
  callbackURL?: string;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    setLoading(true);
    try {
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL,
      });
      if (error?.message) {
        // better-auth surfaces an error object instead of redirecting.
        console.error("google sign-in", error.message);
      }
    } finally {
      // The browser leaves the page on success; only reset on failure path.
      setTimeout(() => setLoading(false), 0);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="h-11 w-full"
      disabled={loading}
      onClick={handle}
    >
      {loading ? <Spinner /> : <GoogleGlyph />}
      {label}
    </Button>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.16-3.16A9.98 9.98 0 0 0 12 1a11 11 0 0 0-9.82 6.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

export { GoogleSignInButton };