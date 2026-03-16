"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import {
  MessageCircle,
  MessageSquare,
  Phone,
  Bell,
  Smartphone,
  Settings,
} from "lucide-react";

export type TabId =
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
  color: string;
}[] = [
  { id: "chat", icon: MessageCircle, key: "tabs.chat", color: "text-info" },
  {
    id: "sms",
    icon: MessageSquare,
    key: "tabs.sms",
    color: "text-secondary",
  },
  { id: "calls", icon: Phone, key: "tabs.calls", color: "text-warning" },
  {
    id: "notifications",
    icon: Bell,
    key: "tabs.notifications",
    color: "text-error",
  },
  {
    id: "devices",
    icon: Smartphone,
    key: "tabs.devices",
    color: "text-primary",
  },
  {
    id: "settings",
    icon: Settings,
    key: "tabs.settings",
    color: "text-txt-secondary",
  },
];

export default function Sidebar({
  activeTab,
  onTabChange,
  badges,
}: SidebarProps) {
  const { t } = useLanguage();

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-60 bg-surface border-e border-border h-full shrink-0">
        {/* Logo */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-sm">
              <span className="text-txt-inverse text-sm font-bold tracking-tight">
                iR
              </span>
            </div>
            <div>
              <h2 className="text-base font-bold text-txt leading-none">
                iRopit
              </h2>
              <p className="text-[10px] text-txt-tertiary mt-0.5">Dashboard</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const badge = badges[tab.id] || 0;

            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "text-txt-secondary hover:text-txt hover:bg-surface-secondary"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    isActive ? "bg-primary/15" : "bg-transparent"
                  }`}
                >
                  <Icon className="w-[18px] h-[18px]" />
                </div>
                <span className="flex-1 text-start">{t(tab.key)}</span>
                {badge > 0 && (
                  <span
                    className={`min-w-[20px] h-5 flex items-center justify-center px-1.5 rounded-full text-xs font-bold ${
                      isActive
                        ? "bg-primary text-txt-inverse"
                        : "bg-error text-white"
                    }`}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 text-[11px] text-txt-tertiary">
            <div className="w-1.5 h-1.5 rounded-full bg-success" />
            <span>Connected</span>
          </div>
        </div>
      </aside>
    </>
  );
}
