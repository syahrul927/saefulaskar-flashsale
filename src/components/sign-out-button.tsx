"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

function SignOutButton({ className }: { className?: string }) {
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
      router.push("/auth/login");
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
