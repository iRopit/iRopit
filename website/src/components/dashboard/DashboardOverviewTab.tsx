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
import { MessageSquare, Phone, Bell, Calendar, BarChart2, Download } from "lucide-react";

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

function formatDateLabel(dateStr: string, lang?: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const locale = lang === "ar" ? "ar-EG" : undefined;
  return d.toLocaleDateString(locale, {
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

// ── SMS Spending Analysis (mirrors chrome extension dashboard.js) ─────────────

const CURRENCY_MAP: Record<string, string> = {
  SAR: "SAR", AED: "AED", KWD: "KWD", BHD: "BHD", QAR: "QAR", OMR: "OMR",
  EGP: "EGP", JOD: "JOD", USD: "USD", GBP: "GBP", EUR: "EUR", INR: "INR",
  PKR: "PKR", MYR: "MYR", TRY: "TRY",
  "$": "USD", "£": "GBP", "€": "EUR", "₹": "INR", "﷼": "SAR",
  "جم": "EGP", "ج.م": "EGP",
};

const DEBIT_KEYWORDS = /\b(debited|debit|charged|charge|paid|payment|purchase|bought|withdrawn|withdrawal|deducted|deduct|sent|used\s+for|has\s+been\s+used|transfer(?:red)?\s+(?:to|from\s+your))\b|(تم\s+خصم|خصم|دفع|سحب|رسوم|استخدام|من\s+حسابك)/i;
const CREDIT_KEYWORDS = /\b(credited|deposited|deposit|refund|cashback|returned|reversed|reversal|salary|transferred\s+to\s+your)\b|(تم\s+إيداع|إيداع|تم\s+رد|تم\s+إعادة|إعادة|استرجاع|راتب|تحويل\s+إلى|إلى\s+حسابك)/i;
const CARD_BILL_PAYMENT_RE = /\bpayment\b.{0,80}\bfor\s+card\b.{0,80}\bhas\s+been\s+processed\b/i;
const PAYMENT_RECEIVED_ON_CARD_RE = /\ba\s+payment\b.{0,120}\bhas\s+been\s+received\s+on\s+your\b/i;
const PENDING_RE = /\bwill\s+be\b|\bon\s+its\s+way\b|\bpending\b|\bprocessing\b|\bwithin\s+\d+\s+(?:business\s+)?days\b/i;

const CURR = "SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼]";

const BALANCE_MASK_RE_A = new RegExp(
  "\\b(balance|bal\\.?|avail(?:able)?\\.?|remaining|rem\\.?|limit|outstanding|due|minimum|min\\.?|opening|closing|cr\\.?\\s*bal|dr\\.?\\s*bal)" +
  "\\s*(?:is\\s+|are\\s+)?[:\\-]?\\s*" +
  "(?:(?:" + CURR + ")\\s*)?([0-9,]+(?:\\.[0-9]{1,3})?)(?:\\s*(?:" + CURR + "))?",
  "gi"
);
const BALANCE_MASK_RE_AR_A = /(الرصيد\s+المتاح|الرصيد|رصيد|الحد\s+الائتماني|الحد|المستحق|المحفوظ|رصيدك)\s*(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼جم])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|جم))?/gi;
const BALANCE_MASK_RE_B = new RegExp(
  "(?:(?:" + CURR + ")\\s*)?([0-9,]+(?:\\.[0-9]{1,3})?)(?:\\s*(?:" + CURR + "))?\\s*" +
  "(?:is\\s+(?:your\\s+|the\\s+)?)?(?:(?:current|available|total|avail|new|updated)\\s+)?" +
  "\\b(balance|bal\\b|available\\b|avail\\b|limit\\b|outstanding\\b)",
  "gi"
);
const BALANCE_MASK_RE_AR_B = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|جم|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|جم))?\s*(الرصيد\s+المتاح|الرصيد|رصيد|الحد|المستحق|المحفوظ|رصيدك)/gi;

const AMOUNT_POS_RE =
  /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|جم|ج\.م|[$£€₹﷼])\s*([0-9,]+(?:\.[0-9]{1,3})?))|(?:(?<!\w)([0-9,]+(?:\.[0-9]{1,3})?)\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|جم|ج\.م))/gi;

function isBankingSMS(body: string): boolean {
  if (!body) return false;
  const STRONG = /\b(debited|credited|transaction|txn|purchase|withdrawal|has been used|used for|pos |atm |card ending|card no|account ending|a\/c ending|a\/c no|acct no|your card|your account|bank account|dear customer|dear valued|salary|authorization code|auth code|ref no|reference no|upi|neft|rtgs|imps|swift|wire transfer|direct debit|standing order|emi|instalment|installment|cashback|refund)\b|(خصم|تحويل|سحب|رسوم|بطاقة|حساب|عميل|الراتب|استخدام|عملية|معاملة|تم\s+خصم|تم\s+تحويل)/i;
  return STRONG.test(body);
}

