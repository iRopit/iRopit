"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { subscribeToSMS, type SMSConversation } from "@/services/smsService";
import { subscribeToCalls, type CallRecord } from "@/services/callService";
import {
  subscribeToNotifications,
  type NotificationItem,
} from "@/services/notificationService";
import type { DeviceInfo } from "@/services/deviceService";
import { MessageSquare, Phone, Bell, Calendar, BarChart2 } from "lucide-react";

interface DashboardOverviewTabProps {
  devices: DeviceInfo[];
}

function toDateStr(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getDefaultDates() {
  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(today.getDate() - 6);
  return {
    from: toDateStr(weekAgo.getTime()),
    to: toDateStr(today.getTime()),
  };
}

// Simple spending keywords found in banking SMS
const DEBIT_KEYWORDS = [
  "debited",
  "deducted",
  "withdrawn",
  "purchase",
  "payment",
  "spent",
  "charged",
  "خصم",
  "سحب",
  "دفع",
];
const CREDIT_KEYWORDS = [
  "credited",
  "deposit",
  "refund",
  "cashback",
  "إيداع",
  "استرداد",
];

// (?<!\w) lookbehind prevents matching digits embedded in card/account numbers
// like "XXXX1311 USD" where 1311 is part of the card number, not an amount
const AMOUNT_POS_RE =
  /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*([0-9,]+(?:\.[0-9]{1,3})?))|(?:(?<!\w)([0-9,]+(?:\.[0-9]{1,3})?)\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))/gi;

// Mask ranges like "XXXX 1234" or "****1234" before extracting amounts
const BALANCE_MASK_RE_A = /(?:X{2,}|[*]{2,})\s*\d{4,}/gi;
const BALANCE_MASK_RE_B = /\b\d{4,}\s*(?:X{2,}|[*]{2,})/gi;

function extractAmount(body: string): number | null {
  const masked = body
    .replace(BALANCE_MASK_RE_A, "MASKED")
    .replace(BALANCE_MASK_RE_B, "MASKED");
  AMOUNT_POS_RE.lastIndex = 0;
  let best: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_POS_RE.exec(masked)) !== null) {
    const raw = (m[2] || m[3] || "").replace(/,/g, "");
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0 && (best === null || val > best)) best = val;
  }
  return best;
}

function categorizeTransaction(
  body: string,
): "debit" | "credit" | "unknown" {
  const lower = body.toLowerCase();
  if (DEBIT_KEYWORDS.some((k) => lower.includes(k))) return "debit";
  if (CREDIT_KEYWORDS.some((k) => lower.includes(k))) return "credit";
  return "unknown";
}

