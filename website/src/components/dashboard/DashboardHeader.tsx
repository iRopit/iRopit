"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import ThemeToggle from "@/components/ThemeToggle";
import {
  LogOut,
  Globe,
  ChevronDown,
  Layers,
  Monitor,
  Smartphone,
  Chrome,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface DeviceItem {
  id: string;
  name: string;
  platform?: string;
}

interface DashboardHeaderProps {
  devices: DeviceItem[];
  deviceFilter: string;
  onDeviceFilterChange: (id: string) => void;
}

function getPlatformIcon(platform: string) {
  const p = (platform || "").toLowerCase();
  if (p.includes("chrome") || p.includes("ext"))
    return <Chrome className="w-3.5 h-3.5" />;
  if (p.includes("web")) return <Monitor className="w-3.5 h-3.5" />;
  return <Smartphone className="w-3.5 h-3.5" />;
}

export default function DashboardHeader({
  devices,
  deviceFilter,
  onDeviceFilterChange,
}: DashboardHeaderProps) {
  const { user, logout } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);

  const handleLogout = async () => {
    await logout();
    router.push("/");
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
    <header className="bg-surface border-b border-border shrink-0">
      {/* Top row: user + actions */}
      <div className="h-14 flex items-center justify-between px-4 lg:px-6">
        {/* Left: User info */}
        <div className="flex items-center gap-3">
          <div className="relative">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                className="w-8 h-8 rounded-full object-cover ring-2 ring-primary/20"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center">
                <span className="text-txt-inverse text-xs font-bold">
                  {initials}
                </span>
              </div>
            )}
            <div className="absolute -bottom-0.5 -end-0.5 w-2.5 h-2.5 bg-success rounded-full border-2 border-surface" />
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold text-txt leading-tight">
              {user?.displayName || user?.email}
            </p>
            <p className="text-[11px] text-success font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
              {t("devices.online")}
            </p>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          <ThemeToggle />

          <button
            onClick={() => setLanguage(language === "en" ? "ar" : "en")}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-secondary transition-colors text-txt-secondary hover:text-txt"
            title={t("common.language")}
          >
            <Globe className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Profile dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-surface-secondary transition-colors text-txt-secondary hover:text-txt text-xs font-medium"
            >
              <span className="hidden sm:block">
                {user?.displayName?.split(" ")[0] || t("auth.logout")}
              </span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute end-0 top-full mt-1.5 w-48 bg-surface border border-border rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border">
                    <p className="text-xs font-medium text-txt truncate">
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

      {/* Bottom row: Device filter tabs */}
      <div className="px-4 lg:px-6 pb-2">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => onDeviceFilterChange("all")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              deviceFilter === "all"
                ? "bg-primary text-txt-inverse shadow-sm"
                : "bg-surface-secondary text-txt-secondary hover:bg-surface-tertiary hover:text-txt"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            {t("chat.allDevices")}
          </button>

          {devices.map((dev) => {
            const isActive = deviceFilter === dev.id;
            return (
              <button
                key={dev.id}
                onClick={() => onDeviceFilterChange(dev.id)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-primary text-txt-inverse shadow-sm"
                    : "bg-surface-secondary text-txt-secondary hover:bg-surface-tertiary hover:text-txt"
                }`}
              >
                {getPlatformIcon(dev.platform || "")}
                {dev.name}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
