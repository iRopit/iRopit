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

### إعداد SMTP عبر Firebase Params (موصى به)

```bash
firebase functions:params:set SMTP_HOST="mail.privateemail.com"
firebase functions:params:set SMTP_PORT="465"
firebase functions:params:set SMTP_SECURE="true"
firebase functions:params:set SMTP_USER="welcome@iRopit.com"
firebase functions:params:set SMTP_PASS="YOUR_SMTP_PASSWORD"
firebase deploy --only functions
```

### إعداد DKIM للتوقيع من داخل الـ Function (اختياري لكن موصى به)

يمكن تفعيل DKIM مباشرة في Nodemailer عبر الإعدادات التالية:

```bash
firebase functions:params:set DKIM_DOMAIN="iropit.com"
firebase functions:params:set DKIM_SELECTOR="s1"
firebase functions:params:set DKIM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----"
firebase deploy --only functions
```

أو عبر environment variables:

```bash
set DKIM_DOMAIN=iropit.com
set DKIM_SELECTOR=s1
set DKIM_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----
```

### أو عبر environment variables (للاختبار المحلي)

```bash
set SMTP_HOST=smtp.yourprovider.com
set SMTP_PORT=465
set SMTP_SECURE=true
set SMTP_USER=welcome@iRopit.com
set SMTP_PASS=YOUR_SMTP_PASSWORD
```

## إعداد SPF و DKIM و DMARC على DNS (مطلوب للإرسال الموثوق)

مهم: SPF و DMARC (وسجل DKIM العام) يتم إعدادهم في DNS للدومين، وليس داخل الكود.

### 1) SPF (TXT على root domain)

مثال عام (عدله حسب مزود الإرسال):

```txt
Host: @
Type: TXT
Value: v=spf1 include:_spf.google.com include:sendgrid.net -all
```

اختر include الصحيح فقط لمزودك الفعلي، ولا تضع مزودات غير مستخدمة.

### 2) DKIM (TXT على selector._domainkey)

مثال:

```txt
Host: s1._domainkey
Type: TXT
Value: v=DKIM1; k=rsa; p=PUBLIC_KEY_FROM_PROVIDER
```

القيمة p يجب أن تكون المفتاح العام المقابل للمفتاح الخاص المستخدم في DKIM_PRIVATE_KEY.

### 3) DMARC (TXT على _dmarc)

ابدأ بسياسة مراقبة ثم شدد تدريجيا:

```txt
Host: _dmarc
Type: TXT
Value: v=DMARC1; p=quarantine; adkim=s; aspf=s; pct=100; rua=mailto:dmarc@iropit.com; ruf=mailto:dmarc@iropit.com; fo=1
```

إذا كل شيء مستقر، يمكن رفع السياسة إلى p=reject.

## التحقق بعد الإعداد

1. أرسل رسالة اختبار إلى Gmail/Outlook.
2. تأكد من ظهور SPF=pass و DKIM=pass و DMARC=pass في headers.
3. راقب تقارير DMARC على البريد المحدد في rua.

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
4. تم إلغاء الاعتماد على `functions.config()` بسبب إيقافه من Firebase في 2026. استخدم `functions:params:set` بدلاً منه.
