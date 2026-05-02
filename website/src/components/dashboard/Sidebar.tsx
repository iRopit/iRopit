"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import {
  MessageCircle,
  MessageSquare,
  Phone,
  Bell,
  Smartphone,
  Settings,
  LayoutDashboard,
} from "lucide-react";

export type TabId =
  | "overview"
  | "chat"
  | "sms"
  | "calls"
  | "notifications"
  | "devices"
  | "settings";

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  badges: Record<TabId, number>;
}

const tabs: {
  id: TabId;
  icon: typeof MessageCircle;
  key: string;
}[] = [
  { id: "chat", icon: MessageCircle, key: "tabs.chat" },
  { id: "sms", icon: MessageSquare, key: "tabs.sms" },
  { id: "calls", icon: Phone, key: "tabs.calls" },
  { id: "notifications", icon: Bell, key: "tabs.notifications" },
  { id: "overview", icon: LayoutDashboard, key: "tabs.overview" },
  { id: "devices", icon: Smartphone, key: "tabs.devices" },
  { id: "settings", icon: Settings, key: "tabs.settings" },
];

export default function Sidebar({
  activeTab,
  onTabChange,
  badges,
}: SidebarProps) {
  const { t } = useLanguage();

  return (
    <nav className="bg-surface border-b border-border shrink-0">
      <div className="flex overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const badge = badges[tab.id] || 0;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex flex-col items-center gap-1 px-4 py-2.5 min-w-fit whitespace-nowrap text-[11px] font-medium transition-all border-b-2 ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-txt-secondary hover:text-txt hover:border-border"
              }`}
            >
              <div className="relative">
                <Icon className="w-[18px] h-[18px]" />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -end-2 min-w-[16px] h-4 flex items-center justify-center px-1 rounded-full bg-error text-white text-[9px] font-bold">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </div>
              <span>{t(tab.key)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
