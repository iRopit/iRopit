"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  registerWebDevice,
  getUserDevices,
  updateDeviceStatus,
  getWebDeviceId,
  type DeviceInfo,
} from "@/services/deviceService";
import Sidebar, { type TabId } from "@/components/dashboard/Sidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import ChatTab from "@/components/dashboard/ChatTab";
import SMSTab from "@/components/dashboard/SMSTab";
import CallsTab from "@/components/dashboard/CallsTab";
import NotificationsTab from "@/components/dashboard/NotificationsTab";
import DevicesTab from "@/components/dashboard/DevicesTab";
import SettingsTab from "@/components/dashboard/SettingsTab";
import DashboardOverviewTab from "@/components/dashboard/DashboardOverviewTab";
import {
  MessageCircle,
  MessageSquare,
  Phone,
  Bell,
  Smartphone,
  Settings,
  LayoutDashboard,
  Layers,
  Monitor,
  Chrome,
} from "lucide-react";

function getPlatformIcon(platform: string) {
  const p = (platform || "").toLowerCase();
  if (p.includes("chrome") || p.includes("ext")) return <Chrome className="w-3.5 h-3.5 shrink-0" />;
  if (p.includes("web")) return <Monitor className="w-3.5 h-3.5 shrink-0" />;
  return <Smartphone className="w-3.5 h-3.5 shrink-0" />;
}

