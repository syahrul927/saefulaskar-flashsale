"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * "Keluar" — clears the session, then lands on `redirectTo`. The default is the
 * storefront: signing out of a page that has no login door of its own should put
 * you back where you came from. The admin header passes its own door so a
 * signed-out owner can log straight back in.
 */
function SignOutButton({
  className,
  redirectTo = "/",
}: {
  className?: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function handleSignOut() {
    setIsLoading(true);

    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } finally {
      router.push(redirectTo);
      router.refresh();
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className={cn("h-11 w-full", className)}
      disabled={isLoading}
      onClick={handleSignOut}
    >
      {isLoading ? <Spinner /> : "Keluar"}
    </Button>
  );
}

export { SignOutButton };
