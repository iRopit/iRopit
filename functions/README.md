# Firebase Cloud Functions for iRopit

هذا المجلد يحتوي على Cloud Functions التي تعمل على Firebase لإرسال Push Notifications.

## المتطلبات

1. **Firebase CLI**: تثبيت Firebase CLI

   ```bash
   npm install -g firebase-tools
   ```

2. **تسجيل الدخول لـ Firebase**:
   ```bash
   firebase login
   ```

## التثبيت

```bash
cd functions
npm install
```

## النشر (Deploy)

```bash
firebase deploy --only functions
```

## إعداد Email (أول تسجيل دخول)

الـ Function `sendFirstLoginSetupEmail` ترسل رسالة setup لمرة واحدة عند إنشاء مستخدم Firebase Auth جديد (أول تسجيل دخول/إنشاء حساب).

### إعداد SMTP عبر Firebase config

```bash
firebase functions:config:set smtp.host="smtp.yourprovider.com" smtp.port="465" smtp.secure="true" smtp.user="info@iRopit.com" smtp.pass="YOUR_SMTP_PASSWORD"
firebase deploy --only functions
```

### أو عبر environment variables (للاختبار المحلي)

```bash
set SMTP_HOST=smtp.yourprovider.com
set SMTP_PORT=465
set SMTP_SECURE=true
set SMTP_USER=info@iRopit.com
set SMTP_PASS=YOUR_SMTP_PASSWORD
```

## الـ Functions المتاحة

### 1. `sendPushNotification`

- **Trigger**: عند إنشاء document جديد في collection `push_notifications`
- **الوظيفة**: يرسل FCM notification للجهاز المحدد
- **يستخدم من**: الإكستنشن عند إرسال رسالة Chat

### 2. `onNewChatMessage`

- **Trigger**: عند إنشاء document جديد في collection `chats`
- **الوظيفة**: يرسل إشعار لجميع أجهزة المستخدم عند إرسال رسالة من الإكستنشن
- **ملاحظة**: هذا بديل مباشر - يمكن استخدامه بدلاً من `sendPushNotification`

### 3. `cleanupOldNotifications`

- **Trigger**: يعمل يومياً الساعة 00:00 UTC
- **الوظيفة**: حذف الإشعارات القديمة (أكثر من 24 ساعة)

### 4. `sendFirstLoginSetupEmail`

- **Trigger**: عند إنشاء مستخدم جديد في Firebase Auth
- **الوظيفة**: إرسال Email ترحيبي/setup لمرة واحدة فقط
- **الحماية من التكرار**: يتم حفظ `firstLoginSetupEmailSentAt` في `users/{uid}` بعد الإرسال

## الاختبار المحلي

```bash
npm run serve
```

## عرض Logs

```bash
firebase functions:log
```

## ملاحظات مهمة

1. تأكد من أن التطبيق يحفظ FCM Token عند تسجيل الجهاز
2. يجب أن يكون لديك Blaze Plan (مدفوع) لاستخدام Cloud Functions
3. الـ Function `onNewChatMessage` ترسل الإشعارات مباشرة من الـ chats collection، بينما `sendPushNotification` تحتاج لإنشاء document في `push_notifications`
