"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { loginWithGoogle, user, loading: authLoading } = useAuth();
  const { t, language, setLanguage, isRTL } = useLanguage();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user) router.replace("/dashboard");
  }, [user, authLoading, router]);

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      await loginWithGoogle();
      router.push("/dashboard");
    } catch (err: unknown) {
      console.error("Google sign-in error:", err);
      const code = (err as { code?: string })?.code;
      if (code === "auth/unauthorized-domain") {
        setError(t("errors.googleFailed") + " (unauthorized domain)");
      } else if (code === "auth/popup-closed-by-user") {
        setError(t("errors.googleFailed") + " (popup closed)");
      } else if (code === "auth/popup-blocked") {
        setError(t("errors.googleFailed") + " (popup blocked)");
      } else {
        setError(t("errors.googleFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) return null;

  return (
    <div className="w-full max-w-md" dir={isRTL ? "rtl" : "ltr"}>
      {/* Language Toggle */}
      <div className="flex justify-end mb-6">
        <button
          onClick={() => setLanguage(language === "en" ? "ar" : "en")}
          className="text-sm text-txt-secondary hover:text-primary transition-colors px-3 py-1 rounded-lg hover:bg-surface-secondary"
        >
          {language === "en" ? "العربية" : "English"}
        </button>
      </div>

      {/* Mobile Logo */}
      <div className="lg:hidden flex justify-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
          <Image
            src="/logo.png"
            alt="iRopit"
            width={36}
            height={36}
            className="object-contain"
          />
        </div>
      </div>

      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-txt">
          {t("auth.welcomeBack")}
        </h2>
        <p className="text-txt-secondary mt-2 text-sm">
          {t("auth.signInToContinue")}
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-[var(--radius-sm)] bg-error-light text-error text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleGoogleLogin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 py-3 bg-surface border border-border hover:bg-surface-secondary rounded-[var(--radius)] text-txt font-medium transition-colors disabled:opacity-50"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        {t("auth.signInGoogle")}
      </button>
    </div>
  );
}
