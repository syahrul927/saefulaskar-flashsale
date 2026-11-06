"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Signs the user out and returns to the staff door (`/auth/staff`). Used when
 * an admin API call answers 401 because their Jubelio token expired (the
 * backend reports `SESSION_EXPIRED` and treats the Jubelio session as ended).
 */
export function useSessionExpiry(): () => Promise<void> {
  const router = useRouter();

  return useCallback(
    async function signOut() {
      try {
        await fetch("/api/auth/sign-out", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      } finally {
        router.push("/auth/staff");
        router.refresh();
      }
    },
    [router],
  );
}