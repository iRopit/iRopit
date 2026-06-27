"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  subscribeToCalls,
  markCallsAsViewed,
  type CallRecord,
} from "@/services/callService";
import type { DeviceInfo } from "@/services/deviceService";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Clock,
  Search,
} from "lucide-react";

interface CallsTabProps {
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

function formatDuration(seconds: number): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const callTypeConfig = {
  incoming: {
    icon: PhoneIncoming,
    color: "text-success",
    bg: "bg-success/10",
    label: "calls.incoming",
  },
  outgoing: {
    icon: PhoneOutgoing,
    color: "text-primary",
    bg: "bg-primary/10",
    label: "calls.outgoing",
  },
  missed: {
    icon: PhoneMissed,
    color: "text-error",
    bg: "bg-error/10",
    label: "calls.missed",
  },
  rejected: {
    icon: PhoneMissed,
    color: "text-warning",
    bg: "bg-warning/10",
    label: "calls.rejected",
  },
};

export default function CallsTab({ devices }: CallsTabProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [filter, setFilter] = useState<"all" | "missed">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToCalls(user.uid, devices, (newCalls) => {
      setCalls(newCalls);
    });
    return unsub;
  }, [user, devices]);

  // Mark missed calls as viewed when tab opens
  useEffect(() => {
    if (!user || calls.length === 0) return;
    const unviewed = calls.filter((c) => c.type === "missed" && !c.viewed);
    if (unviewed.length === 0) return;

    const grouped = new Map<string, string[]>();
    for (const c of unviewed) {
      const ids = grouped.get(c.deviceId) || [];
      ids.push(c.id);
      grouped.set(c.deviceId, ids);
    }
    grouped.forEach((ids, deviceId) => {
      markCallsAsViewed(user.uid, deviceId, ids);
    });
  }, [user, calls]);

  const filtered = (() => {
    let result =
      filter === "missed" ? calls.filter((c) => c.type === "missed") : calls;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.contactName.toLowerCase().includes(q) ||
          c.phoneNumber.toLowerCase().includes(q),
      );
    }
    return result;
  })();

  if (calls.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Phone className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-txt mb-2">
          {t("calls.noCalls")}
        </h3>
        <p className="text-sm text-txt-secondary max-w-sm">
          {t("empty.calls")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      {/* Filter tabs + Search */}
      <div className="flex flex-col gap-2 p-3 border-b border-border bg-surface">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
              filter === "all"
                ? "bg-primary text-txt-inverse"
                : "text-txt-secondary hover:bg-surface-secondary"
            }`}
          >
            {t("calls.allCalls")}
          </button>
          <button
            onClick={() => setFilter("missed")}
            className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
              filter === "missed"
                ? "bg-error text-white"
                : "text-txt-secondary hover:bg-surface-secondary"
            }`}
          >
            {t("calls.missedCalls")}
            {calls.filter((c) => c.type === "missed").length > 0 && (
              <span className="ms-1.5 text-xs">
                ({calls.filter((c) => c.type === "missed").length})
              </span>
            )}
          </button>
        </div>
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-txt-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("calls.searchCalls")}
            className="w-full ps-10 pe-4 py-2 bg-surface-secondary border border-border rounded-full text-sm text-txt placeholder:text-txt-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Call list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((call) => {
          const config = callTypeConfig[call.type] || callTypeConfig.incoming;
          const Icon = config.icon;

          return (
            <div
              key={call.id}
              className="flex items-center gap-3 px-4 py-2.5 border-b border-border/60 hover:bg-hover transition-colors"
            >
              <div
                className={`w-10 h-10 rounded-full ${config.bg} flex items-center justify-center shrink-0`}
              >
                <Icon className={`w-5 h-5 ${config.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-txt truncate">
                  {call.contactName}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs font-medium ${config.color}`}>
                    {t(config.label)}
                  </span>
                  {call.duration > 0 && (
                    <>
                      <span className="text-txt-tertiary text-xs">·</span>
                      <span className="text-xs text-txt-secondary flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDuration(call.duration)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-end shrink-0">
                <p className="text-[11px] text-txt-tertiary">
                  {formatTime(call.timestamp)}
                </p>
                <p className="text-[10px] text-txt-tertiary mt-0.5">
                  {call.deviceName}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
