"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  subscribeToNotifications,
  markAllNotificationsAsRead,
  type NotificationItem,
} from "@/services/notificationService";
import type { DeviceInfo } from "@/services/deviceService";
import { Bell, Search, CheckCheck } from "lucide-react";

interface NotificationsTabProps {
  devices: DeviceInfo[];
}

type SnoozeDuration = "1h" | "8h" | "24h" | "7d" | "permanent";

const SNOOZE_STORAGE_KEY = "iropit:notifSnoozeByApp";

function getSnoozeUntil(duration: SnoozeDuration): number {
  const now = Date.now();
  if (duration === "1h") return now + 60 * 60 * 1000;
  if (duration === "8h") return now + 8 * 60 * 60 * 1000;
  if (duration === "24h") return now + 24 * 60 * 60 * 1000;
  if (duration === "7d") return now + 7 * 24 * 60 * 60 * 1000;
  return -1;
}

function readSnoozeMap(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SNOOZE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function isMutedApp(appName: string, snoozeMap: Record<string, number>): boolean {
  const until = snoozeMap[appName];
  if (!until) return false;
  if (until === -1) return true;
  return until > Date.now();
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 172800000) return "Yesterday";
  return d.toLocaleDateString();
}

// Map common app package names to user-friendly labels
function getAppLabel(appName: string): string {
  const map: Record<string, string> = {
    "com.whatsapp": "WhatsApp",
    "org.telegram.messenger": "Telegram",
    "com.facebook.orca": "Messenger",
    "com.instagram.android": "Instagram",
    "com.twitter.android": "Twitter",
    "com.snapchat.android": "Snapchat",
  };
  return map[appName] || appName;
}

function getAppColor(appName: string): string {
  const lower = appName.toLowerCase();
  if (lower.includes("whatsapp")) return "bg-green-500";
  if (lower.includes("telegram")) return "bg-blue-500";
  if (lower.includes("messenger") || lower.includes("facebook"))
    return "bg-blue-600";
  if (lower.includes("instagram")) return "bg-pink-500";
  if (lower.includes("twitter") || lower.includes("x")) return "bg-gray-800";
  if (lower.includes("snapchat")) return "bg-yellow-400";
  return "bg-primary";
}