export default function DashboardOverviewTab({
  devices,
}: DashboardOverviewTabProps) {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [conversations, setConversations] = useState<SMSConversation[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const defaults = getDefaultDates();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [appliedFrom, setAppliedFrom] = useState(defaults.from);
  const [appliedTo, setAppliedTo] = useState(defaults.to);

  useEffect(() => {
    if (!user) return;
    return subscribeToSMS(user.uid, devices, setConversations);
  }, [user, devices]);

  useEffect(() => {
    if (!user) return;
    return subscribeToCalls(user.uid, devices, setCalls);
  }, [user, devices]);

  useEffect(() => {
    if (!user) return;
    return subscribeToNotifications(user.uid, devices, setNotifications);
  }, [user, devices]);

  const { filteredStats, dateBreakdown, spendingInsights } = useMemo(() => {
    const from = new Date(appliedFrom + "T00:00:00").getTime();
    const to = new Date(appliedTo + "T23:59:59.999").getTime();

    const allMessages = conversations.flatMap((c) => c.messages);
    const filteredSms = allMessages.filter(
      (m) => m.timestamp >= from && m.timestamp <= to,
    );
    const filteredCalls = calls.filter(
      (c) => c.timestamp >= from && c.timestamp <= to,
    );
    const filteredNotifs = notifications.filter(
      (n) => n.timestamp >= from && n.timestamp <= to,
    );

    // SMS spending insights
    const debits: { amount: number; body: string; ts: number }[] = [];
    const credits: { amount: number; body: string; ts: number }[] = [];
    for (const msg of filteredSms) {
      const cat = categorizeTransaction(msg.body);
      const amount = extractAmount(msg.body);
      if (amount && amount > 0) {
        if (cat === "debit") debits.push({ amount, body: msg.body, ts: msg.timestamp });
        else if (cat === "credit") credits.push({ amount, body: msg.body, ts: msg.timestamp });
      }
    }
    const totalDebit = debits.reduce((s, d) => s + d.amount, 0);
    const totalCredit = credits.reduce((s, c) => s + c.amount, 0);

    // Per-date breakdown
    const smsByDate: Record<string, number> = {};
    for (const m of filteredSms) {
      const dk = toDateStr(m.timestamp);
      smsByDate[dk] = (smsByDate[dk] || 0) + 1;
    }
    const callsByDate: Record<string, number> = {};
    for (const c of filteredCalls) {
      const dk = toDateStr(c.timestamp);
      callsByDate[dk] = (callsByDate[dk] || 0) + 1;
    }
    const notifsByDate: Record<string, NotificationItem[]> = {};
    for (const n of filteredNotifs) {
      const dk = toDateStr(n.timestamp);
      if (!notifsByDate[dk]) notifsByDate[dk] = [];
      notifsByDate[dk].push(n);
    }

    const allDates = new Set([
      ...Object.keys(smsByDate),
      ...Object.keys(callsByDate),
      ...Object.keys(notifsByDate),
    ]);

    const breakdown = Array.from(allDates)
      .sort((a, b) => b.localeCompare(a))
      .map((dateKey) => ({
        dateKey,
        label: formatDateLabel(dateKey),
        smsCount: smsByDate[dateKey] || 0,
        callsCount: callsByDate[dateKey] || 0,
        notifsCount: (notifsByDate[dateKey] || []).length,
        topNotifs: (notifsByDate[dateKey] || [])
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 3),
      }));

    return {
      filteredStats: {
        smsCount: filteredSms.length,
        callsCount: filteredCalls.length,
        notifsCount: filteredNotifs.length,
      },
      dateBreakdown: breakdown,
      spendingInsights:
        debits.length > 0 || credits.length > 0
          ? { totalDebit, totalCredit, debitCount: debits.length, creditCount: credits.length }
          : null,
    };
  }, [conversations, calls, notifications, appliedFrom, appliedTo]);

  const handleApply = () => {
    setAppliedFrom(fromDate);
    setAppliedTo(toDate);
  };

  const handleReset = () => {
    const d = getDefaultDates();
    setFromDate(d.from);
    setToDate(d.to);
    setAppliedFrom(d.from);
    setAppliedTo(d.to);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Date Filter */}
      <div className="bg-surface border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-txt mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          {t("overview.title")}
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-txt-secondary mb-1 block">
              {t("overview.dateFrom")}
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-txt focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="text-xs text-txt-secondary mb-1 block">
              {t("overview.dateTo")}
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-txt focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={handleApply}
            className="px-4 py-2 bg-primary text-txt-inverse rounded-lg text-sm font-semibold hover:bg-primary-dark transition"
          >
            {t("overview.apply")}
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-surface-secondary text-txt rounded-lg text-sm font-medium border border-border hover:bg-surface-tertiary transition"
          >
            {t("overview.reset")}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5 text-secondary" />
          </div>
          <div>
            <p className="text-2xl font-bold text-txt">
              {filteredStats.smsCount}
            </p>
            <p className="text-xs text-txt-secondary">{t("overview.sms")}</p>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center shrink-0">
            <Phone className="w-5 h-5 text-warning" />
          </div>
          <div>
            <p className="text-2xl font-bold text-txt">
              {filteredStats.callsCount}
            </p>
            <p className="text-xs text-txt-secondary">{t("overview.calls")}</p>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-error/10 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-error" />
          </div>
          <div>
            <p className="text-2xl font-bold text-txt">
              {filteredStats.notifsCount}
            </p>
            <p className="text-xs text-txt-secondary">
              {t("overview.notifications")}
            </p>
          </div>
        </div>
      </div>

      {/* SMS Spending Insights */}
      {spendingInsights && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-primary"
            >
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            <h3 className="text-sm font-semibold text-txt">
              {t("overview.spendingInsights")}
            </h3>
          </div>
          <div className="p-4 grid grid-cols-2 gap-4">
            <div className="bg-error/5 border border-error/20 rounded-xl p-3">
              <p className="text-xs text-txt-secondary mb-1">
                Total Debits ({spendingInsights.debitCount} txn)
              </p>
              <p className="text-lg font-bold text-error">
                {spendingInsights.totalDebit.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="bg-success/5 border border-success/20 rounded-xl p-3">
              <p className="text-xs text-txt-secondary mb-1">
                Total Credits ({spendingInsights.creditCount} txn)
              </p>
              <p className="text-lg font-bold text-success">
                {spendingInsights.totalCredit.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Per-date Breakdown */}
      {dateBreakdown.length > 0 ? (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-txt">
              {t("overview.notifByDate")}
            </h3>
          </div>
          <div className="divide-y divide-border">
            {dateBreakdown.map(
              ({ dateKey, label, smsCount, callsCount, notifsCount, topNotifs }) => (
                <div key={dateKey} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-semibold text-txt">{label}</p>
                    <div className="flex items-center gap-2">
                      {smsCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-secondary/10 text-secondary text-[10px] font-semibold">
                          {smsCount} SMS
                        </span>
                      )}
                      {callsCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-semibold">
                          {callsCount} calls
                        </span>
                      )}
                      {notifsCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-error/10 text-error text-[10px] font-semibold">
                          {notifsCount} notifs
                        </span>
                      )}
                    </div>
                  </div>
                  {topNotifs.length > 0 && (
                    <div className="space-y-1">
                      {topNotifs.map((n) => (
                        <div
                          key={`${n.id}-${n.deviceId}`}
                          className="text-[11px] text-txt-secondary"
                        >
                          <span className="text-primary font-medium">
                            {n.appName}
                          </span>
                          {n.title ? ` · ${n.title}` : ""}
                          {n.body
                            ? ` — ${n.body.slice(0, 80)}${n.body.length > 80 ? "..." : ""}`
                            : ""}
                        </div>
                      ))}
                      {notifsCount > 3 && (
                        <p className="text-[10px] text-txt-tertiary">
                          +{notifsCount - 3} more
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <BarChart2 className="w-10 h-10 text-txt-tertiary mx-auto mb-3" />
          <p className="text-sm font-medium text-txt mb-1">
            {t("overview.noData")}
          </p>
          <p className="text-xs text-txt-secondary">{t("overview.selectRange")}</p>
        </div>
      )}
    </div>
  );
}
