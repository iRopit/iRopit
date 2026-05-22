import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — How We Protect Your Data",
  description:
    "iRopit Privacy Policy — Learn how we collect, use, protect, and handle your personal information. End-to-end encryption, GDPR & CCPA compliant, no data selling.",
  alternates: {
    canonical: "https://www.iropit.com/privacy-policy",
  },
  openGraph: {
    title: "iRopit Privacy Policy",
    description:
      "Your privacy matters. Learn how iRopit protects your data with end-to-end encryption and transparent data practices.",
    url: "https://www.iropit.com/privacy-policy",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <div className="pt-20">
      {/* Hero */}
      <section className="py-16 lg:py-20 bg-surface">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <span className="inline-block text-sm font-semibold text-primary-dark bg-primary-soft px-4 py-1.5 rounded-full mb-6">
            Legal
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-txt mb-4">
            Privacy Policy
          </h1>
          <p className="text-txt-secondary text-lg">
            Last Updated: February 13, 2026
          </p>
        </div>
      </section>

      {/* Privacy Content */}
      <section className="py-12 lg:py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            {/* Introduction */}
            <div className="mb-12">
              <h2
                className="text-2xl font-bold text-txt mb-4"
                id="introduction"
              >
                1. Introduction
              </h2>
              <div className="bg-primary-soft border border-primary-light rounded-[var(--radius-lg)] p-6 mb-6">
                <p className="text-txt-secondary leading-relaxed m-0">
                  <strong className="text-txt">iRopit</strong> (&quot;we,&quot;
                  &quot;our,&quot; or &quot;us&quot;) operates the iRopit mobile
                  application (available on Google Play Store) and the iRopit
                  Chrome Extension (available on Chrome Web Store). This Privacy
                  Policy explains how we collect, use, disclose, and safeguard
                  your information when you use our mobile application and
                  Chrome Extension (collectively, the &quot;Services&quot;).
                </p>
              </div>
              <p className="text-txt-secondary leading-relaxed">
                iRopit is a{" "}
                <strong className="text-txt">
                  cross-platform device synchronization platform
                </strong>{" "}
                that enables users to sync SMS messages, call history, app
                notifications, and device-to-device chat between their Android
                mobile devices and Chrome browser. Our Services are designed
                with privacy and security as foundational principles, employing
                end-to-end encryption for sensitive data.
              </p>
              <p className="text-txt-secondary leading-relaxed">
                By using our Services, you agree to the collection and use of
                information in accordance with this policy. If you do not agree
                with the terms of this Privacy Policy, please do not access or
                use our Services.
              </p>
            </div>

            {/* Information We Collect */}
            <div className="mb-12" id="data-collection">
              <h2 className="text-2xl font-bold text-txt mb-4">
                2. Information We Collect
              </h2>
              <p className="text-txt-secondary leading-relaxed mb-6">
                We collect different types of information to provide and improve
                our Services. Below is a detailed breakdown of the information
                we collect:
              </p>

              <h3 className="text-xl font-semibold text-txt mb-3">
                2.1 Account Information
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-2">
                When you create an account, we collect:
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-1 mb-6">
                <li>Full name</li>
                <li>Email address</li>
                <li>Password (stored securely via Firebase Authentication)</li>
                <li>Profile information (optional)</li>
              </ul>

              <h3 className="text-xl font-semibold text-txt mb-3">
                2.2 SMS Messages
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-2">
                Our core functionality involves syncing SMS messages between
                your devices. We collect:
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-1 mb-4">
                <li>SMS message content (sender, body text, timestamps)</li>
                <li>Message read/unread status</li>
                <li>Conversation thread information</li>
              </ul>
              <div className="bg-success-light border border-success/20 rounded-[var(--radius)] p-4 mb-6">
                <p className="text-sm text-txt m-0">
                  <strong>🔒 Security Note:</strong> All SMS data is encrypted
                  using end-to-end encryption before being transmitted or
                  stored. Only your authorized devices can decrypt this data.
                </p>
              </div>

              <h3 className="text-xl font-semibold text-txt mb-3">
                2.3 Call History
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-2">
                To provide call history synchronization, we collect:
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-1 mb-4">
                <li>Phone numbers associated with calls</li>
                <li>Call type (incoming, outgoing, missed)</li>
                <li>Call duration</li>
                <li>Call timestamps</li>
                <li>Associated contact names (if available)</li>
              </ul>
              <div className="bg-success-light border border-success/20 rounded-[var(--radius)] p-4 mb-6">
                <p className="text-sm text-txt m-0">
                  <strong>🔒 Security Note:</strong> Call history data is
                  encrypted before transmission and storage, just like SMS data.
                </p>
              </div>

              <h3 className="text-xl font-semibold text-txt mb-3">
                2.4 App Notifications
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-2">
                When you grant Notification Access permission, we collect
                notifications from your phone&apos;s apps:
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-1 mb-4">
                <li>
                  Application package name and app name (e.g., WhatsApp,
                  Telegram)
                </li>
                <li>Notification title and text content</li>
                <li>Notification type and category</li>
                <li>Notification timestamp</li>
              </ul>

              <h3 className="text-xl font-semibold text-txt mb-3">
                2.5 Contacts
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-2">
                With your permission, we access contact information for display
                purposes:
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-1 mb-4">
                <li>Contact names</li>
                <li>Phone numbers</li>
              </ul>
              <p className="text-txt-secondary leading-relaxed mb-6">
                Contact data is used solely to display contact names alongside
                SMS messages and call logs, making it easier to identify who is
                communicating with you.{" "}
                <strong className="text-txt">
                  Contact data is not shared with any third parties.
                </strong>
              </p>

              <h3 className="text-xl font-semibold text-txt mb-3">
                2.6 Device Information
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-2">
                We collect device information for multi-device management:
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-1 mb-6">
                <li>Device model and manufacturer</li>
                <li>Operating system and version</li>
                <li>Platform type (Android, Chrome)</li>
                <li>
                  Device identifier (generated by iRopit, not hardware ID)
                </li>
                <li>Online/offline status</li>
                <li>
                  Firebase Cloud Messaging (FCM) token for push notifications
                </li>
              </ul>

              <h3 className="text-xl font-semibold text-txt mb-3">
                2.7 Usage Data & Preferences
              </h3>
              <ul className="list-disc pl-6 text-txt-secondary space-y-1 mb-6">
                <li>Theme preference (dark/light mode)</li>
                <li>Language preference (English/Arabic)</li>
                <li>
                  Notification preferences (sound, vibration, do not disturb)
                </li>
                <li>Sync settings (auto-sync, Wi-Fi only, sync interval)</li>
                <li>Onboarding completion status</li>
              </ul>
            </div>

            {/* How We Collect Information */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                3. How We Collect Information
              </h2>

              <h3 className="text-xl font-semibold text-txt mb-3">
                3.1 Directly from You
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-4">
                We collect information you provide when creating an account,
                configuring settings, or contacting our support team.
              </p>

              <h3 className="text-xl font-semibold text-txt mb-3">
                3.2 Automatically via Android App
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-2">
                The iRopit Android app collects data automatically through:
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-2 mb-4">
                <li>
                  <strong className="text-txt">
                    Notification Listener Service (Android):
                  </strong>{" "}
                  This is the primary method used to capture incoming SMS and
                  app notifications. The service runs in the background and
                  detects new notifications as they arrive on your device. This
                  approach is used instead of direct SMS/Call Log API access, in
                  compliance with Google Play policies.
                </li>
                <li>
                  <strong className="text-txt">Read SMS Permission:</strong> The
                  READ_SMS and RECEIVE_SMS permissions are used as a fallback to
                  read incoming SMS content when notification access
                  doesn&apos;t capture the full message text.
                </li>
              </ul>

              <h3 className="text-xl font-semibold text-txt mb-3">
                3.3 Via Chrome Extension
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-6">
                The Chrome Extension collects data through Firebase real-time
                listeners and periodic background sync using Chrome Alarms API.
                The extension reads synchronized data from Firebase to display
                on your desktop.
              </p>
            </div>

            {/* Purpose of Data Collection */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                4. Purpose of Data Collection
              </h2>
              <p className="text-txt-secondary leading-relaxed mb-4">
                We use the information we collect for the following purposes:
              </p>

              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                {[
                  {
                    title: "Core Sync Functionality",
                    desc: "To synchronize SMS, calls, notifications, and chat between your devices in real-time.",
                  },
                  {
                    title: "Contact Name Display",
                    desc: "To display contact names alongside phone numbers in SMS and call history for easier identification.",
                  },
                  {
                    title: "Cross-Device Messaging",
                    desc: "To enable the device-to-device chat feature with file sharing capabilities.",
                  },
                  {
                    title: "Push Notifications",
                    desc: "To alert you on your desktop when new SMS, calls, or notifications arrive on your phone.",
                  },
                  {
                    title: "User Authentication",
                    desc: "To verify your identity and secure access to your data across devices.",
                  },
                  {
                    title: "Service Improvement",
                    desc: "To analyze usage patterns and improve our Services, fix bugs, and develop new features.",
                  },
                  {
                    title: "Customer Support",
                    desc: "To respond to your feedback, questions, and support requests.",
                  },
                  {
                    title: "Security",
                    desc: "To detect and prevent fraud, abuse, or unauthorized access to your account.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="bg-surface-secondary rounded-[var(--radius)] p-4"
                  >
                    <h4 className="font-semibold text-txt text-sm mb-1">
                      {item.title}
                    </h4>
                    <p className="text-xs text-txt-secondary m-0">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Data Storage & Security */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                5. Data Storage & Security
              </h2>

              <h3 className="text-xl font-semibold text-txt mb-3">
                5.1 Cloud Storage
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-4">
                Your data is stored securely using{" "}
                <strong className="text-txt">Google Firebase</strong>{" "}
                infrastructure, which provides enterprise-grade security:
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-1 mb-6">
                <li>
                  <strong className="text-txt">Firebase Authentication</strong>{" "}
                  — Secure user authentication with email/password and Google
                  Sign-In
                </li>
                <li>
                  <strong className="text-txt">Cloud Firestore</strong> —
                  Real-time synchronized database with security rules
                </li>
                <li>
                  <strong className="text-txt">Firebase Cloud Storage</strong> —
                  Encrypted file storage for chat attachments
                </li>
                <li>
                  <strong className="text-txt">Firebase Cloud Functions</strong>{" "}
                  — Server-side processing with access controls
                </li>
              </ul>

              <h3 className="text-xl font-semibold text-txt mb-3">
                5.2 Encryption
              </h3>
              <div className="bg-info-light border border-info/20 rounded-[var(--radius-lg)] p-6 mb-6">
                <h4 className="font-semibold text-txt mb-2">
                  End-to-End Encryption
                </h4>
                <p className="text-txt-secondary text-sm leading-relaxed m-0">
                  iRopit implements end-to-end encryption for sensitive data
                  including SMS messages and call history. Data is encrypted on
                  your device before being transmitted to our servers and can
                  only be decrypted by your own authenticated devices. This
                  means even we cannot read your encrypted messages.
                </p>
              </div>

              <h3 className="text-xl font-semibold text-txt mb-3">
                5.3 Local Storage
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-6">
                Certain data is stored locally on your device for performance
                and offline access, including authentication tokens (stored
                securely), user preferences, device identifiers, and cached
                data. Local data is stored using secure storage mechanisms
                provided by the operating system.
              </p>

              <h3 className="text-xl font-semibold text-txt mb-3">
                5.4 Security Measures
              </h3>
              <ul className="list-disc pl-6 text-txt-secondary space-y-1 mb-6">
                <li>SSL/TLS encryption for all data in transit</li>
                <li>
                  Firebase Security Rules restricting data access to authorized
                  users only
                </li>
                <li>Secure authentication with session management</li>
                <li>
                  Optional biometric lock (fingerprint/face recognition) for app
                  access
                </li>
                <li>Regular security audits and updates</li>
              </ul>
            </div>

            {/* Data Sharing */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                6. Data Sharing & Disclosure
              </h2>

              <div className="bg-error-light border border-error/20 rounded-[var(--radius-lg)] p-6 mb-6">
                <p className="text-txt font-semibold m-0 mb-2">
                  We do NOT sell, trade, rent, or monetize your personal data.
                </p>
                <p className="text-txt-secondary text-sm m-0">
                  Your data is never shared with advertisers, data brokers, or
                  any third party for marketing purposes.
                </p>
              </div>

              <p className="text-txt-secondary leading-relaxed mb-4">
                We may share information only in the following limited
                circumstances:
              </p>

              <h3 className="text-xl font-semibold text-txt mb-3">
                6.1 Between Your Own Devices
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-4">
                The primary purpose of iRopit is to sync data between your own
                registered devices. Data is shared only between devices
                authenticated with your account credentials.
              </p>

              <h3 className="text-xl font-semibold text-txt mb-3">
                6.2 Service Providers (Data Processors)
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-2">
                We use the following third-party services as data processors:
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-2 mb-4">
                <li>
                  <strong className="text-txt">Google Firebase</strong> — Cloud
                  infrastructure, authentication, database, storage, and
                  messaging. Google&apos;s privacy policy applies:{" "}
                  <a
                    href="https://policies.google.com/privacy"
                    className="text-primary-dark hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    https://policies.google.com/privacy
                  </a>
                </li>
                <li>
                  <strong className="text-txt">
                    Firebase Cloud Messaging (FCM)
                  </strong>{" "}
                  — For delivering push notifications to your devices.
                </li>
              </ul>

              <h3 className="text-xl font-semibold text-txt mb-3">
                6.3 Legal Requirements
              </h3>
              <p className="text-txt-secondary leading-relaxed mb-6">
                We may disclose your information when required to do so by law,
                in response to valid legal processes (such as a court order or
                subpoena), or when we believe disclosure is necessary to protect
                our rights, protect your safety or the safety of others,
                investigate fraud, or respond to a government request.
              </p>
            </div>

            {/* Permissions Explained */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                7. Permissions Explained
              </h2>
              <p className="text-txt-secondary leading-relaxed mb-6">
                iRopit requires certain permissions to function. Here is a
                detailed explanation of each permission and why it is needed:
              </p>

              <div className="space-y-4 mb-6">
                {[
                  {
                    perm: "Notification Access (NotificationListenerService)",
                    why: "This is the primary mechanism used to capture incoming SMS messages and app notifications (WhatsApp, Telegram, etc.) for synchronization. It allows iRopit to read notification content as it appears on your phone and sync it to your other devices.",
                    required: true,
                  },
                  {
                    perm: "Read SMS (READ_SMS, RECEIVE_SMS)",
                    why: "These permissions are used as a fallback mechanism to read the full content of incoming SMS messages when the Notification Listener Service does not capture the complete message text.",
                    required: true,
                  },
                  {
                    perm: "Push Notifications (POST_NOTIFICATIONS)",
                    why: "Required on Android 13+ to display push notifications when new messages, calls, or notifications are synced from other devices.",
                    required: true,
                  },
                  {
                    perm: "Contacts (READ_CONTACTS)",
                    why: "Optional permission used to read your phone contacts so that contact names can be displayed alongside phone numbers in SMS messages and call logs.",
                    required: false,
                  },
                ].map((item) => (
                  <div
                    key={item.perm}
                    className="bg-surface border border-border rounded-[var(--radius-lg)] p-5"
                  >
                    <div className="flex items-start gap-3 mb-2">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${item.required ? "bg-warning-light text-warning" : "bg-info-light text-info"}`}
                      >
                        {item.required ? "Required" : "Optional"}
                      </span>
                      <h4 className="font-semibold text-txt text-sm">
                        {item.perm}
                      </h4>
                    </div>
                    <p className="text-sm text-txt-secondary leading-relaxed m-0 pl-0 sm:pl-16">
                      {item.why}
                    </p>
                  </div>
                ))}
              </div>

              <h3 className="text-xl font-semibold text-txt mb-3">
                Chrome Extension Permissions
              </h3>
              <div className="space-y-4 mb-6">
                {[
                  {
                    perm: "Storage",
                    why: "To store authentication tokens, user settings, device ID, and sync state locally in the browser.",
                  },
                  {
                    perm: "Notifications",
                    why: "To display desktop notifications when new SMS messages, calls, or app notifications arrive from your phone.",
                  },
                  {
                    perm: "Identity",
                    why: "To support Google Sign-In authentication for secure account access.",
                  },
                  {
                    perm: "Alarms",
                    why: "To perform periodic background data synchronization and keep your data up to date.",
                  },
                ].map((item) => (
                  <div
                    key={item.perm}
                    className="bg-surface border border-border rounded-[var(--radius)] p-4"
                  >
                    <h4 className="font-semibold text-txt text-sm mb-1">
                      {item.perm}
                    </h4>
                    <p className="text-sm text-txt-secondary m-0">{item.why}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* User Rights */}
            <div className="mb-12" id="your-rights">
              <h2 className="text-2xl font-bold text-txt mb-4">
                8. Your Rights
              </h2>
              <p className="text-txt-secondary leading-relaxed mb-4">
                You have the following rights regarding your personal data:
              </p>

              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                {[
                  {
                    title: "Right to Access",
                    desc: "Request a copy of the personal data we hold about you.",
                  },
                  {
                    title: "Right to Correction",
                    desc: "Request correction of inaccurate or incomplete personal data.",
                  },
                  {
                    title: "Right to Deletion",
                    desc: "Request deletion of your account and all associated data.",
                  },
                  {
                    title: "Right to Data Portability",
                    desc: "Request your data in a structured, commonly used format.",
                  },
                  {
                    title: "Right to Withdraw Consent",
                    desc: "Withdraw consent for data processing at any time.",
                  },
                  {
                    title: "Right to Restrict Processing",
                    desc: "Request restriction of processing of your personal data.",
                  },
                ].map((right) => (
                  <div
                    key={right.title}
                    className="bg-surface border border-border rounded-[var(--radius)] p-4"
                  >
                    <h4 className="font-semibold text-txt text-sm mb-1">
                      {right.title}
                    </h4>
                    <p className="text-xs text-txt-secondary m-0">
                      {right.desc}
                    </p>
                  </div>
                ))}
              </div>

              <p className="text-txt-secondary leading-relaxed">
                To exercise any of these rights, please contact us at{" "}
                <a
                  href="mailto:privacy@iropit.com"
                  className="text-primary-dark hover:underline"
                >
                  privacy@iropit.com
                </a>{" "}
                or{" "}
                <a
                  href="mailto:info@iRopit.com"
                  className="text-primary-dark hover:underline"
                >
                  info@iRopit.com
                </a>
                . We will respond to your request within 30 days.
              </p>
            </div>

            {/* Data Retention */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                9. Data Retention
              </h2>
              <p className="text-txt-secondary leading-relaxed mb-4">
                We retain your personal data for as long as your account is
                active or as needed to provide you with our Services.
                Specifically:
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-2 mb-4">
                <li>
                  <strong className="text-txt">Account data</strong> — Retained
                  until you delete your account
                </li>
                <li>
                  <strong className="text-txt">SMS and call data</strong> —
                  Retained as long as your account is active; you can delete
                  individual items at any time
                </li>
                <li>
                  <strong className="text-txt">Chat messages and files</strong>{" "}
                  — Retained until deleted by the user or account deletion
                </li>
                <li>
                  <strong className="text-txt">Device information</strong> —
                  Removed when you unregister a device or delete your account
                </li>
                <li>
                  <strong className="text-txt">Usage preferences</strong> —
                  Retained with your account; reset on account deletion
                </li>
              </ul>
              <p className="text-txt-secondary leading-relaxed">
                When you delete your account, all associated data is permanently
                removed from our servers within 30 days, except where retention
                is required by law.
              </p>
            </div>

            {/* Children */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                10. Children&apos;s Privacy
              </h2>
              <p className="text-txt-secondary leading-relaxed">
                Our Services are not directed to children under the age of 13
                (or the applicable age of consent in your jurisdiction). We do
                not knowingly collect personal information from children. If we
                become aware that we have collected personal data from a child
                without parental consent, we will take steps to delete that
                information. If you believe that your child has provided us with
                personal information, please contact us at{" "}
                <a
                  href="mailto:privacy@iropit.com"
                  className="text-primary-dark hover:underline"
                >
                  privacy@iropit.com
                </a>
                .
              </p>
            </div>

            {/* Third-Party Services */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                11. Third-Party Services
              </h2>
              <p className="text-txt-secondary leading-relaxed mb-4">
                iRopit uses the following third-party services:
              </p>
              <div className="space-y-3 mb-6">
                {[
                  {
                    name: "Google Firebase",
                    purpose:
                      "Authentication, database (Firestore), file storage, cloud functions, and push messaging (FCM)",
                    link: "https://firebase.google.com/support/privacy",
                  },
                  {
                    name: "Google Sign-In",
                    purpose: "Optional social login for user authentication",
                    link: "https://policies.google.com/privacy",
                  },
                ].map((service) => (
                  <div
                    key={service.name}
                    className="bg-surface border border-border rounded-[var(--radius)] p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h4 className="font-semibold text-txt text-sm">
                          {service.name}
                        </h4>
                        <p className="text-xs text-txt-secondary m-0 mt-1">
                          {service.purpose}
                        </p>
                      </div>
                      <a
                        href={service.link}
                        className="text-xs text-primary-dark hover:underline shrink-0"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Privacy Policy →
                      </a>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-txt-secondary leading-relaxed">
                These third-party services have their own privacy policies. We
                recommend reviewing their privacy policies to understand how
                they handle your data.
              </p>
            </div>

            {/* International Transfers */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                12. International Data Transfers
              </h2>
              <p className="text-txt-secondary leading-relaxed">
                Your data may be transferred to and processed in countries other
                than your country of residence, as Firebase servers are located
                globally. We ensure that appropriate safeguards are in place for
                such transfers, relying on Google&apos;s compliance with
                applicable data protection regulations including GDPR Standard
                Contractual Clauses where applicable.
              </p>
            </div>

            {/* Changes */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                13. Changes to This Privacy Policy
              </h2>
              <p className="text-txt-secondary leading-relaxed">
                We may update this Privacy Policy from time to time. We will
                notify you of any changes by posting the new Privacy Policy on
                this page and updating the &quot;Last Updated&quot; date. For
                significant changes, we will notify you through in-app
                notifications or email. We encourage you to review this Privacy
                Policy periodically for any changes.
              </p>
            </div>

            {/* CCPA */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                14. California Privacy Rights (CCPA)
              </h2>
              <p className="text-txt-secondary leading-relaxed mb-4">
                If you are a California resident, you have additional rights
                under the California Consumer Privacy Act (CCPA):
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-1 mb-4">
                <li>
                  The right to know what personal information we collect, use,
                  and disclose
                </li>
                <li>
                  The right to request deletion of your personal information
                </li>
                <li>
                  The right to opt-out of the sale of personal information (we
                  do not sell personal information)
                </li>
                <li>
                  The right to non-discrimination for exercising your CCPA
                  rights
                </li>
              </ul>
            </div>

            {/* GDPR */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                15. European Privacy Rights (GDPR)
              </h2>
              <p className="text-txt-secondary leading-relaxed mb-4">
                If you are located in the European Economic Area (EEA), you have
                rights under the General Data Protection Regulation (GDPR). The
                legal bases for processing your data include:
              </p>
              <ul className="list-disc pl-6 text-txt-secondary space-y-1 mb-4">
                <li>
                  <strong className="text-txt">Consent:</strong> You provide
                  consent for data processing when you create an account and
                  grant permissions
                </li>
                <li>
                  <strong className="text-txt">Contractual necessity:</strong>{" "}
                  Processing is necessary to provide the Services you requested
                </li>
                <li>
                  <strong className="text-txt">Legitimate interests:</strong>{" "}
                  Processing for security, fraud prevention, and service
                  improvement
                </li>
              </ul>
              <p className="text-txt-secondary leading-relaxed">
                You may lodge a complaint with your local data protection
                authority if you believe your rights have been violated.
              </p>
            </div>

            {/* Contact */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-txt mb-4">
                16. Contact Us
              </h2>
              <p className="text-txt-secondary leading-relaxed mb-4">
                If you have any questions about this Privacy Policy, your data,
                or our privacy practices, please contact us:
              </p>
              <div className="bg-primary-soft border border-primary-light rounded-[var(--radius-lg)] p-6">
                <div className="space-y-3">
                  <p className="text-txt m-0">
                    <strong>Email:</strong>{" "}
                    <a
                      href="mailto:privacy@iropit.com"
                      className="text-primary-dark hover:underline"
                    >
                      privacy@iropit.com
                    </a>
                  </p>
                  <p className="text-txt m-0">
                    <strong>General Inquiries:</strong>{" "}
                    <a
                      href="mailto:info@iRopit.com"
                      className="text-primary-dark hover:underline"
                    >
                      info@iRopit.com
                    </a>
                  </p>
                  <p className="text-txt m-0">
                    <strong>Website:</strong>{" "}
                    <a
                      href="https://www.iropit.com"
                      className="text-primary-dark hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      www.iropit.com
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
