"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  LogOut,
  RefreshCw,
  ChevronDown,
  Sun,
  Moon,
  Settings,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface DashboardHeaderProps {
  onOpenSettings?: () => void;
}

export default function DashboardHeader({
  onOpenSettings,
}: DashboardHeaderProps) {
  const { user, logout } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return saved === "dark" || (!saved && prefersDark);
  });

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  const handleThemeToggle = () => {
    const html = document.documentElement;
    const nowDark = html.classList.toggle("dark");
    setIsDark(nowDark);
    localStorage.setItem("theme", nowDark ? "dark" : "light");
  };

  const initials = user?.displayName
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || "?";

  return (
    <header
      className="shrink-0 shadow-md"
      style={{
        background:
          "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)",
      }}
    >
      {/* Top row: logo + actions */}
      <div className="h-14 flex items-center justify-between px-4 lg:px-6">
        {/* Left: Logo */}
        <a
          href="https://www.iropit.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 no-underline"
        >
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
            <span className="text-white text-sm font-bold tracking-tight">
              iR
            </span>
          </div>
          <span className="text-white text-lg font-bold tracking-tight hidden sm:block">
            iRopit
          </span>
        </a>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {/* Language toggle */}
          <button
            onClick={() => setLanguage(language === "en" ? "ar" : "en")}
            className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-sm)] bg-white/10 hover:bg-white/20 transition text-white text-xs font-bold backdrop-blur-sm"
            title={t("common.language")}
          >
            {language === "en" ? "AR" : "EN"}
          </button>

          <button
            onClick={() => window.location.reload()}
            className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-sm)] bg-white/10 hover:bg-white/20 transition text-white backdrop-blur-sm"
            title={t("common.refresh")}
          >
            <RefreshCw className="w-4.5 h-4.5" />
          </button>

          <button
            onClick={onOpenSettings}
            className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-sm)] bg-white/10 hover:bg-white/20 transition text-white backdrop-blur-sm"
            title={t("tabs.settings")}
          >
            <Settings className="w-4.5 h-4.5" />
          </button>

          {/* Theme toggle */}
          <button
            onClick={handleThemeToggle}
            className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-sm)] bg-white/10 hover:bg-white/20 transition text-white backdrop-blur-sm"
            title={t("common.theme")}
          >
            {isDark ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
          </button>

          {/* User dropdown */}
          <div className="relative ms-1">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-white/10 hover:bg-white/20 transition text-white backdrop-blur-sm"
            >
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  className="w-6 h-6 rounded-full object-cover ring-1 ring-white/30"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-white/30 flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">
                    {initials}
                  </span>
                </div>
              )}
              <span className="hidden sm:block text-xs font-semibold">
                {user?.displayName?.split(" ")[0] || user?.email?.split("@")[0]}
              </span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute end-0 top-full mt-1.5 w-52 bg-surface border border-border rounded-xl shadow-xl z-50 py-1 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border">
                    <p className="text-xs font-semibold text-txt truncate">
                      {user?.displayName || user?.email}
                    </p>
                    <p className="text-[11px] text-txt-secondary truncate">
                      {user?.email}
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-error hover:bg-error/5 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    {t("auth.logout")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bottom row: Device filter tabs — removed (device list is now a vertical sidebar) */}
    </header>
  );
}
