# iRopit - Product Requirements Document

## Overview

iRopit is a mobile + browser extension solution that syncs an Android phone's notifications, SMS messages, and call logs with a Chrome browser extension. Users can view and manage their phone activity directly from their computer.

## Components

1. **Android App (React Native)** - Runs on the user's phone, captures notifications/SMS/calls and syncs to Firebase
2. **Chrome Extension** - Displays synced data from Firebase in a popup UI

---

## Core Features

### 1. Authentication

- User can register with email and password
- User can login with email and password
- User stays logged in across sessions
- User can logout
- User can delete account

### 2. Onboarding Flow (7 steps)

- **Step 1 - Welcome**: Welcome screen with app logo and intro
- **Step 2 - Language**: Choose Arabic or English (bilingual app)
- **Step 3 - Privacy Policy**: Display privacy policy, user must accept before continuing
- **Step 4 - Theme**: Choose light/dark/system theme
- **Step 5 - Permissions**: Request required Android permissions (Notification, SMS, Calls, Contacts)
- **Step 6 - Overview**: App feature overview
- **Step 7 - Security**: Encryption info (AES-256)

### 3. Notifications Sync

- Android app captures device notifications via NotificationListenerService
- Notifications are encrypted (AES-256) and saved to Firebase Firestore
- Chrome Extension displays notifications in real-time via Firestore onSnapshot listener
- Deduplication: only "added" Firestore events processed, docId-based dedup
- Google system packages are filtered out

### 4. SMS Sync

- Android app reads incoming and sent SMS messages
- SMS conversations grouped by contact/phone number
- Chrome Extension shows SMS conversations list
- User can open a conversation to see full message history
- User can send SMS reply from Chrome Extension
- Unread SMS conversations are marked and shown at top
- Clicking on unread conversation marks it as read

### 5. Call Log Sync

- Android app captures incoming, outgoing, and missed calls
- Call data: phone number, contact name, call type, duration, timestamp
- Saved directly to Firebase for background capture
- Chrome Extension displays call history

### 6. Contacts

- App reads device contacts to show names instead of phone numbers
- Contact names displayed in SMS conversations and call logs

### 7. Chrome Extension Popup

- Tab navigation: Notifications / SMS / Calls
- Notification list with app icon, title, body, timestamp
- SMS conversation list with unread count badges
- SMS conversation detail with message history
- Message input to send SMS reply
- Call list with call type icons (incoming/outgoing/missed)
- Settings: device selection, encryption key
- Real-time updates via Firebase onSnapshot

### 8. Settings & Preferences

- Dark/Light mode toggle
- Language selection (Arabic/English) with RTL support
- Privacy Policy screen
- Terms of Service screen
- Logout
- Delete Account

---

## Non-Functional Requirements

### Security

- All data encrypted with AES-256 before storing in Firebase
- Unique encryption key per user account
- Data only accessible by the account owner

### Performance

- Notification sync should happen within 5 seconds
- SMS list should load within 3 seconds
- Chrome Extension popup should open within 1 second

### Compatibility

- Android: minSdk 24 (Android 7.0+), targetSdk 36 (Android 15)
- Chrome Extension: Manifest V3
- Bilingual: Arabic (RTL) and English (LTR)

---

## User Flows

### New User Flow

1. Install app → Open app → Welcome screen
2. Select language → Accept privacy policy
3. Choose theme → Grant permissions → Complete onboarding
4. Login/Register → App syncs data to Firebase
5. Install Chrome Extension → Login with same account
6. Extension shows synced notifications/SMS/calls

### SMS Reply Flow

1. User opens Chrome Extension → Click SMS tab
2. See list of conversations → Click on conversation
3. View message history → Type reply → Send
4. Message sent via phone number through Android app

### Call Notification Flow

1. Incoming call on phone → CallReceiver captures it
2. Call saved to Firebase (during and after call)
3. Chrome Extension shows call in calls tab

---

## Tech Stack

- **Mobile**: React Native (Android), Java native modules
- **Extension**: JavaScript, Chrome Extension Manifest V3
- **Backend**: Firebase Firestore, Firebase Auth, Firebase Storage
- **Encryption**: AES-256 (client-side)
- **Build**: Gradle (Android), esbuild (Extension)
