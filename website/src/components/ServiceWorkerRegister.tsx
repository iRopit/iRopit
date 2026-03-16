"use client";

import { useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";

export default function ServiceWorkerRegister() {
  const { t } = useLanguage();

  const showToast = useCallback((message: string, action?: { label: string; onClick: () => void }) => {
    // Remove existing toast
    const existing = document.getElementById("sw-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "sw-toast";
    toast.style.cssText =
      "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;padding:12px 20px;border-radius:12px;background:#1f2937;color:#fff;font-size:14px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:90vw;";
    
    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);

    if (action) {
      const btn = document.createElement("button");
      btn.textContent = action.label;
      btn.style.cssText =
        "background:#D5C19E;color:#1f2937;border:none;padding:4px 12px;border-radius:6px;font-weight:600;cursor:pointer;white-space:nowrap;font-size:13px;";
      btn.onclick = action.onClick;
      toast.appendChild(btn);
    }

    document.body.appendChild(toast);

    if (!action) {
      setTimeout(() => toast.remove(), 4000);
    }
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Register service worker with update handling
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // Check for updates periodically (every 60 minutes)
        const interval = setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New SW installed, prompt user to reload
              showToast(t("common.updateAvailable"), {
                label: t("common.reload"),
                onClick: () => {
                  newWorker.postMessage({ type: "SKIP_WAITING" });
                  window.location.reload();
                },
              });
            }
          });
        });

        return () => clearInterval(interval);
      })
      .catch((err) => {
        console.log("SW registration failed:", err);
      });

    // Listen for controller change (new SW took over)
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    // Online/offline status
    const handleOnline = () => showToast(t("common.online"));
    const handleOffline = () => showToast(t("common.offline"));

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [t, showToast]);

  return null;
}
