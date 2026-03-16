import type { Metadata, Viewport } from "next";
import { Inter, Cairo } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";
import JsonLd from "@/components/JsonLd";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#D5C19E" },
    { media: "(prefers-color-scheme: dark)", color: "#111827" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: {
    default: "iRopit — Sync SMS, Calls & Notifications Between Phone & PC",
    template: "%s | iRopit",
  },
  description:
    "iRopit syncs your SMS messages, call history, notifications, and device chat between your Android phone and computer in real-time with end-to-end encryption. Free to use.",
  keywords: [
    "iRopit",
    "sync SMS to PC",
    "sync phone to computer",
    "SMS sync app",
    "call history sync",
    "phone notifications on PC",
    "Chrome extension SMS",
    "Android SMS on computer",
    "device sync app",
    "cross-platform messaging",
    "phone to desktop sync",
    "read SMS on browser",
    "view call log on PC",
    "WhatsApp notifications PC",
    "encrypted device sync",
    "free SMS sync",
    "real-time phone sync",
  ],
  authors: [{ name: "iRopit", url: "https://www.iropit.com" }],
  creator: "iRopit",
  publisher: "iRopit",
  metadataBase: new URL("https://www.iropit.com"),
  alternates: {
    canonical: "https://www.iropit.com",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://www.iropit.com",
    siteName: "iRopit",
    title: "iRopit — Sync SMS, Calls & Notifications Between Phone & PC",
    description:
      "Sync your phone's SMS, calls, notifications & chat to your computer in real-time. Free, secure, end-to-end encrypted.",
  },
  twitter: {
    card: "summary_large_image",
    title: "iRopit — Sync SMS, Calls & Notifications Between Phone & PC",
    description:
      "Sync your phone's SMS, calls, notifications & chat to your computer in real-time. Free, secure, end-to-end encrypted.",
    creator: "@iropit",
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
    shortcut: "/icons/icon-32.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "iRopit",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    // Add your Google Search Console verification code here
    // google: "your-verification-code",
  },
  category: "technology",
};

// JSON-LD structured data
const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "iRopit",
  url: "https://www.iropit.com",
  logo: "https://www.iropit.com/icons/icon-512.png",
  description:
    "iRopit is a cross-platform device synchronization platform that syncs SMS, calls, notifications and chat between your phone and computer.",
  email: "info@iRopit.com",
  sameAs: [],
  contactPoint: {
    "@type": "ContactPoint",
    email: "info@iRopit.com",
    contactType: "customer support",
    availableLanguage: ["English", "Arabic"],
  },
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "iRopit",
  url: "https://www.iropit.com",
  description:
    "Sync SMS, calls, notifications, and chat between your phone and computer with end-to-end encryption.",
  potentialAction: {
    "@type": "SearchAction",
    target: "https://www.iropit.com/?q={search_term_string}",
    "query-input": "required name=search_term_string",
  },
};

const softwareAppSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "iRopit",
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Android",
  description:
    "Sync your SMS, call history, notifications, and device chat between your Android phone and Chrome browser in real-time with end-to-end encryption.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  featureList: [
    "SMS Sync",
    "Call History Sync",
    "Notification Sync",
    "Device Chat",
    "File Sharing",
    "End-to-End Encryption",
    "Multi-Language Support",
    "Real-time Sync",
  ],
};

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://www.iropit.com",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "About",
      item: "https://www.iropit.com/about",
    },
    {
      "@type": "ListItem",
      position: 3,
      name: "Services",
      item: "https://www.iropit.com/services",
    },
    {
      "@type": "ListItem",
      position: 4,
      name: "Privacy Policy",
      item: "https://www.iropit.com/privacy-policy",
    },
    {
      "@type": "ListItem",
      position: 5,
      name: "Contact",
      item: "https://www.iropit.com/contact",
    },
  ],
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is iRopit?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "iRopit is a free device synchronization platform that lets you view and manage your phone's SMS messages, call history, notifications, and chat on your computer through a Chrome extension. All data is protected with end-to-end encryption.",
      },
    },
    {
      "@type": "Question",
      name: "Is iRopit free to use?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, iRopit is completely free to use. Both the Android app and Chrome extension are available at no cost.",
      },
    },
    {
      "@type": "Question",
      name: "Is my data secure with iRopit?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Absolutely. iRopit uses 256-bit end-to-end encryption to protect all your synced data. Your messages, calls, and notifications are encrypted before leaving your device and can only be decrypted by your authorized devices.",
      },
    },
    {
      "@type": "Question",
      name: "How does iRopit sync SMS to my computer?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "After installing the iRopit Android app and Chrome extension, sign in with the same account. Your SMS messages will automatically sync in real-time to your browser, allowing you to read and manage them from your computer.",
      },
    },
    {
      "@type": "Question",
      name: "What platforms does iRopit support?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "iRopit currently supports Android phones (via the Google Play Store app) and Chrome browsers (via the Chrome Web Store extension). More platforms are planned for the future.",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})();`,
          }}
        />
        <link rel="icon" href="/icons/icon-32.png" type="image/png" />
        <link
          rel="icon"
          href="/icons/icon-16.png"
          sizes="16x16"
          type="image/png"
        />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />
        <link rel="canonical" href="https://www.iropit.com" />
        <JsonLd data={organizationSchema} />
        <JsonLd data={websiteSchema} />
        <JsonLd data={softwareAppSchema} />
        <JsonLd data={breadcrumbSchema} />
        <JsonLd data={faqSchema} />
      </head>
      <body
        className={`${inter.variable} ${cairo.variable} antialiased min-h-screen flex flex-col`}
      >
        <LanguageProvider>
          <AuthProvider>
            <ServiceWorkerRegister />
            <PWAInstallPrompt />
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
