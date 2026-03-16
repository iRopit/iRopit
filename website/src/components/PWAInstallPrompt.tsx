"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    const dismissed = sessionStorage.getItem("pwa-install-dismissed");
    if (dismissed) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShow(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShow(false);
    setDeferredPrompt(null);
    sessionStorage.setItem("pwa-install-dismissed", "1");
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md animate-in slide-in-from-bottom">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-lg">
        <img
          src="/icons/icon-48.png"
          alt="iRopit"
          width={40}
          height={40}
          className="shrink-0 rounded-lg"
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-txt text-sm">
            {t("common.install")}
          </p>
          <p className="text-xs text-txt-secondary truncate">
            {t("common.installDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDismiss}
            className="text-xs text-txt-secondary hover:text-txt transition px-2 py-1"
          >
            {t("common.dismiss")}
          </button>
          <button
            onClick={handleInstall}
            className="px-3 py-1.5 text-xs font-medium bg-primary text-txt-inverse rounded-lg hover:bg-primary-dark transition"
          >
            {t("common.install")}
          </button>
        </div>
      </div>
    </div>
  );
}
