"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X, Globe, LogOut, LayoutDashboard, User } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";

const navLinks = [
  { href: "/", labelKey: "nav.home" },
  { href: "/about", labelKey: "nav.about" },
  { href: "/services", labelKey: "nav.services" },
  { href: "/privacy-policy", labelKey: "nav.privacyPolicy" },
  { href: "/contact", labelKey: "nav.contact" },
];

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const menuRef = useRef<HTMLDivElement>(null);

  // Hide navbar on dashboard pages
  const isDashboard = pathname?.startsWith("/dashboard");
  const isAuthPage =
    pathname?.startsWith("/login") || pathname?.startsWith("/signup");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setIsOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  // Close user menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (isDashboard || isAuthPage) return null;

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-surface/90 backdrop-blur-md shadow-sm border-b border-border"
          : "bg-transparent dark:bg-bg/50 dark:backdrop-blur-sm"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 lg:h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-primary flex items-center justify-center overflow-hidden">
              <Image
                src="/logo.png"
                alt="iRopit"
                width={28}
                height={28}
                className="object-contain"
              />
            </div>
            <span className="text-xl font-bold text-txt group-hover:text-primary transition-colors">
              iRopit
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "text-primary bg-primary-soft"
                    : "text-txt-secondary hover:text-txt hover:bg-surface-secondary"
                }`}
              >
                {t(link.labelKey)}
              </Link>
            ))}
          </div>

          {/* Desktop Actions */}
          <div className="hidden lg:flex items-center gap-3">
            <button
              onClick={() => setLanguage(language === "en" ? "ar" : "en")}
              className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-surface-secondary transition-colors text-txt-secondary hover:text-txt"
              title={language === "en" ? "العربية" : "English"}
            >
              <Globe className="w-4 h-4" />
            </button>
            <ThemeToggle />
            {user ? (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm hover:bg-primary/30 transition-colors overflow-hidden"
                >
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    (
                      user.displayName?.[0] ||
                      user.email?.[0] ||
                      "U"
                    ).toUpperCase()
                  )}
                </button>
                {userMenuOpen && (
                  <div className="absolute end-0 top-full mt-2 w-48 bg-surface border border-border rounded-[var(--radius)] shadow-lg py-1 z-50">
                    <Link
                      href="/dashboard"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-txt hover:bg-surface-secondary transition-colors"
                    >
                      <LayoutDashboard className="w-4 h-4" />
                      {t("nav.dashboard")}
                    </Link>
                    <button
                      onClick={logout}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-error hover:bg-surface-secondary transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      {t("nav.logout")}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="border border-primary text-primary hover:bg-primary/10 px-5 py-2.5 rounded-[var(--radius)] text-sm font-semibold transition-all"
              >
                {t("nav.login")}
              </Link>
            )}
          </div>

          {/* Mobile Toggle */}
          <div className="flex items-center gap-2 lg:hidden">
            <ThemeToggle />
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-surface-secondary transition-colors"
              aria-label="Toggle menu"
            >
              {isOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <div
        className={`lg:hidden overflow-hidden transition-all duration-300 ${
          isOpen ? "max-h-96 border-b border-border" : "max-h-0"
        }`}
      >
        <div className="bg-surface/95 backdrop-blur-md px-4 py-4 space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`block px-4 py-3 rounded-[var(--radius-sm)] text-sm font-medium transition-colors ${
                pathname === link.href
                  ? "text-primary bg-primary-soft"
                  : "text-txt-secondary hover:text-txt hover:bg-surface-secondary"
              }`}
            >
              {t(link.labelKey)}
            </Link>
          ))}
          {user ? (
            <Link
              href="/dashboard"
              className="block text-center bg-primary hover:bg-primary-dark text-txt-inverse px-5 py-3 rounded-[var(--radius)] text-sm font-semibold transition-colors mt-3"
            >
              {t("nav.dashboard")}
            </Link>
          ) : (
            <Link
              href="/login"
              className="block text-center border border-primary text-primary hover:bg-primary/10 px-5 py-3 rounded-[var(--radius)] text-sm font-semibold transition-colors mt-3"
            >
              {t("nav.login")}
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