interface TxnResult {
  amount: number;
  currency: string;
  type: "debit" | "credit";
}

function extractTransactions(body: string): TxnResult[] {
  if (!body) return [];
  if (CARD_BILL_PAYMENT_RE.test(body)) return [];

  BALANCE_MASK_RE_A.lastIndex = 0;
  BALANCE_MASK_RE_AR_A.lastIndex = 0;
  BALANCE_MASK_RE_B.lastIndex = 0;
  BALANCE_MASK_RE_AR_B.lastIndex = 0;
  const masked = body
    .replace(BALANCE_MASK_RE_AR_A, (m) => " ".repeat(m.length))
    .replace(BALANCE_MASK_RE_AR_B, (m) => " ".repeat(m.length))
    .replace(BALANCE_MASK_RE_A, (m) => " ".repeat(m.length))
    .replace(BALANCE_MASK_RE_B, (m) => " ".repeat(m.length));

  const candidates: { amount: number; currRaw: string; pos: number }[] = [];
  let m: RegExpExecArray | null;
  AMOUNT_POS_RE.lastIndex = 0;
  while ((m = AMOUNT_POS_RE.exec(masked)) !== null) {
    const currRaw = (m[1] || m[4] || "").trim().toUpperCase();
    const amtRaw = (m[2] || m[3] || "").replace(/,/g, "");
    const amount = parseFloat(amtRaw);
    if (!isNaN(amount) && amount > 0 && currRaw) {
      candidates.push({ amount, currRaw, pos: m.index });
    }
  }
  if (candidates.length === 0) return [];

  const WINDOW = 120;
  const results: TxnResult[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    const start = Math.max(0, c.pos - WINDOW);
    const end = Math.min(masked.length, c.pos + WINDOW);
    const ctx = masked.slice(start, end);

    const isDebit = DEBIT_KEYWORDS.test(ctx);
    const isCredit = CREDIT_KEYWORDS.test(ctx);
    const isPaymentReceivedOnCard = PAYMENT_RECEIVED_ON_CARD_RE.test(ctx);

    if (!isDebit && !isCredit && !isPaymentReceivedOnCard) continue;
    if (!isDebit && isCredit && PENDING_RE.test(body)) continue;

    const type: "debit" | "credit" =
      isPaymentReceivedOnCard || (isCredit && !isDebit) ? "credit" : "debit";
    const currency = CURRENCY_MAP[c.currRaw] || c.currRaw;
    const key = `${currency}:${c.amount}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ amount: c.amount, currency, type });
  }
  return results;
}

interface CurrencyInsight {
  debit: number;
  credit: number;
}

interface SpendingInsights {
  byCurrency: Record<string, CurrencyInsight>;
  byDate: Record<string, Record<string, CurrencyInsight>>;
}

function analyzeSmsSpending(smsMessages: { body?: string; text?: string; content?: string; timestamp?: number; receivedAt?: number }[]): SpendingInsights {
  const byCurrency: Record<string, CurrencyInsight> = {};
  const byDate: Record<string, Record<string, CurrencyInsight>> = {};

  const seenBodies = new Set<string>();
  const dedupedMessages = smsMessages.filter((msg) => {
    const body = (msg.body || msg.text || msg.content || "").trim();
    if (!body) return true;
    const window5m = Math.floor((msg.timestamp || msg.receivedAt || 0) / 300000);
    const key = `${window5m}_${body}`;
    if (seenBodies.has(key)) return false;
    seenBodies.add(key);
    return true;
  });

  for (const msg of dedupedMessages) {
    const body = msg.body || msg.text || msg.content || "";
    if (!isBankingSMS(body)) continue;
    const ts = msg.timestamp || msg.receivedAt || 0;
    const txns = extractTransactions(body);
    for (const txn of txns) {
      const cur = txn.currency;
      if (!byCurrency[cur]) byCurrency[cur] = { debit: 0, credit: 0 };
      if (txn.type === "debit") byCurrency[cur].debit += txn.amount;
      if (txn.type === "credit") byCurrency[cur].credit += txn.amount;
      if (ts) {
        const dk = toDateStr(ts);
        if (!byDate[dk]) byDate[dk] = {};
        if (!byDate[dk][cur]) byDate[dk][cur] = { debit: 0, credit: 0 };
        if (txn.type === "debit") byDate[dk][cur].debit += txn.amount;
        if (txn.type === "credit") byDate[dk][cur].credit += txn.amount;
      }
    }
  }
  return { byCurrency, byDate };
}

function fmtAmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function localStampNow(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}${m}${day}_${hh}${mm}`;
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DashboardOverviewTab({
  devices,
}: DashboardOverviewTabProps) {
  const { user } = useAuth();
  const { t, language } = useLanguage();

  const [conversations, setConversations] = useState<SMSConversation[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const defaults = getDefaultDates();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [appliedFrom, setAppliedFrom] = useState(defaults.from);
  const [appliedTo, setAppliedTo] = useState(defaults.to);

  const deviceNameById = useMemo(() => {
    const map = new Map<string, string>();
    devices.forEach((d) => map.set(d.id, d.name || d.platform || d.id));
    return map;
  }, [devices]);

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

  const { filteredStats, dateBreakdown, spendingInsights, filteredSms, filteredCalls } = useMemo(() => {
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

    // Advanced SMS spending insights (per-currency, balance-masked, proximity-based)
    const { byCurrency, byDate: spendByDate } = analyzeSmsSpending(filteredSms);
    const hasCurrencies = Object.keys(byCurrency).length > 0;

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
        label: formatDateLabel(dateKey, language),
        smsCount: smsByDate[dateKey] || 0,
        callsCount: callsByDate[dateKey] || 0,
        notifsCount: (notifsByDate[dateKey] || []).length,
        topNotifs: (notifsByDate[dateKey] || [])
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 3),
        spendPills: Object.entries(spendByDate[dateKey] || {}).flatMap(([cur, { debit, credit }]) => {
          const pills: { label: string; type: "debit" | "credit" }[] = [];
          if (debit > 0) pills.push({ label: `-${cur} ${fmtAmt(debit)}`, type: "debit" });
          if (credit > 0) pills.push({ label: `+${cur} ${fmtAmt(credit)}`, type: "credit" });
          return pills;
        }),
      }));

    return {
      filteredStats: {
        smsCount: filteredSms.length,
        callsCount: filteredCalls.length,
        notifsCount: filteredNotifs.length,
      },
      dateBreakdown: breakdown,
      spendingInsights: hasCurrencies ? byCurrency : null,
      filteredSms,
      filteredCalls,
    };
  }, [conversations, calls, notifications, appliedFrom, appliedTo, language]);

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

  const handleExportSummary = () => {
    if (filteredSms.length === 0 && filteredCalls.length === 0) return;

    const suffix = appliedFrom && appliedTo ? `_${appliedFrom}_to_${appliedTo}` : "";
    const stamp = localStampNow();

    const smsHeader = ["Date", "Time", "Direction", "Contact", "Phone Number", "Message", "Device"];
    const smsRows = filteredSms.map((m) => {
      const d = new Date(m.timestamp || 0);
      const direction = String(m.type || "").toLowerCase().includes("sent") || String(m.type || "").toLowerCase().includes("out")
        ? "Sent"
        : "Received";
      const resolvedDevice = deviceNameById.get(m.deviceId) || m.deviceName || m.deviceId || "";
      return [
        d.toLocaleDateString("en-GB"),
        d.toLocaleTimeString(),
        direction,
        m.contactName || "",
        m.phoneNumber || "",
        m.body || "",
        resolvedDevice,
      ];
    });

    const callsHeader = ["Date", "Time", "Type", "Contact", "Phone Number", "Duration (s)", "Device"];
    const callsRows = filteredCalls.map((c) => {
      const d = new Date(c.timestamp || 0);
      const resolvedDevice = deviceNameById.get(c.deviceId) || c.deviceName || c.deviceId || "";
      return [
        d.toLocaleDateString("en-GB"),
        d.toLocaleTimeString(),
        c.type || "",
        c.contactName || "",
        c.phoneNumber || "",
        Number(c.duration || 0),
        resolvedDevice,
      ];
    });

    const smsCsv = [smsHeader, ...smsRows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const callsCsv = [callsHeader, ...callsRows].map((r) => r.map(csvEscape).join(",")).join("\n");

    downloadCSV(smsCsv, `iRopit-Insights-SMS${suffix}_${stamp}.csv`);
    downloadCSV(callsCsv, `iRopit-Insights-Calls${suffix}_${stamp}.csv`);
  };

  const handleExportSpending = () => {
    if (filteredSms.length === 0) return;

    const suffix = appliedFrom && appliedTo ? `_${appliedFrom}_to_${appliedTo}` : "";
    const stamp = localStampNow();
    const header = ["Date", "Time", "Currency", "Type", "Amount", "Sender", "Device", "Message"];
    const rows: Array<Array<string | number>> = [];
    const seenBodyKeys = new Set<string>();

    for (const msg of filteredSms) {
      const body = (msg.body || "").trim();
      if (!body || !isBankingSMS(body)) continue;

      const txns = extractTransactions(body);
      if (txns.length === 0) continue;

      const timeWindow = Math.floor((msg.timestamp || 0) / 300000);
      const bodyKey = `${timeWindow}_${body}`;
      if (seenBodyKeys.has(bodyKey)) continue;
      seenBodyKeys.add(bodyKey);

      const d = new Date(msg.timestamp || 0);
      const resolvedDevice = deviceNameById.get(msg.deviceId) || msg.deviceName || msg.deviceId || "";
      for (const txn of txns) {
        rows.push([
          d.toLocaleDateString("en-GB"),
          d.toLocaleTimeString(),
          txn.currency,
          txn.type === "debit" ? "Spent" : "Received",
          txn.amount,
          msg.contactName || msg.phoneNumber || "",
          resolvedDevice,
          body.replace(/\n/g, " "),
        ]);
      }
    }

    if (rows.length === 0) return;
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    downloadCSV(csv, `iRopit-Spending${suffix}_${stamp}.csv`);
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 bg-bg space-y-3">
      {/* Date Filter */}
      <div className="bg-surface border border-border rounded-lg p-3.5">
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
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="grid grid-cols-2 gap-2.5 flex-1">
        <div className="bg-surface border border-border rounded-lg p-3 flex items-center gap-3">
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
        <div className="bg-surface border border-border rounded-lg p-3 flex items-center gap-3">
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
        </div>
        <button
          onClick={handleExportSummary}
          disabled={filteredSms.length === 0 && filteredCalls.length === 0}
          title={t("overview.exportSummary")}
          className="h-[76px] sm:h-auto sm:min-w-[44px] px-3 bg-surface border border-border rounded-lg text-txt-secondary hover:text-txt hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center justify-center"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>

      {/* SMS Spending Insights — per-currency cards + spending by date */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
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
            <h3 className="text-xs font-bold uppercase tracking-wider text-txt">
              {t("overview.spendingInsights")}
            </h3>
            <button
              onClick={handleExportSpending}
              disabled={filteredSms.length === 0}
              title={t("overview.exportSpending")}
              className="ms-auto px-2.5 py-1.5 bg-surface-secondary border border-border rounded-md text-txt-secondary hover:text-txt hover:bg-surface-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center justify-center"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
          {spendingInsights ? (
            <>
          <div className="p-4 flex flex-wrap gap-3">
            {Object.entries(spendingInsights).map(([cur, { debit, credit }]) => {
              const net = credit - debit;
              const netPositive = net >= 0;
              return (
                <div
                  key={cur}
                  className="flex-1 min-w-[140px] bg-surface-secondary border border-border rounded-lg p-3"
                >
                  <p className="text-xs font-bold text-primary mb-2">{cur}</p>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-txt-secondary">{t("overview.spent")}</span>
                      <span className="text-sm font-semibold text-error">{fmtAmt(debit)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-txt-secondary">{t("overview.received")}</span>
                      <span className="text-sm font-semibold text-success">{fmtAmt(credit)}</span>
                    </div>
                    <div className="border-t border-border mt-1 pt-1 flex justify-between items-center">
                      <span className="text-[11px] text-txt-secondary">{t("overview.net")}</span>
                      <span className={`text-sm font-bold ${netPositive ? "text-success" : "text-error"}`}>
                        {netPositive ? "+" : ""}{fmtAmt(net)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Spending by Date — sub-section matching extension layout */}
          {dateBreakdown.some((d) => d.spendPills.length > 0) && (
            <>
              <div className="px-4 py-2 border-t border-border bg-surface-secondary">
                <p className="text-[10px] font-bold uppercase tracking-wider text-txt-secondary">
                  {t("overview.spendingByDate")}
                </p>
              </div>
              <div className="divide-y divide-border">
                {dateBreakdown
                  .filter((d) => d.spendPills.length > 0)
                  .map(({ dateKey, label, spendPills }) => (
                    <div key={dateKey} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <p className="text-[11px] font-semibold text-txt-secondary shrink-0">{label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {spendPills.map((pill, i) => (
                          <span
                            key={i}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              pill.type === "debit"
                                ? "bg-error/10 text-error"
                                : "bg-success/10 text-success"
                            }`}
                          >
                            {pill.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
            </>
          ) : (
            <div className="p-4">
              <div className="text-xs text-txt-secondary bg-surface-secondary border border-border rounded-lg p-3">
                {filteredSms.length > 0 ? t("overview.noFinancialSms") : t("overview.spendingEmpty")}
              </div>
            </div>
          )}
        </div>

      {/* Per-date Activity Breakdown */}
      {dateBreakdown.length > 0 ? (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-txt">
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
                          {callsCount} {t("overview.calls")}
                        </span>
                      )}
                      {notifsCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-error/10 text-error text-[10px] font-semibold">
                          {notifsCount} {t("overview.notifications")}
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
                          +{notifsCount - 3} {t("overview.more")}
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
        <div className="bg-surface border border-border rounded-lg p-8 text-center">
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