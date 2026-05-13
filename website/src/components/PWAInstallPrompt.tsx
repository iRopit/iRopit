"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const CheckIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M2 5L4 7L8 3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [visible, setVisible] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    // Don't show if user dismissed before
    if (localStorage.getItem("pwa-install-dismissed")) return;
    // Don't show if already running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const handler = (e: Event) => {
      e.preventDefault();
      const prompt = e as BeforeInstallPromptEvent;
      setDeferredPrompt(prompt);
      // Only show the card when browser is actually ready to install
      setShow(true);
      setTimeout(() => setVisible(true), 80);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "accepted") {
      handleDismiss();
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => setShow(false), 350);
    localStorage.setItem("pwa-install-dismissed", "1");
  };

  if (!show) return null;

  const features = [
    t("common.pwaOffline"),
    t("common.pwaInstant"),
    t("common.pwaNoStore"),
  ];

  return (
    <div
      className="fixed bottom-4 right-4 z-50"
      style={{
        transition: "opacity 350ms ease, transform 350ms ease",
        opacity: visible ? 1 : 0,
        transform: `translateX(${visible ? "0" : "24px"})`,
      }}
    >
      <div className="relative w-52 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Gradient accent bar */}
        <div
          className="h-1 w-full"
          style={{
            background:
              "linear-gradient(to right, var(--color-primary-light), var(--color-primary), var(--color-primary-dark))",
          }}
        />

        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          aria-label={t("common.dismiss")}
          className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-surface-secondary text-txt-secondary transition-colors hover:bg-surface-tertiary hover:text-txt"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2 2L8 8M8 2L2 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="flex flex-col items-center gap-3.5 px-5 pb-5 pt-4">
          {/* App icon */}
          <div className="overflow-hidden rounded-2xl border border-border shadow-md">
            <img
              src="/icons/icon-128.png"
              alt="iRopit"
              width={56}
              height={56}
              className="block h-14 w-14 object-cover"
            />
          </div>

          {/* Text */}
          <div className="text-center">
            <p className="text-sm font-bold tracking-wide text-txt">iRopit</p>
            <p className="mt-0.5 text-[11px] leading-snug text-txt-secondary">
              {t("common.installDescription")}
            </p>
          </div>

          {/* Feature list */}
          <ul className="w-full space-y-1.5">
            {features.map((feat) => (
              <li key={feat} className="flex items-center gap-2">
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-primary"
                  style={{ background: "var(--color-primary-soft)" }}
                >
                  <CheckIcon />
                </span>
                <span className="text-[11px] text-txt-secondary">{feat}</span>
              </li>
            ))}
          </ul>

          {/* Install button */}
          <button
            onClick={handleInstall}
            className="w-full cursor-pointer rounded-xl bg-primary py-2 text-xs font-semibold text-txt-inverse shadow-sm transition-colors hover:bg-primary-dark"
          >
            {t("common.install")}
          </button>

          {/* Dismiss text link */}
          <button
            onClick={handleDismiss}
            className="cursor-pointer text-[10px] text-txt-tertiary transition-colors hover:text-txt-secondary"
          >
            {t("common.dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}

