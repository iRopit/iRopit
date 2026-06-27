"use client";

import Link from "next/link";
import Image from "next/image";
import { Mail, ArrowUpRight } from "lucide-react";
import { usePathname } from "next/navigation";
import packageJson from "../../package.json";

const WEBSITE_VERSION = process.env.NEXT_PUBLIC_WEBSITE_VERSION || packageJson.version;

const footerLinks = {
  product: [
    { href: "/", label: "Home" },
    { href: "/services", label: "Services" },
    { href: "/about", label: "About Us" },
    { href: "/contact", label: "Contact" },
  ],
  legal: [
    { href: "/privacy-policy", label: "Privacy Policy" },
    { href: "/privacy-policy#data-collection", label: "Data Collection" },
    { href: "/privacy-policy#your-rights", label: "Your Rights" },
  ],
  download: [
    { href: "https://play.google.com/store/apps/details?id=com.IRopit", label: "Google Play Store", external: true },
    { href: "https://chromewebstore.google.com/detail/iropit/apjplefehkfmcjmkpapnjpainefomkgh?hl=en-US&utm_source=ext_sidebar", label: "Chrome Web Store", external: true },
  ],
};

export default function Footer() {
  const pathname = usePathname();
  const isDashboard = pathname?.startsWith("/dashboard");
  const isAuthPage =
    pathname?.startsWith("/login") || pathname?.startsWith("/signup");

  if (isDashboard || isAuthPage) return null;

  return (
    <footer className="bg-surface border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-primary flex items-center justify-center overflow-hidden">
                <Image
                  src="/logo.png"
                  alt="iRopit"
                  width={28}
                  height={28}
                  className="object-contain"
                />
              </div>
              <span className="text-xl font-bold text-txt">iRopit</span>
            </Link>
            <p className="text-txt-secondary text-sm leading-relaxed mb-4">
              Sync your devices seamlessly. View and manage your phone&apos;s
              SMS, calls, and notifications on your computer with end-to-end
              encryption.
            </p>
            <div className="flex items-center gap-3 text-sm text-txt-secondary">
              <Mail className="w-4 h-4" />
              <a
                href="mailto:info@iRopit.com"
                className="hover:text-primary transition-colors"
              >
                info@iRopit.com
              </a>
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h3 className="text-sm font-semibold text-txt uppercase tracking-wider mb-4">
              Product
            </h3>
            <ul className="space-y-3">
              {footerLinks.product.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-txt-secondary hover:text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal Links */}
          <div>
            <h3 className="text-sm font-semibold text-txt uppercase tracking-wider mb-4">
              Legal
            </h3>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-txt-secondary hover:text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Download */}
          <div>
            <h3 className="text-sm font-semibold text-txt uppercase tracking-wider mb-4">
              Download
            </h3>
            <ul className="space-y-3">
              {footerLinks.download.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    target={link.external ? "_blank" : undefined}
                    rel={link.external ? "noopener noreferrer" : undefined}
                    className="text-sm text-txt-secondary hover:text-primary transition-colors inline-flex items-center gap-1"
                  >
                    {link.label}
                    <ArrowUpRight className="w-3 h-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-txt-tertiary">
            © {new Date().getFullYear()} iRopit. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-txt-tertiary">Version v{WEBSITE_VERSION}</span>
            <span className="text-txt-tertiary">·</span>
            <Link
              href="/privacy-policy"
              className="text-xs text-txt-tertiary hover:text-primary transition-colors"
            >
              Privacy Policy
            </Link>
            <span className="text-txt-tertiary">·</span>
            <Link
              href="/contact"
              className="text-xs text-txt-tertiary hover:text-primary transition-colors"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
