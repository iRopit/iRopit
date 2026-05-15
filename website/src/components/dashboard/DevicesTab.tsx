"use client";

import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  getUserDevices,
  getWebDeviceId,
  deleteDevice,
  type DeviceInfo,
} from "@/services/deviceService";
import { Smartphone, Monitor, Chrome, Wifi, WifiOff, Trash2 } from "lucide-react";

interface DevicesTabProps {
  devices: DeviceInfo[];
  onRefresh: () => void;
}

function formatLastActive(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function getPlatformIcon(platform: string) {
  switch (platform) {
    case "android":
    case "ios":
      return Smartphone;
    case "chrome-extension":
      return Chrome;
    case "web":
      return Monitor;
    default:
      return Smartphone;
  }
}

function getPlatformLabel(
  platform: string,
  t: (key: string) => string,
): string {
  switch (platform) {
    case "android":
      return t("devices.android");
    case "ios":
      return t("devices.ios");
    case "chrome-extension":
      return t("devices.chromeExtension");
    case "web":
      return t("devices.webBrowser");
    default:
      return platform;
  }
}

export default function DevicesTab({ devices, onRefresh }: DevicesTabProps) {
  const { t } = useLanguage();
  const webDeviceId = getWebDeviceId();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(deviceId: string) {
    setDeleting(true);
    try {
      await deleteDevice(deviceId);
      onRefresh();
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  }

  if (devices.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Smartphone className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-txt mb-2">
          {t("devices.noDevices")}
        </h3>
        <p className="text-sm text-txt-secondary max-w-sm">
          {t("empty.devices")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid gap-3">
        {devices.map((device) => {
          const Icon = getPlatformIcon(device.platform);
          const isCurrentDevice = device.id === webDeviceId;
          const isOnline = device.isOnline;

          return (
            <div
              key={device.id}
              className={`flex items-center gap-4 p-4 rounded-[var(--radius)] border transition-colors ${
                isCurrentDevice
                  ? "border-primary/30 bg-primary/5"
                  : "border-border bg-surface hover:bg-surface-secondary"
              }`}
            >
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                  isOnline ? "bg-success/10" : "bg-surface-secondary"
                }`}
              >
                <Icon
                  className={`w-6 h-6 ${isOnline ? "text-success" : "text-txt-tertiary"}`}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-txt truncate">
                    {device.name}
                  </p>
                  {isCurrentDevice && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      {t("devices.thisDevice")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-txt-secondary mt-0.5">
                  {getPlatformLabel(device.platform, t)}
                </p>
              </div>

              <div className="text-end shrink-0 flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {isOnline ? (
                    <>
                      <Wifi className="w-3.5 h-3.5 text-success" />
                      <span className="text-xs font-medium text-success">
                        {t("devices.online")}
                      </span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-3.5 h-3.5 text-txt-tertiary" />
                      <span className="text-xs text-txt-tertiary">
                        {t("devices.offline")}
                      </span>
                    </>
                  )}
                </div>
                {device.lastActiveAt && (
                  <p className="text-[10px] text-txt-tertiary">
                    {t("devices.lastActive")}:{" "}
                    {formatLastActive(device.lastActiveAt)}
                  </p>
                )}
                {!isCurrentDevice && (
                  confirmDeleteId === device.id ? (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[10px] text-txt-secondary">{t("devices.removeConfirm")}</span>
                      <button
                        onClick={() => handleDelete(device.id)}
                        disabled={deleting}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-error/10 text-error hover:bg-error/20 font-medium"
                      >
                        {t("common.confirm")}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={deleting}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-txt-secondary hover:bg-border"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(device.id)}
                      className="mt-1 p-1 rounded text-txt-tertiary hover:text-error hover:bg-error/10 transition-colors"
                      title={t("devices.remove")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
