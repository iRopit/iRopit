"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const AUTO_GOOGLE_PROMPT_KEY = "iropit:auto-google-prompted:v1";

export default function AutoGoogleLoginPrompt() {
  const { user, loading, loginWithGoogle } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    if (loading || user) return;

    // Trigger only when users first land on the public homepage.
    if (pathname !== "/") return;

    const alreadyPrompted = sessionStorage.getItem(AUTO_GOOGLE_PROMPT_KEY);
    if (alreadyPrompted) return;

    attemptedRef.current = true;
    sessionStorage.setItem(AUTO_GOOGLE_PROMPT_KEY, "1");

    const timer = window.setTimeout(async () => {
      try {
        await loginWithGoogle();
        router.push("/dashboard");
      } catch (err) {
        const code = (err as { code?: string })?.code || "";

        // Keep silent for expected user/browser outcomes.
        if (
          code === "auth/popup-closed-by-user" ||
          code === "auth/cancelled-popup-request" ||
          code === "auth/popup-blocked"
        ) {
          return;
        }

        console.error("Auto Google login failed:", err);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [loading, user, pathname, loginWithGoogle, router]);

  return null;
}
