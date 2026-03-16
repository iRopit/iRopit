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
import {
  MessageCircle,
  MessageSquare,
  Phone,
  Bell,
  Smartphone,
  Settings,
} from "lucide-react";

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabId>("notifications");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [badges, setBadges] = useState({
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
    const t = (d.type || "").toLowerCase();
    return (
      p !== "web" &&
      p !== "chrome-extension" &&
      t !== "web" &&
      t !== "chrome-extension"
    );
  });

  // All devices as simple objects for header tabs
  const deviceList = devices.map((d) => ({
    id: d.id,
    name: d.name || d.platform || d.id,
    platform: d.platform || d.type || "",
  }));

  // Filter devices based on selection for SMS/Calls/Notifications
  const filteredMobileDevices =
    deviceFilter === "all"
      ? mobileDevices
      : mobileDevices.filter((d) => d.id === deviceFilter);

  const renderTab = () => {
    switch (activeTab) {
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
    chat: MessageCircle,
    sms: MessageSquare,
    calls: Phone,
    notifications: Bell,
    devices: Smartphone,
    settings: Settings,
  };

  return (
    <div className="flex h-[100dvh] bg-bg text-txt">
      {/* Desktop sidebar */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        badges={badges}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader
          devices={deviceList}
          deviceFilter={deviceFilter}
          onDeviceFilterChange={setDeviceFilter}
        />

        {/* Tab content */}
        <main className="flex-1 flex flex-col min-h-0 bg-bg pb-16 md:pb-0">
          {renderTab()}
        </main>
      </div>

      {/* Mobile bottom bar */}
      <div className="fixed bottom-0 inset-x-0 md:hidden bg-surface/80 backdrop-blur-lg border-t border-border z-40">
        <div className="flex items-center justify-around h-16">
          {(
            ["notifications", "sms", "chat", "calls", "settings"] as TabId[]
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
  );
}
