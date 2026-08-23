export type DesktopSmartSettingKey =
  | "smartAction_copyOtp"
  | "smartAction_openUrls"
  | "smartAction_incomingCallPopup"
  | "smartAction_outgoingCallPopup";

export interface DesktopSmartSettings {
  smartAction_copyOtp: boolean;
  smartAction_openUrls: boolean;
  smartAction_incomingCallPopup: boolean;
  smartAction_outgoingCallPopup: boolean;
}

const DEFAULT_SETTINGS: DesktopSmartSettings = {
  smartAction_copyOtp: true,
  smartAction_openUrls: true,
  smartAction_incomingCallPopup: true,
  smartAction_outgoingCallPopup: true,
};

const STORAGE_PREFIX = "iropit:";
const SETTINGS_CHANGED_EVENT = "iropit:desktop-settings-changed";

function getStorageKey(key: DesktopSmartSettingKey): string {
  return `${STORAGE_PREFIX}${key}`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readSingleSetting(key: DesktopSmartSettingKey): boolean {
  if (!canUseStorage()) return DEFAULT_SETTINGS[key];

  const raw = localStorage.getItem(getStorageKey(key));
  if (raw === null) return DEFAULT_SETTINGS[key];
  return raw === "true";
}

export function getDesktopSettings(): DesktopSmartSettings {
  return {
    smartAction_copyOtp: readSingleSetting("smartAction_copyOtp"),
    smartAction_openUrls: readSingleSetting("smartAction_openUrls"),
    smartAction_incomingCallPopup: readSingleSetting("smartAction_incomingCallPopup"),
    smartAction_outgoingCallPopup: readSingleSetting("smartAction_outgoingCallPopup"),
  };
}

export function getDesktopSetting(key: DesktopSmartSettingKey): boolean {
  return readSingleSetting(key);
}

export function setDesktopSetting(
  key: DesktopSmartSettingKey,
  value: boolean,
): void {
  if (!canUseStorage()) return;

  localStorage.setItem(getStorageKey(key), String(Boolean(value)));
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
}

export function initializeDesktopSettingsDefaults(): void {
  if (!canUseStorage()) return;

  (Object.keys(DEFAULT_SETTINGS) as DesktopSmartSettingKey[]).forEach((key) => {
    const storageKey = getStorageKey(key);
    if (localStorage.getItem(storageKey) === null) {
      localStorage.setItem(storageKey, String(DEFAULT_SETTINGS[key]));
    }
  });
}

export function subscribeDesktopSettings(
  callback: (settings: DesktopSmartSettings) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const emit = () => callback(getDesktopSettings());
  const handleChange = () => emit();
  const handleStorage = (e: StorageEvent) => {
    if (!e.key || !e.key.startsWith(STORAGE_PREFIX)) return;
    emit();
  };

  window.addEventListener(SETTINGS_CHANGED_EVENT, handleChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(SETTINGS_CHANGED_EVENT, handleChange);
    window.removeEventListener("storage", handleStorage);
  };
}
