"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  Phone,
  Bell,
  Send,
  Shield,
  Smartphone,
  Monitor,
  ArrowRight,
  Zap,
  Lock,
  Globe,
  RefreshCw,
  ChevronDown,
  MessagesSquare,
  HelpCircle,
  Plus,
  Minus,
} from "lucide-react";
import AnimatedSection from "@/components/AnimatedSection";
import DownloadButtons from "@/components/DownloadButtons";

const features = [
  {
    icon: MessageSquare,
    title: "SMS Sync",
    description:
      "View and manage all your SMS messages on your computer in real-time. Never miss a text again.",
    color: "text-info",
    bg: "bg-info-light",
  },
  {
    icon: Phone,
    title: "Call History",
    description:
      "Access your complete call log — incoming, outgoing, and missed calls — right from your browser.",
    color: "text-success",
    bg: "bg-success-light",
  },
  {
    icon: Bell,
    title: "Notifications Sync",
    description:
      "Get your WhatsApp, Telegram, and other app notifications synced directly to your desktop.",
    color: "text-warning",
    bg: "bg-warning-light",
  },
  {
    icon: MessagesSquare,
    title: "Device Chat",
    description:
      "Chat between your devices with file sharing — send images, videos, PDFs, and more.",
    color: "text-primary-dark",
    bg: "bg-primary-soft",
  },
  {
    icon: Lock,
    title: "End-to-End Encryption",
    description:
      "All your data is encrypted with advanced encryption. Your privacy is our top priority.",
    color: "text-error",
    bg: "bg-error-light",
  },
  {
    icon: Globe,
    title: "Multi-Language",
    description:
      "Full support for English and Arabic with RTL layout. Use the app in your preferred language.",
    color: "text-secondary",
    bg: "bg-success-light",
  },
];

const steps = [
  {
    step: "01",
    icon: Smartphone,
    title: "Install the App",
    description:
      "Download iRopit from Google Play Store and set up your account in seconds.",
  },
  {
    step: "02",
    icon: Monitor,
    title: "Add Chrome Extension",
    description:
      "Install the iRopit Chrome Extension and sign in with the same account.",
  },
  {
    step: "03",
    icon: RefreshCw,
    title: "Start Syncing",
    description:
      "Your SMS, calls, and notifications sync automatically in real-time across devices.",
  },
];

const stats = [
  { value: "256-bit", label: "Encryption", icon: Shield },
  { value: "Real-time", label: "Sync Speed", icon: Zap },
  { value: "Cross", label: "Platform", icon: Monitor },
  { value: "100%", label: "Free to Use", icon: Globe },
];