export default function DashboardPage() {  const { user } = useAuth();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [badges] = useState({
    overview: 0,
    chat: 0,
    sms: 0,
    calls: 0,
    notifications: 0,
    devices: 0,
    settings: 0,
  });

  // Register web device on mount
  useEffect(() => {
    if (!user) return;

    const init = async () => {
      await registerWebDevice(user.uid);
      const devs = await getUserDevices(user.uid);
      setDevices(devs);
    };
    init();

    // Update status on visibility change
    const handleVisibility = () => {
      const deviceId = getWebDeviceId();
      if (deviceId) {
        updateDeviceStatus(deviceId, !document.hidden);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Mark online on mount, offline on unload
    const deviceId = getWebDeviceId();
    if (deviceId) updateDeviceStatus(deviceId, true);

    const handleBeforeUnload = () => {
      if (deviceId) updateDeviceStatus(deviceId, false);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (deviceId) updateDeviceStatus(deviceId, false);
    };
  }, [user]);

  const refreshDevices = useCallback(async () => {
    if (!user) return;
    const devs = await getUserDevices(user.uid);
    setDevices(devs);
  }, [user]);

  // Only mobile devices for SMS/Calls/Notifications
  const mobileDevices = devices.filter((d) => {
    const p = (d.platform || "").toLowerCase();
    const tp = (d.type || "").toLowerCase();
    return (
      p !== "web" &&
      p !== "chrome-extension" &&
      tp !== "web" &&
      tp !== "chrome-extension"
    );
  });

  // Filter devices based on selection for SMS/Calls/Notifications
  const filteredMobileDevices =
    deviceFilter === "all"
      ? mobileDevices
      : mobileDevices.filter((d) => d.id === deviceFilter);

  // Chat sidebar should include chrome-extension devices too — exclude only
  // the current web device (which is "you"), keeping mobile + chrome ext.
  const currentWebDeviceId = getWebDeviceId();
  const chatSidebarDevices = devices.filter((d) => {
    if (d.id === currentWebDeviceId) return false;
    const p = (d.platform || "").toLowerCase();
    const tp = (d.type || "").toLowerCase();
    // Exclude other web devices (only show mobile + chrome extension)
    return p !== "web" && tp !== "web";
  });

  const renderTab = () => {
    switch (activeTab) {
      case "overview":
        return <DashboardOverviewTab devices={filteredMobileDevices} />;
      case "chat":
        return <ChatTab deviceFilter={deviceFilter} />;
      case "sms":
        return <SMSTab devices={filteredMobileDevices} />;
      case "calls":
        return <CallsTab devices={filteredMobileDevices} />;
      case "notifications":
        return <NotificationsTab devices={filteredMobileDevices} />;
      case "devices":
        return <DevicesTab devices={devices} onRefresh={refreshDevices} />;
      case "settings":
        return <SettingsTab />;
    }
  };

  const mobileTabIcons: Record<TabId, typeof MessageCircle> = {
    overview: LayoutDashboard,
    chat: MessageCircle,
    sms: MessageSquare,
    calls: Phone,
    notifications: Bell,
    devices: Smartphone,
    settings: Settings,
  };

  return (
    <div className="dashboard-viewport">
      <div className="dashboard-shell">
        <div className="flex flex-col h-full bg-bg text-txt relative">
          {/* Gradient header */}
          <DashboardHeader
            onOpenSettings={() => setActiveTab("settings")}
          />

          {/* Horizontal tab bar */}
          <Sidebar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            badges={badges}
          />

          {/* Tab content with vertical device sidebar */}
          <main className="flex-1 flex min-h-0 bg-bg pb-16 md:pb-0 overflow-hidden">
            {/* Vertical device sidebar — shown for tabs that use device filtering */}
            {(["chat", "sms", "calls", "notifications", "overview"] as const).includes(activeTab as never) &&
              (activeTab === "chat" ? chatSidebarDevices.length > 0 : mobileDevices.length > 0) && (
              <aside className="hidden md:flex flex-col w-[200px] min-w-[200px] shrink-0 border-e border-border bg-surface overflow-y-auto">
                <div className="p-2 flex flex-col gap-1">
                  <button
                    onClick={() => setDeviceFilter("all")}
                    className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold text-start transition-all ${
                      deviceFilter === "all"
                        ? "bg-primary text-txt-inverse"
                        : "text-txt-secondary hover:bg-hover hover:text-txt"
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{t("chat.allDevices")}</span>
                  </button>
                  {(activeTab === "chat" ? chatSidebarDevices : mobileDevices).map((dev) => (
                    <button
                      key={dev.id}
                      onClick={() => setDeviceFilter(dev.id)}
                      className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold text-start transition-all ${
                        deviceFilter === dev.id
                          ? "bg-primary text-txt-inverse"
                          : "text-txt-secondary hover:bg-hover hover:text-txt"
                      }`}
                    >
                      {getPlatformIcon(dev.platform || "")}
                      <span className="truncate">{dev.name || dev.platform || dev.id}</span>
                    </button>
                  ))}
                </div>
              </aside>
            )}
            {/* Tab content */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {renderTab()}
            </div>
          </main>

          {/* Mobile bottom bar */}
          <div className="absolute bottom-0 inset-x-0 md:hidden bg-surface/90 backdrop-blur-lg border-t border-border z-40">
            <div className="flex items-center justify-around h-16">
          {(
            [
              "notifications",
              "sms",
              "chat",
              "calls",
              "overview",
            ] as TabId[]
          ).map((tab) => {
            const active = activeTab === tab;
            const Icon = mobileTabIcons[tab];
            const badge = badges[tab] || 0;

              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
                    active ? "text-primary" : "text-txt-tertiary"
                  }`}
                >
                  {active && (
                    <div className="absolute top-0 w-8 h-0.5 bg-primary rounded-b" />
                  )}
                  <div className="relative">
                    <Icon className={`w-5 h-5 ${active ? "stroke-[2.5]" : ""}`} />
                    {badge > 0 && (
                      <span className="absolute -top-1.5 -end-2 min-w-[16px] h-4 flex items-center justify-center px-1 rounded-full bg-error text-white text-[10px] font-bold">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[10px] ${active ? "font-semibold" : "font-medium"}`}
                  >
                    {t(`tabs.${tab}`)}
                  </span>
                </button>
              );
          })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