export default function NotificationsTab({ devices }: NotificationsTabProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [search, setSearch] = useState("");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [snoozeMap, setSnoozeMap] = useState<Record<string, number>>({});
  const [selectedApp, setSelectedApp] = useState("");
  const [selectedDuration, setSelectedDuration] =
    useState<SnoozeDuration>("1h");

  useEffect(() => {
    const stored = readSnoozeMap();
    const now = Date.now();
    const cleaned: Record<string, number> = {};
    Object.entries(stored).forEach(([app, until]) => {
      if (until === -1 || until > now) cleaned[app] = until;
    });
    setSnoozeMap(cleaned);
    localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(cleaned));
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToNotifications(user.uid, devices, (notifs) => {
      setNotifications(notifs);
    });
    return unsub;
  }, [user, devices]);

  const handleMarkAllRead = () => {
    if (!user) return;
    markAllNotificationsAsRead(user.uid, notifications).catch(() => {});
  };

  const handleSnooze = () => {
    if (!selectedApp) return;
    const next = {
      ...snoozeMap,
      [selectedApp]: getSnoozeUntil(selectedDuration),
    };
    setSnoozeMap(next);
    localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(next));
  };

  const handleUnmute = () => {
    if (!selectedApp) return;
    const next = { ...snoozeMap };
    delete next[selectedApp];
    setSnoozeMap(next);
    localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(next));
  };

  const uniqueApps = Array.from(
    new Set(notifications.map((n) => n.appName || "System")),
  ).sort((a, b) => a.localeCompare(b));

  const mutedAppsCount = uniqueApps.filter((app) => isMutedApp(app, snoozeMap)).length;

  useEffect(() => {
    if (!selectedApp && uniqueApps.length > 0) {
      setSelectedApp(uniqueApps[0]);
    }
  }, [selectedApp, uniqueApps]);

  const filtered = (() => {
    let result = search
      ? notifications.filter(
          (n) =>
            n.title.toLowerCase().includes(search.toLowerCase()) ||
            n.body.toLowerCase().includes(search.toLowerCase()) ||
            n.appName.toLowerCase().includes(search.toLowerCase()),
        )
      : notifications;

    result = result.filter((n) => !isMutedApp(n.appName || "System", snoozeMap));

    if (showUnreadOnly) {
      result = result.filter((n) => n.read === false);
    }
    return result;
  })();

  if (notifications.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Bell className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-txt mb-2">
          {t("notifications.noNotifications")}
        </h3>
        <p className="text-sm text-txt-secondary max-w-sm">
          {t("empty.notifications")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      {/* Search + filters toolbar */}
      <div className="p-3 border-b border-border flex flex-col gap-2 bg-surface">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-txt-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("notifications.searchNotifications")}
            className="w-full ps-10 pe-4 py-2 bg-surface-secondary border border-border rounded-full text-sm text-txt placeholder:text-txt-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <button
          onClick={() => setShowUnreadOnly((v) => !v)}
          className={`px-3 py-2 rounded-full text-xs font-medium border transition-colors shrink-0 ${
            showUnreadOnly
              ? "bg-primary/15 border-primary/40 text-primary"
              : "bg-surface-secondary border-border text-txt-secondary hover:bg-surface-tertiary"
          }`}
        >
          {t("notifications.showUnread")}
        </button>
        <button
          onClick={handleMarkAllRead}
          title={t("notifications.markAllRead")}
          className="p-2 rounded-full bg-surface-secondary border border-border text-txt-secondary hover:bg-surface-tertiary transition-colors shrink-0"
        >
          <CheckCheck className="w-4 h-4" />
        </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedApp}
            onChange={(e) => setSelectedApp(e.target.value)}
            className="px-3 py-2 bg-surface-secondary border border-border rounded-full text-xs text-txt"
          >
            {uniqueApps.map((app) => (
              <option key={app} value={app}>
                {getAppLabel(app)}
              </option>
            ))}
          </select>

          <select
            value={selectedDuration}
            onChange={(e) => setSelectedDuration(e.target.value as SnoozeDuration)}
            className="px-3 py-2 bg-surface-secondary border border-border rounded-full text-xs text-txt"
          >
            <option value="1h">{t("notifications.snooze1h")}</option>
            <option value="8h">{t("notifications.snooze8h")}</option>
            <option value="24h">{t("notifications.snooze24h")}</option>
            <option value="7d">{t("notifications.snooze7d")}</option>
            <option value="permanent">{t("notifications.snoozePermanent")}</option>
          </select>

          <button
            onClick={handleSnooze}
            disabled={!selectedApp}
            className="px-3 py-2 rounded-full text-xs font-medium border border-border bg-surface-secondary text-txt-secondary hover:bg-surface-tertiary disabled:opacity-50"
          >
            {t("notifications.muteApp")}
          </button>

          <button
            onClick={handleUnmute}
            disabled={!selectedApp || !isMutedApp(selectedApp, snoozeMap)}
            className="px-3 py-2 rounded-full text-xs font-medium border border-border bg-surface-secondary text-txt-secondary hover:bg-surface-tertiary disabled:opacity-50"
          >
            {t("notifications.unmuteApp")}
          </button>

          <span className="text-[11px] text-txt-tertiary">
            {t("notifications.mutedApps", { count: mutedAppsCount })}
          </span>
        </div>
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((notif) => {
          const label = getAppLabel(notif.appName);
          const color = getAppColor(notif.appName);

          return (
            <div
              key={`${notif.id}-${notif.deviceId}`}
              className="flex items-start gap-3 px-4 py-2.5 border-b border-border/60 hover:bg-hover transition-colors"
            >
              <div
                className={`w-10 h-10 rounded-full ${color} flex items-center justify-center shrink-0`}
              >
                <span className="text-white text-xs font-bold">
                  {label[0]?.toUpperCase() || "?"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-primary">{label}</p>
                  <span className="text-[11px] text-txt-tertiary shrink-0 ms-2">
                    {formatTime(notif.timestamp)}
                  </span>
                </div>
                {notif.title && (
                  <p className="text-sm font-semibold text-txt truncate mt-0.5">
                    {notif.title}
                  </p>
                )}
                {notif.body && (
                  <p className="text-xs text-txt-secondary mt-0.5 line-clamp-2">
                    {notif.body}
                  </p>
                )}
                <p className="text-[10px] text-txt-tertiary mt-1">
                  {notif.deviceName}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