const faqs = [
  {
    q: "What is iRopit?",
    a: "iRopit is a free device synchronization platform that lets you view and manage your phone's SMS messages, call history, notifications, and chat on your computer through a Chrome extension. All data is protected with end-to-end encryption.",
  },
  {
    q: "Is iRopit free to use?",
    a: "Yes! iRopit is completely free. Both the Android app and Chrome extension are available at no cost with all features included.",
  },
  {
    q: "Is my data secure?",
    a: "Absolutely. iRopit uses 256-bit end-to-end encryption. Your messages, calls, and notifications are encrypted before leaving your device and can only be decrypted by your authorized devices. We never store or read your personal data.",
  },
  {
    q: "How does SMS sync work?",
    a: "After installing the iRopit Android app and Chrome extension, simply sign in with the same account on both. Your SMS messages will automatically sync in real-time to your browser, allowing you to read and manage them from your computer.",
  },
  {
    q: "What platforms are supported?",
    a: "iRopit currently supports Android phones (via Google Play Store) and Chrome browsers (via Chrome Web Store). We're actively working on expanding to more platforms in the future.",
  },
  {
    q: "Can I sync WhatsApp and Telegram notifications?",
    a: "Yes! iRopit syncs all your app notifications including WhatsApp, Telegram, and other messaging apps directly to your desktop in real-time.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-[var(--radius-lg)] overflow-hidden transition-all duration-200 hover:border-primary-light">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 sm:p-6 text-left bg-surface hover:bg-surface-secondary transition-colors"
        aria-expanded={open}
      >
        <span className="text-base sm:text-lg font-semibold text-txt pr-4">
          {q}
        </span>
        {open ? (
          <Minus className="w-5 h-5 text-primary-dark flex-shrink-0" />
        ) : (
          <Plus className="w-5 h-5 text-txt-tertiary flex-shrink-0" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="px-5 sm:px-6 pb-5 sm:pb-6 text-sm sm:text-base text-txt-secondary leading-relaxed">
              {a}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      {/* ====== HERO SECTION ====== */}
      <section className="relative min-h-screen flex items-center overflow-hidden pt-20">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-secondary/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center lg:items-start">
            {/* Left - Content */}
            <div>
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <div className="mb-6 w-full max-w-[340px] sm:max-w-[420px] lg:max-w-none lg:w-[680px]">
                  <div className="aspect-video overflow-hidden rounded-2xl border border-border-light shadow-xl bg-surface-secondary">
                    <iframe
                      className="h-full w-full"
                      src="https://www.youtube.com/embed/nvcpXxFtrZI?autoplay=1&mute=1&loop=1&playlist=nvcpXxFtrZI&rel=0"
                      title="iRopit animated overview"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  </div>
                </div>

                <div className="inline-flex items-center gap-2 bg-primary-soft border border-primary-light px-4 py-2 rounded-full mb-6">
                  <Zap className="w-4 h-4 text-primary-dark" />
                  <span className="text-sm font-medium text-primary-dark">
                    Smart Device Sync Platform
                  </span>
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-txt leading-tight mb-6">
                  Sync Your Devices{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-dark to-primary animate-gradient">
                    Seamlessly
                  </span>
                </h1>

                <p className="text-lg sm:text-xl text-txt-secondary leading-relaxed mb-8 max-w-lg">
                  View and manage your phone&apos;s SMS, calls, and
                  notifications on your computer — all with end-to-end
                  encryption.
                </p>

                <DownloadButtons className="mb-8" />

                <div className="flex items-center gap-6 text-sm text-txt-tertiary">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-success" />
                    <span>Secure & Encrypted</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-warning" />
                    <span>Real-time Sync</span>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Right - Phone Mockup */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="relative flex justify-center"
            >
              <div className="relative">
                {/* Phone Frame */}
                <div className="relative w-[280px] sm:w-[320px] lg:w-[340px] aspect-[9/19] bg-gradient-to-b from-surface to-surface-secondary rounded-[40px] border-4 border-border-dark shadow-2xl overflow-hidden animate-float">
                  {/* Status bar */}
                  <div className="h-12 bg-primary flex items-center justify-center">
                    <div className="w-20 h-5 bg-txt/20 rounded-full" />
                  </div>
                  {/* App header */}
                  <div className="bg-primary px-6 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                        <Image
                          src="/logo.png"
                          alt="iRopit"
                          width={24}
                          height={24}
                        />
                      </div>
                      <div>
                        <div className="text-white font-semibold text-sm">
                          iRopit
                        </div>
                        <div className="text-white/70 text-xs">
                          All devices synced
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Mock content */}
                  <div className="p-4 space-y-3">
                    {/* SMS item */}
                    <div className="bg-surface rounded-[var(--radius)] p-3 shadow-sm border border-border-light">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 rounded-full bg-info-light flex items-center justify-center">
                          <MessageSquare className="w-4 h-4 text-info" />
                        </div>
                        <div className="flex-1">
                          <div className="text-xs font-semibold text-txt">
                            New Message
                          </div>
                          <div className="text-[10px] text-txt-tertiary">
                            Just now
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-txt-secondary">
                        Hey! Are you coming to...
                      </div>
                    </div>
                    {/* Call item */}
                    <div className="bg-surface rounded-[var(--radius)] p-3 shadow-sm border border-border-light">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-success-light flex items-center justify-center">
                          <Phone className="w-4 h-4 text-success" />
                        </div>
                        <div className="flex-1">
                          <div className="text-xs font-semibold text-txt">
                            Incoming Call
                          </div>
                          <div className="text-[10px] text-txt-tertiary">
                            2 min ago · 3:42
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Notification item */}
                    <div className="bg-surface rounded-[var(--radius)] p-3 shadow-sm border border-border-light">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-warning-light flex items-center justify-center">
                          <Bell className="w-4 h-4 text-warning" />
                        </div>
                        <div className="flex-1">
                          <div className="text-xs font-semibold text-txt">
                            WhatsApp
                          </div>
                          <div className="text-[10px] text-txt-tertiary">
                            New notification
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Chat item */}
                    <div className="bg-surface rounded-[var(--radius)] p-3 shadow-sm border border-border-light">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-soft flex items-center justify-center">
                          <Send className="w-4 h-4 text-primary-dark" />
                        </div>
                        <div className="flex-1">
                          <div className="text-xs font-semibold text-txt">
                            Device Chat
                          </div>
                          <div className="text-[10px] text-txt-tertiary">
                            File shared
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Bottom nav */}
                  <div className="absolute bottom-0 left-0 right-0 bg-surface border-t border-border flex items-center justify-around px-4 py-3">
                    <MessageSquare className="w-5 h-5 text-primary-dark" />
                    <Bell className="w-5 h-5 text-txt-tertiary" />
                    <MessagesSquare className="w-5 h-5 text-txt-tertiary" />
                    <Phone className="w-5 h-5 text-txt-tertiary" />
                  </div>
                </div>

                {/* Floating elements */}
                <motion.div
                  animate={{ y: [-5, 5, -5] }}
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                  className="absolute -top-4 -right-8 bg-success text-white px-3 py-1.5 rounded-full text-xs font-semibold shadow-lg"
                >
                  🔒 Encrypted
                </motion.div>
                <motion.div
                  animate={{ y: [5, -5, 5] }}
                  transition={{
                    duration: 5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                  className="absolute bottom-32 -left-6 bg-info text-white px-3 py-1.5 rounded-full text-xs font-semibold shadow-lg"
                >
                  ⚡ Real-time
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <ChevronDown className="w-6 h-6 text-txt-tertiary" />
        </motion.div>
      </section>

      {/* ====== TRUST BADGES ====== */}
      <section className="py-8 border-b border-border bg-surface-secondary">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12 text-txt-tertiary">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-success" />
              <span className="text-sm font-medium">256-bit Encryption</span>
            </div>
            <div className="w-px h-6 bg-border hidden sm:block" />
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-warning" />
              <span className="text-sm font-medium">Real-time Sync</span>
            </div>
            <div className="w-px h-6 bg-border hidden sm:block" />
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-info" />
              <span className="text-sm font-medium">Multi-Language</span>
            </div>
            <div className="w-px h-6 bg-border hidden sm:block" />
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-error" />
              <span className="text-sm font-medium">Privacy First</span>
            </div>
          </div>
        </div>
      </section>

      {/* ====== FEATURES SECTION ====== */}
      <section className="py-20 lg:py-28 bg-surface" id="features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <span className="inline-block text-sm font-semibold text-primary-dark bg-primary-soft px-4 py-1.5 rounded-full mb-4">
              Features
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-txt mb-4">
              Everything You Need
            </h2>
            <p className="text-lg text-txt-secondary max-w-2xl mx-auto">
              iRopit brings all your phone&apos;s communication to your
              computer, securely and instantly.
            </p>
          </AnimatedSection>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {features.map((feature, i) => (
              <AnimatedSection key={feature.title} delay={i * 0.1}>
                <div className="group h-full bg-bg dark:bg-surface-secondary hover:bg-primary-soft border border-border hover:border-primary-light rounded-[var(--radius-lg)] p-6 lg:p-8 transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
                  <div
                    className={`w-12 h-12 ${feature.bg} rounded-[var(--radius)] flex items-center justify-center mb-5`}
                  >
                    <feature.icon className={`w-6 h-6 ${feature.color}`} />
                  </div>
                  <h3 className="text-lg font-semibold text-txt mb-2 group-hover:text-primary-dark transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-txt-secondary leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ====== HOW IT WORKS ====== */}
      <section className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-16">
            <span className="inline-block text-sm font-semibold text-primary-dark bg-primary-soft px-4 py-1.5 rounded-full mb-4">
              How It Works
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-txt mb-4">
              Get Started in 3 Steps
            </h2>
            <p className="text-lg text-txt-secondary max-w-2xl mx-auto">
              Setting up iRopit takes less than a minute. Here&apos;s how to
              start syncing your devices.
            </p>
          </AnimatedSection>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
            {steps.map((step, i) => (
              <AnimatedSection
                key={step.step}
                delay={i * 0.15}
                className="relative"
              >
                <div className="text-center">
                  <div className="relative inline-flex mb-6">
                    <div className="w-20 h-20 bg-primary-soft border-2 border-primary-light rounded-2xl flex items-center justify-center">
                      <step.icon className="w-9 h-9 text-primary-dark" />
                    </div>
                    <span className="absolute -top-2 -right-2 w-8 h-8 bg-primary text-txt-inverse text-sm font-bold rounded-full flex items-center justify-center">
                      {step.step}
                    </span>
                  </div>
                  <h3 className="text-xl font-semibold text-txt mb-3">
                    {step.title}
                  </h3>
                  <p className="text-sm text-txt-secondary leading-relaxed">
                    {step.description}
                  </p>
                </div>
                {/* Connector line */}
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-10 left-[60%] w-[calc(100%-20%)] h-0.5 border-t-2 border-dashed border-primary-light" />
                )}
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ====== STATS SECTION ====== */}
      <section className="py-16 bg-gradient-to-r from-primary-dark via-primary to-primary-light">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <AnimatedSection key={stat.label} delay={i * 0.1}>
                <div className="text-center">
                  <stat.icon className="w-8 h-8 text-white/80 mx-auto mb-3" />
                  <div className="text-2xl sm:text-3xl font-bold text-white mb-1">
                    {stat.value}
                  </div>
                  <div className="text-sm text-white/70">{stat.label}</div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ====== DOWNLOAD CTA SECTION ====== */}
      <section className="py-20 lg:py-28" id="download">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection>
            <div className="relative bg-gradient-to-br from-primary-soft via-surface to-bg rounded-[var(--radius-xl)] border border-primary-light p-8 sm:p-12 lg:p-16 overflow-hidden">
              {/* Background decoration */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-secondary/10 rounded-full blur-3xl" />

              <div className="relative grid lg:grid-cols-2 gap-10 items-center">
                <div>
                  <h2 className="text-3xl sm:text-4xl font-bold text-txt mb-4">
                    Ready to Sync Your Devices?
                  </h2>
                  <p className="text-lg text-txt-secondary mb-8 max-w-md">
                    Download iRopit now and experience seamless communication
                    between your phone and computer.
                  </p>
                  <DownloadButtons />
                </div>

                <div className="flex justify-center lg:justify-end">
                  <div className="relative">
                    {/* Desktop / Extension mockup */}
                    <div className="w-[300px] sm:w-[360px] aspect-[16/10] bg-surface rounded-[var(--radius-lg)] border-2 border-border-dark shadow-xl overflow-hidden">
                      {/* Browser chrome */}
                      <div className="h-8 bg-surface-secondary border-b border-border flex items-center px-3 gap-2">
                        <div className="flex gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-error/60" />
                          <div className="w-2.5 h-2.5 rounded-full bg-warning/60" />
                          <div className="w-2.5 h-2.5 rounded-full bg-success/60" />
                        </div>
                        <div className="flex-1 bg-bg dark:bg-surface-tertiary rounded h-4 mx-8 flex items-center justify-center">
                          <span className="text-[8px] text-txt-tertiary">
                            chrome-extension://iropit
                          </span>
                        </div>
                      </div>
                      {/* Extension content */}
                      <div className="p-3 space-y-2">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
                            <Image
                              src="/logo.png"
                              alt=""
                              width={16}
                              height={16}
                            />
                          </div>
                          <span className="text-xs font-semibold text-txt">
                            iRopit Extension
                          </span>
                        </div>
                        <div className="flex gap-2 text-[9px]">
                          <span className="bg-primary-soft text-primary-dark px-2 py-0.5 rounded-full font-medium">
                            SMS
                          </span>
                          <span className="text-txt-tertiary px-2 py-0.5">
                            Calls
                          </span>
                          <span className="text-txt-tertiary px-2 py-0.5">
                            Chat
                          </span>
                          <span className="text-txt-tertiary px-2 py-0.5">
                            Notifications
                          </span>
                        </div>
                        <div className="space-y-1.5 mt-2">
                          {[1, 2, 3].map((i) => (
                            <div
                              key={i}
                              className="bg-bg dark:bg-surface-secondary rounded-lg p-2 flex items-center gap-2"
                            >
                              <div className="w-6 h-6 rounded-full bg-primary-soft" />
                              <div className="flex-1">
                                <div className="h-2 bg-border rounded w-16" />
                                <div className="h-1.5 bg-border-light rounded w-24 mt-1" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Sync icon */}
                    <motion.div
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute -left-12 top-1/2 -translate-y-1/2"
                    >
                      <RefreshCw className="w-8 h-8 text-primary" />
                    </motion.div>
                  </div>
                </div>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ====== FAQ SECTION ====== */}
      <section className="py-20 lg:py-28 bg-surface" id="faq">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection className="text-center mb-12">
            <span className="inline-block text-sm font-semibold text-primary-dark bg-primary-soft px-4 py-1.5 rounded-full mb-4">
              FAQ
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-txt mb-4">
              Frequently Asked Questions
            </h2>
            <p className="text-lg text-txt-secondary max-w-xl mx-auto">
              Got questions? We&apos;ve got answers. Find out everything you
              need to know about iRopit.
            </p>
          </AnimatedSection>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <AnimatedSection key={i} delay={i * 0.08}>
                <FaqItem q={faq.q} a={faq.a} />
              </AnimatedSection>
            ))}
          </div>

          <AnimatedSection className="text-center mt-10">
            <p className="text-txt-secondary mb-4">Still have questions?</p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-txt-inverse px-6 py-3 rounded-[var(--radius)] font-semibold transition-all hover:scale-105"
            >
              Contact Us
              <ArrowRight className="w-4 h-4" />
            </Link>
          </AnimatedSection>
        </div>
      </section>
    </>
  );
}
