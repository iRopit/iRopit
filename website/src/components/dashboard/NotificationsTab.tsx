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
import { Bell, Search } from "lucide-react";

interface NotificationsTabProps {
  devices: DeviceInfo[];
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

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToNotifications(user.uid, devices, (notifs) => {
      setNotifications(notifs);
      markAllNotificationsAsRead(user.uid, notifs).catch(() => {});
    });
    return unsub;
  }, [user, devices]);

  const filtered = search
    ? notifications.filter(
        (n) =>
          n.title.toLowerCase().includes(search.toLowerCase()) ||
          n.body.toLowerCase().includes(search.toLowerCase()) ||
          n.appName.toLowerCase().includes(search.toLowerCase()),
      )
    : notifications;

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
    <div className="flex-1 flex flex-col min-h-0">
      {/* Search */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-txt-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("notifications.searchNotifications")}
            className="w-full ps-10 pe-4 py-2 bg-surface-secondary border border-border rounded-full text-sm text-txt placeholder:text-txt-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
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
              className="flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-surface-secondary transition-colors"
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
