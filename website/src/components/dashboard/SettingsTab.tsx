"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  auth,
  updateProfile,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "@/lib/firebase";
import {
  User,
  Globe,
  Moon,
  Sun,
  Lock,
  Shield,
  Info,
  ChevronRight,
  Check,
  AlertTriangle,
  Palette,
  Languages,
  Bell,
  Eye,
  EyeOff,
} from "lucide-react";

export default function SettingsTab() {
  const { user } = useAuth();
  const { t, language, setLanguage, isRTL } = useLanguage();

  // Profile
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Password
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  // Theme
  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark")
        ? "dark"
        : "light";
    }
    return "light";
  });

  const setTheme = (t: "light" | "dark") => {
    setThemeState(t);
    if (t === "dark") {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  // Active section for mobile
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const isGoogleUser = user?.providerData?.[0]?.providerId === "google.com";

  // Save display name
  const handleSaveProfile = async () => {
    if (!auth.currentUser || !displayName.trim()) return;
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await updateProfile(auth.currentUser, {
        displayName: displayName.trim(),
      });
      setProfileMsg({ type: "success", text: t("settings.profileUpdated") });
    } catch {
      setProfileMsg({ type: "error", text: t("errors.unknown") });
    } finally {
      setProfileSaving(false);
    }
  };

  // Change password
  const handleChangePassword = async () => {
    if (!auth.currentUser || !auth.currentUser.email) return;
    setPasswordMsg(null);

    if (newPassword.length < 6) {
      setPasswordMsg({ type: "error", text: t("errors.weakPassword") });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({
        type: "error",
        text: t("settings.passwordsMismatch"),
      });
      return;
    }

    setPasswordSaving(true);
    try {
      const credential = EmailAuthProvider.credential(
        auth.currentUser.email,
        currentPassword,
      );
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPassword);
      setPasswordMsg({
        type: "success",
        text: t("settings.passwordChanged"),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordSection(false);
    } catch {
      setPasswordMsg({
        type: "error",
        text: t("settings.wrongCurrentPassword"),
      });
    } finally {
      setPasswordSaving(false);
    }
  };

  const initials = user?.displayName
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || "?";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4 lg:p-6 space-y-4">
        {/* Page title */}
        <div className="mb-2">
          <h1 className="text-xl font-bold text-txt">{t("settings.title")}</h1>
          <p className="text-sm text-txt-secondary mt-0.5">
            {t("settings.subtitle")}
          </p>
        </div>

        {/* ─── Profile Section ─── */}
        <section className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <User className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-sm font-semibold text-txt">
                {t("settings.profile")}
              </h2>
            </div>

            {/* Avatar + info */}
            <div className="flex items-center gap-4 mb-5">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  className="w-16 h-16 rounded-2xl object-cover ring-2 ring-primary/20"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center">
                  <span className="text-txt-inverse text-xl font-bold">
                    {initials}
                  </span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-txt truncate">
                  {user?.displayName || t("settings.noName")}
                </p>
                <p className="text-xs text-txt-secondary truncate">
                  {user?.email}
                </p>
                {isGoogleUser && (
                  <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-info/10 text-info text-[10px] font-medium">
                    <Globe className="w-3 h-3" />
                    Google
                  </span>
                )}
              </div>
            </div>

            {/* Display name field */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-txt-secondary">
                {t("settings.displayName")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="flex-1 px-3 py-2 bg-bg border border-border rounded-xl text-sm text-txt placeholder:text-txt-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  placeholder={t("settings.displayName")}
                />
                <button
                  onClick={handleSaveProfile}
                  disabled={
                    profileSaving || displayName.trim() === user?.displayName
                  }
                  className="px-4 py-2 bg-primary text-txt-inverse text-sm font-medium rounded-xl hover:bg-primary-dark transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {profileSaving ? (
                    <div className="w-4 h-4 border-2 border-txt-inverse/30 border-t-txt-inverse rounded-full animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {t("common.save")}
                </button>
              </div>

              {profileMsg && (
                <p
                  className={`text-xs flex items-center gap-1 ${profileMsg.type === "success" ? "text-success" : "text-error"}`}
                >
                  {profileMsg.type === "success" ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <AlertTriangle className="w-3 h-3" />
                  )}
                  {profileMsg.text}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ─── Security Section ─── */}
        {!isGoogleUser && (
          <section className="bg-surface rounded-2xl border border-border overflow-hidden">
            <div className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-warning" />
                </div>
                <h2 className="text-sm font-semibold text-txt">
                  {t("settings.security")}
                </h2>
              </div>

              {!showPasswordSection ? (
                <button
                  onClick={() => setShowPasswordSection(true)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-bg rounded-xl hover:bg-surface-secondary transition group"
                >
                  <div className="flex items-center gap-3">
                    <Lock className="w-4 h-4 text-txt-secondary group-hover:text-txt transition" />
                    <span className="text-sm text-txt-secondary group-hover:text-txt transition">
                      {t("settings.changePassword")}
                    </span>
                  </div>
                  <ChevronRight
                    className={`w-4 h-4 text-txt-tertiary ${isRTL ? "rotate-180" : ""}`}
                  />
                </button>
              ) : (
                <div className="space-y-3">
                  {/* Current password */}
                  <div className="relative">
                    <input
                      type={showCurrentPw ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full px-3 py-2.5 pe-10 bg-bg border border-border rounded-xl text-sm text-txt placeholder:text-txt-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                      placeholder={t("settings.currentPassword")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPw(!showCurrentPw)}
                      className="absolute end-3 top-1/2 -translate-y-1/2 text-txt-tertiary hover:text-txt"
                    >
                      {showCurrentPw ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* New password */}
                  <div className="relative">
                    <input
                      type={showNewPw ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2.5 pe-10 bg-bg border border-border rounded-xl text-sm text-txt placeholder:text-txt-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                      placeholder={t("settings.newPassword")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPw(!showNewPw)}
                      className="absolute end-3 top-1/2 -translate-y-1/2 text-txt-tertiary hover:text-txt"
                    >
                      {showNewPw ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* Confirm password */}
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2.5 bg-bg border border-border rounded-xl text-sm text-txt placeholder:text-txt-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                    placeholder={t("settings.confirmPassword")}
                  />

                  {passwordMsg && (
                    <p
                      className={`text-xs flex items-center gap-1 ${passwordMsg.type === "success" ? "text-success" : "text-error"}`}
                    >
                      {passwordMsg.type === "success" ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <AlertTriangle className="w-3 h-3" />
                      )}
                      {passwordMsg.text}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowPasswordSection(false);
                        setCurrentPassword("");
                        setNewPassword("");
                        setConfirmPassword("");
                        setPasswordMsg(null);
                      }}
                      className="px-4 py-2 bg-surface-secondary text-txt-secondary text-sm font-medium rounded-xl hover:bg-surface-tertiary transition"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      onClick={handleChangePassword}
                      disabled={
                        passwordSaving ||
                        !currentPassword ||
                        !newPassword ||
                        !confirmPassword
                      }
                      className="px-4 py-2 bg-primary text-txt-inverse text-sm font-medium rounded-xl hover:bg-primary-dark transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {passwordSaving ? (
                        <div className="w-4 h-4 border-2 border-txt-inverse/30 border-t-txt-inverse rounded-full animate-spin" />
                      ) : (
                        <Lock className="w-4 h-4" />
                      )}
                      {t("settings.changePassword")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ─── Appearance Section ─── */}
        <section className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center">
                <Palette className="w-4 h-4 text-secondary" />
              </div>
              <h2 className="text-sm font-semibold text-txt">
                {t("settings.appearance")}
              </h2>
            </div>

            {/* Theme */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {theme === "dark" ? (
                    <Moon className="w-4 h-4 text-txt-secondary" />
                  ) : (
                    <Sun className="w-4 h-4 text-txt-secondary" />
                  )}
                  <span className="text-sm text-txt">{t("common.theme")}</span>
                </div>
                <div className="flex items-center bg-bg border border-border rounded-xl p-0.5">
                  <button
                    onClick={() => setTheme("light")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      theme === "light"
                        ? "bg-surface shadow-sm text-txt"
                        : "text-txt-tertiary hover:text-txt-secondary"
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5" />
                    {t("common.light")}
                  </button>
                  <button
                    onClick={() => setTheme("dark")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      theme === "dark"
                        ? "bg-surface shadow-sm text-txt"
                        : "text-txt-tertiary hover:text-txt-secondary"
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                    {t("common.dark")}
                  </button>
                </div>
              </div>

              {/* Language */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Languages className="w-4 h-4 text-txt-secondary" />
                  <span className="text-sm text-txt">
                    {t("common.language")}
                  </span>
                </div>
                <div className="flex items-center bg-bg border border-border rounded-xl p-0.5">
                  <button
                    onClick={() => setLanguage("en")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      language === "en"
                        ? "bg-surface shadow-sm text-txt"
                        : "text-txt-tertiary hover:text-txt-secondary"
                    }`}
                  >
                    English
                  </button>
                  <button
                    onClick={() => setLanguage("ar")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      language === "ar"
                        ? "bg-surface shadow-sm text-txt"
                        : "text-txt-tertiary hover:text-txt-secondary"
                    }`}
                  >
                    العربية
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── About Section ─── */}
        <section className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center">
                <Info className="w-4 h-4 text-info" />
              </div>
              <h2 className="text-sm font-semibold text-txt">
                {t("settings.about")}
              </h2>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between px-4 py-3 bg-bg rounded-xl">
                <span className="text-sm text-txt-secondary">
                  {t("settings.version")}
                </span>
                <span className="text-sm text-txt font-medium">1.0.0</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 bg-bg rounded-xl">
                <span className="text-sm text-txt-secondary">
                  {t("settings.platform")}
                </span>
                <span className="text-sm text-txt font-medium">
                  Web Dashboard
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 bg-bg rounded-xl">
                <span className="text-sm text-txt-secondary">
                  {t("settings.loggedInAs")}
                </span>
                <span className="text-sm text-txt font-medium truncate max-w-[200px]">
                  {user?.email}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
