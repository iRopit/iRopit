"use client";

import Image from "next/image";
import {
  MessageSquare,
  Phone,
  Bell,
  BarChart3,
  MessagesSquare,
  Shield,
  Smartphone,
  MonitorSmartphone,
  Send,
  FileText,
  Image as ImageIcon,
  Video,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Lock,
  RefreshCw,
  Wifi,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import AnimatedSection from "@/components/AnimatedSection";
import Link from "next/link";
import DownloadButtons from "@/components/DownloadButtons";

const services = [
  {
    icon: MessagesSquare,
    title: "Device-to-Device Chat",
    description:
      "A full-featured chat system between your registered devices. Share files, images, videos — communicate seamlessly across all your devices.",
    features: [
      "Text messaging between devices",
      "File sharing (images, videos, PDFs, archives)",
      "Real-time typing indicators",
      "Reply to specific messages",
      "Multiple file type support",
      "Instant delivery via Firebase",
    ],
    color: "text-primary-dark",
    bg: "bg-primary-soft",
    gradient: "from-primary/10 to-primary/5",
    icons: [ImageIcon, Video, FileText],
    screenshot: "/screenshots/01.Chat messages.jpg",
  },
  {
    icon: MessageSquare,
    title: "SMS Synchronization",
    description:
      "All your SMS messages are synced in real-time between your phone and Chrome Extension. Read, organize, and respond to texts from your computer.",
    features: [
      "Real-time SMS sync to Chrome Extension",
      "Send SMS from your browser via your phone",
      "Threaded conversation view",
      "Contact name resolution",
      "Search through messages",
      "Read/unread status sync",
    ],
    color: "text-info",
    bg: "bg-info-light",
    gradient: "from-info/10 to-info/5",
    screenshot: "/screenshots/02.SMS Screen.jpg",
  },
  {
    icon: Phone,
    title: "Call History Sync",
    description:
      "Never miss a call detail again. Your complete call history — incoming, outgoing, and missed calls — appears on your desktop instantly.",
    features: [
      "Incoming, outgoing & missed call logs",
      "Call duration and timestamps",
      "Contact name display",
      "Call type indicators with colors",
      "Chronological call history",
      "Real-time sync on new calls",
    ],
    color: "text-success",
    bg: "bg-success-light",
    gradient: "from-success/10 to-success/5",
    icons: [PhoneIncoming, PhoneOutgoing, PhoneMissed],
    screenshot: "/screenshots/03.Call screen.jpg",
  },
  {
    icon: Bell,
    title: "Notifications Sync",
    description:
      "Get notifications from WhatsApp, Telegram, and other apps directly on your desktop. Stay informed without reaching for your phone.",
    features: [
      "WhatsApp & Telegram notifications",
      "App name and icon identification",
      "Notification title and content",
      "Real-time push to desktop",
      "Desktop notification alerts",
      "App filtering and preferences",
    ],
    color: "text-warning",
    bg: "bg-warning-light",
    gradient: "from-warning/10 to-warning/5",
    screenshot: "/screenshots/04.Notification Screen.jpg",
  },
  {
    icon: BarChart3,
    title: "Insights",
    description:
      "Turn banking SMS data into clear financial visibility. Track spending, monitor income, and understand patterns across categories.",
    features: [
      "Automatic income and expense detection",
      "Category-wise spending breakdown",
      "Monthly trend analysis",
      "Merchant and receiver insights",
      "Searchable spending history",
      "CSV export for reporting",
    ],
    color: "text-primary-dark",
    bg: "bg-primary-soft",
    gradient: "from-primary/10 to-primary/5",
    screenshot: "/screenshots/05.Insights Data.jpg",
  },
  {
    icon: MonitorSmartphone,
    title: "Multi-Device Management",
    description:
      "Register and manage multiple devices with ease. See which devices are online, set nicknames, and control your sync preferences.",
    features: [
      "Register multiple devices",
      "Device online/offline status",
      "Custom device nicknames",
      "Device-specific settings",
      "Share device with another iRopit account",
      "Easy device removal",
    ],
    color: "text-secondary",
    bg: "bg-success-light",
    gradient: "from-secondary/10 to-secondary/5",
    screenshot: "/screenshots/07.Devices.jpg",
  },
  {
    icon: Shield,
    title: "Security & Encryption",
    description:
      "Your data is protected with end-to-end encryption. All SMS and call data is encrypted before transmission, ensuring complete privacy.",
    features: [
      "End-to-end data encryption",
      "Encrypted data storage",
      "Secure Firebase authentication",
      "Biometric app lock support",
      "No third-party data sharing",
      "Regular security updates",
    ],
    color: "text-error",
    bg: "bg-error-light",
    gradient: "from-error/10 to-error/5",
    screenshot: "/screenshots/desktop.png",
  },
];

export default function ServicesContent() {
  return (
    <div className="pt-20">
      {/* Hero */}
      <section className="relative py-20 lg:py-28 overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/15 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-secondary/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center max-w-3xl mx-auto">
            <span className="inline-block text-sm font-semibold text-primary-dark bg-primary-soft px-4 py-1.5 rounded-full mb-6">
              Our Services
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-txt mb-6">
              Powerful Features,{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-dark to-primary">
                Simple Experience
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-txt-secondary leading-relaxed max-w-2xl mx-auto">
              Discover everything iRopit offers to keep your devices connected
              and your communication seamless.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-10 lg:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-16 lg:space-y-24">
            {services.map((service, i) => (
              <AnimatedSection
                key={service.title}
                direction={i % 2 === 0 ? "left" : "right"}
              >
                <div
                  className={`grid lg:grid-cols-2 gap-10 lg:gap-16 items-center ${
                    i % 2 !== 0 ? "lg:direction-rtl" : ""
                  }`}
                >
                  {/* Content */}
                  <div className={i % 2 !== 0 ? "lg:order-2" : ""}>
                    <div
                      className={`w-14 h-14 ${service.bg} rounded-2xl flex items-center justify-center mb-5`}
                    >
                      <service.icon className={`w-7 h-7 ${service.color}`} />
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-txt mb-4">
                      {service.title}
                    </h2>
                    <p className="text-txt-secondary leading-relaxed mb-6">
                      {service.description}
                    </p>

                    <ul className="space-y-3">
                      {service.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
                          <span className="text-sm text-txt-secondary">
                            {feature}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Visual */}
                  <div className={i % 2 !== 0 ? "lg:order-1" : ""}>
                    <div
                      className={`bg-gradient-to-br ${service.gradient} rounded-[var(--radius-xl)] border border-border overflow-hidden`}
                    >
                      <Image
                        src={service.screenshot}
                        alt={`${service.title} screenshot`}
                        width={1200}
                        height={700}
                        className="block w-full h-auto object-cover"
                        sizes="(min-width: 1024px) 46vw, 100vw"
                      />
                    </div>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Technology Stack Banner */}
      <section className="py-16 bg-gradient-to-r from-primary-dark via-primary to-primary-light">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Built with Modern Technology
            </h2>
            <p className="text-white/80 max-w-2xl mx-auto mb-8">
              iRopit leverages cutting-edge technology including React Native,
              Chrome Extension APIs, Firebase real-time database, and advanced
              encryption protocols.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              {[
                "React Native",
                "Chrome Extension",
                "Firebase",
                "E2E Encryption",
                "Real-time Sync",
              ].map((tech) => (
                <span
                  key={tech}
                  className="bg-white/15 text-white px-4 py-2 rounded-full text-sm font-medium backdrop-blur-sm"
                >
                  {tech}
                </span>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 lg:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <AnimatedSection>
            <h2 className="text-3xl sm:text-4xl font-bold text-txt mb-4">
              Experience All Features Today
            </h2>
            <p className="text-lg text-txt-secondary mb-8 max-w-xl mx-auto">
              Download iRopit and start syncing your devices in under a minute.
            </p>
            <DownloadButtons className="justify-center" />
          </AnimatedSection>
        </div>
      </section>
    </div>
  );
}
