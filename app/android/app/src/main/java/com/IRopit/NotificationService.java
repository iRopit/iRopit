package com.IRopit;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.os.BatteryManager;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.ContactsContract;
import android.util.Base64;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.facebook.react.ReactApplication;
import com.facebook.react.ReactHost;
import com.facebook.react.bridge.ReactContext;
import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.Set;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class NotificationService extends NotificationListenerService {
    private static final String TAG = "ZyncIT_NotifService";
    private static final String CHANNEL_ID = "iropit_service_channel";
    private static final int FOREGROUND_NOTIFICATION_ID = 1001;
    
    private static NotificationService instance;
    private Handler mainHandler;
    private FirebaseHelper firebaseHelper;

    // Cache for app icons (Base64)
    private Map<String, String> iconCache = new ConcurrentHashMap<>();

    // Track processed notifications to avoid duplicates
    private Set<String> processedKeys = new HashSet<>();
    private Map<String, Long> lastNotificationTime = new HashMap<>();
    
    // Track notification content to avoid duplicate content (for apps like Gmail)
    private Map<String, String> lastNotificationContent = new ConcurrentHashMap<>();
    
    // Track last SMS text per notification key to detect new messages vs duplicates
    private Map<String, String> lastSmsContent = new ConcurrentHashMap<>();
    // Track last email snapshot per notification key to allow same-key updates when content changes
    private Map<String, String> lastEmailContent = new ConcurrentHashMap<>();

    // Minimum time between same-key notifications (ms)
    private static final long DUPLICATE_THRESHOLD_MS = 2000;
    
    // Longer threshold for apps that repeatedly send unread notifications (Gmail, etc.)
    private static final long CONTENT_DUPLICATE_THRESHOLD_MS = 300000; // 5 minutes

    // Track service start time to ignore old notifications
    private long serviceStartTime;

    // Battery receiver (dynamically registered — ACTION_BATTERY_CHANGED can't use manifest)
    private BroadcastReceiver batteryReceiver;
    private int lastBatteryLevel = -1;
    private boolean lastBatteryCharging = false;

    // Periodic polling of active email notifications (catches silently-delivered emails)
    private Runnable emailPollingRunnable;
    // Tracks "key_postTime" fingerprints already processed via polling to avoid re-sending
    private final Set<String> polledEmailKeys = new HashSet<>();

    // Package names for SMS apps
    private static final String[] SMS_PACKAGES = {
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "com.android.mms",
        "com.xiaomi.mms",
        "com.miui.sms",
        "com.huawei.message",
        "com.oneplus.mms",
        "com.sonyericsson.conversations"
    };

    // Package names for Phone/Dialer apps
    private static final String[] PHONE_PACKAGES = {
        "com.google.android.dialer",
        "com.samsung.android.dialer",
        "com.samsung.android.incallui",
        "com.android.dialer",
        "com.android.phone",
        "com.xiaomi.dialer",
        "com.miui.phone",
        "com.huawei.contacts",
        "com.oneplus.dialer",
        "com.sonyericsson.phone"
    };

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        mainHandler = new Handler(Looper.getMainLooper());
        serviceStartTime = System.currentTimeMillis();
        firebaseHelper = FirebaseHelper.getInstance(this);
        Log.i(TAG, "=== NotificationService CREATED ===");

        // Register battery change receiver dynamically (sticky broadcast, must be dynamic)
        registerBatteryReceiver();

        // Start as foreground service to prevent MIUI from killing it
        startForegroundServiceWithNotification();
    }

    /**
     * Start the service as a foreground service with a persistent notification.
     * This prevents aggressive battery optimization (especially on MIUI) from killing the service.
     */
    private void startForegroundServiceWithNotification() {
        try {
            createNotificationChannel();
            
            Intent notificationIntent = new Intent(this, getMainActivityClass());
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent, 
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            );

            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("iRopit")
                .setContentText("Running in background")
                .setSmallIcon(R.drawable.ic_notification)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(FOREGROUND_NOTIFICATION_ID, notification, 
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(FOREGROUND_NOTIFICATION_ID, notification);
            }
            
            Log.i(TAG, "Foreground service started successfully");
        } catch (Exception e) {
            Log.e(TAG, "Error starting foreground service: " + e.getMessage());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "iRopit Background Service",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps iRopit running to sync your data");
            channel.setShowBadge(false);
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Class<?> getMainActivityClass() {
        try {
            return Class.forName("com.IRopit.MainActivity");
        } catch (ClassNotFoundException e) {
            Log.e(TAG, "MainActivity not found");
            return null;
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
        processedKeys.clear();
        lastNotificationTime.clear();
        lastEmailContent.clear();
        // Stop email polling
        if (mainHandler != null && emailPollingRunnable != null) {
            mainHandler.removeCallbacks(emailPollingRunnable);
        }
        polledEmailKeys.clear();
        // Unregister battery receiver
        if (batteryReceiver != null) {
            try { unregisterReceiver(batteryReceiver); } catch (Exception ignored) {}
            batteryReceiver = null;
        }
        Log.i(TAG, "=== NotificationService DESTROYED ===");
        
        // Request rebind when destroyed
        requestRebind();
    }
    
    private void requestRebind() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                android.content.ComponentName componentName = new android.content.ComponentName(
                    getPackageName(), 
                    NotificationService.class.getName()
                );
                NotificationListenerService.requestRebind(componentName);
                Log.i(TAG, "Requested rebind after destruction");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error requesting rebind: " + e.getMessage());
        }
    }

    private void registerBatteryReceiver() {
        batteryReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) return;
                int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                int status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                if (level < 0 || scale <= 0) return;

                int percent = (int) Math.round((level * 100.0) / scale);
                boolean isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING
                        || status == BatteryManager.BATTERY_STATUS_FULL;

                // Throttle: skip if nothing changed
                if (percent == lastBatteryLevel && isCharging == lastBatteryCharging) return;

                lastBatteryLevel = percent;
                lastBatteryCharging = isCharging;
                Log.d(TAG, "Battery update: " + percent + "% charging=" + isCharging);
                firebaseHelper.updateBatteryLevel(percent, isCharging);
            }
        };

        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        registerReceiver(batteryReceiver, filter);
        Log.i(TAG, "Battery receiver registered");
    }

    /**
     * Schedule periodic scanning of active notifications for email apps.
     * Some email clients (Outlook, Gmail) deliver emails silently — the notification
     * panel gets updated but onNotificationPosted is never fired (e.g. when the app
     * is in the foreground, or during a background batch-sync). Polling every 5 minutes
     * catches these missed entries.
     */
    private void scheduleEmailPolling() {
        if (mainHandler == null) return;
        if (emailPollingRunnable != null) {
            mainHandler.removeCallbacks(emailPollingRunnable);
        }
        emailPollingRunnable = new Runnable() {
            @Override
            public void run() {
                pollActiveEmailNotifications();
                mainHandler.postDelayed(this, 5 * 60 * 1000); // repeat every 5 minutes
            }
        };
        // First poll 15 seconds after connect (let the service stabilise)
        mainHandler.postDelayed(emailPollingRunnable, 15000);
    }

    /**
     * Scan all currently-active notifications and process any email notification
     * that hasn't already been forwarded to Firestore.
     */
    private void pollActiveEmailNotifications() {
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active == null || active.length == 0) return;

            long now = System.currentTimeMillis();
            int processed = 0;
            for (StatusBarNotification sbn : active) {
                if (!isEmailPackage(sbn.getPackageName())) continue;

                // Unique fingerprint: notification key + original postTime
                String pollKey = sbn.getKey() + "_" + sbn.getPostTime();
                if (polledEmailKeys.contains(pollKey)) continue;

                // If onNotificationPosted already handled this recently, just mark it
                Long lastTime = lastNotificationTime.get(sbn.getKey());
                if (lastTime != null && (now - lastTime) < 10 * 60 * 1000) {
                    polledEmailKeys.add(pollKey);
                    continue;
                }

                Log.i(TAG, "📧 POLL: Found unprocessed email notification: "
                        + sbn.getPackageName() + " key=" + sbn.getKey()
                        + " postTime=" + sbn.getPostTime());
                polledEmailKeys.add(pollKey);
                processNotification(sbn);
                processed++;
            }
            if (processed > 0) {
                Log.i(TAG, "📧 POLL: Forwarded " + processed + " previously-missed email(s)");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error during email notification poll: " + e.getMessage());
        }
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        serviceStartTime = System.currentTimeMillis();
        Log.i(TAG, "=== NotificationService CONNECTED ===");
        
        // Ensure foreground service is running
        startForegroundServiceWithNotification();
        
        // Start periodic polling to catch email notifications that are silently
        // delivered (e.g. Outlook when the app is in the foreground,
        // or emails that arrive in a batch-sync window).
        scheduleEmailPolling();
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        Log.w(TAG, "=== NotificationService DISCONNECTED === Attempting aggressive rebind...");

        // Try to reconnect immediately
        requestRebind();
        
        // Schedule retries with increasing delays (MIUI often ignores first attempt)
        if (mainHandler != null) {
            mainHandler.postDelayed(this::requestRebind, 3000);   // 3s
            mainHandler.postDelayed(this::requestRebind, 10000);  // 10s
            mainHandler.postDelayed(this::requestRebind, 30000);  // 30s
            mainHandler.postDelayed(this::requestRebind, 60000);  // 1m
        }
    }

    public static NotificationService getInstance() {
        return instance;
    }

    public static boolean isConnected() {
        return instance != null;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) {
            Log.w(TAG, "Received null notification");
            return;
        }

        try {
            processNotification(sbn);
        } catch (Exception e) {
            Log.e(TAG, "❌ CRITICAL: Error processing notification - service survived: " + e.getMessage(), e);
        }
    }

    /**
     * Process a single notification. Extracted to a separate method so that
     * the try-catch in onNotificationPosted() can protect the entire service
     * from crashing due to any unexpected exception.
     */
    private void processNotification(StatusBarNotification sbn) {
        String packageName = sbn.getPackageName();
        String key = sbn.getKey();
        long postTime = sbn.getPostTime();
        long now = System.currentTimeMillis();

        // Log ALL notifications for WhatsApp debugging
        if (packageName.equals("com.whatsapp") || packageName.equals("com.whatsapp.w4b")) {
            Log.i(TAG, "🟢 WHATSAPP NOTIFICATION RECEIVED: " + key);
        }

        // Skip our own notifications
        if (packageName.equals("com.IRopit")) {
            return;
        }

        // Skip Google system/persistent notifications that repeat constantly
        // These are system-level notifications (weather, at-a-glance, services) 
        // that get reposted frequently and are not meaningful user notifications
        if (isGoogleSystemPackage(packageName)) {
            Log.d(TAG, "Skipping Google system notification: " + packageName + " - " + key);
            return;
        }

        // Compute isEmailPkg early — used by both the staleness filter and group-summary filter below
        boolean isEmailPkg = isEmailPackage(packageName);

        // Skip notifications older than service start (already existing).
        // Exception: email apps — their postTime is the email's server-received timestamp,
        // which may predate service start if the service restarted while the phone had
        // unread mail. Polling (scheduleEmailPolling) handles those separately.
        if (postTime < serviceStartTime && !isEmailPkg) {
            if (packageName.equals("com.whatsapp") || packageName.equals("com.whatsapp.w4b")) {
                Log.d(TAG, "🔴 WHATSAPP: Skipping old notification (posted before service started)");
            }
            Log.d(TAG, "Skipping old notification: " + key + " (posted before service started)");
            return;
        }

        // Skip if notification is older than 5 minutes.
        // Exception: email apps set postTime to the email's server-received timestamp,
        // not the notification delivery time. An email synced hours later would have a
        // postTime far in the past but is still a fresh notification we must capture.
        if (now - postTime > 5 * 60 * 1000) {
            if (isEmailPkg) {
                Log.d(TAG, "📧 Email with old postTime, allowing through: " + key + " (age=" + (now - postTime) / 1000 + "s)");
            } else {
                if (packageName.equals("com.whatsapp") || packageName.equals("com.whatsapp.w4b")) {
                    Log.d(TAG, "🔴 WHATSAPP: Skipping stale notification (older than 5min)");
                }
                Log.d(TAG, "Skipping stale notification: " + key + " (older than 5min)");
                return;
            }
        }

        Notification notification = sbn.getNotification();
        if (notification == null) {
            Log.w(TAG, "Notification object is null for: " + packageName);
            return;
        }

        // Skip group summary notifications
        // Exception: email apps (Gmail, Outlook, etc.) use FLAG_GROUP_SUMMARY even for
        // a single new email when the inbox already has unread messages. Filtering them
        // out means any email after the first unread one is silently dropped.
        // (isEmailPkg is computed earlier, before the staleness filter)
        if ((notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) {
            if (!isEmailPkg) {
                if (packageName.equals("com.whatsapp") || packageName.equals("com.whatsapp.w4b")) {
                    Log.d(TAG, "🔴 WHATSAPP: Skipping group summary");
                }
                Log.d(TAG, "Skipping group summary: " + key);
                return;
            }
            Log.d(TAG, "Email group summary - allowing through: " + packageName + " - " + key);
        }

        // Skip ongoing/persistent notifications (e.g., "running in background", music players, etc.)
        // These are NOT real notification events - they stay in the status bar permanently.
        // Exception: SMS/Phone/WhatsApp apps may use ongoing for active calls/conversations
        if ((notification.flags & Notification.FLAG_ONGOING_EVENT) != 0) {
            if (!isSmsPackage(packageName) && !isPhonePackage(packageName) && 
                !packageName.equals("com.whatsapp") && !packageName.equals("com.whatsapp.w4b")) {
                Log.d(TAG, "Skipping ongoing/persistent notification: " + packageName + " - " + key);
                return;
            }
        }

        // Check for duplicate
        Long lastTime = lastNotificationTime.get(key);
        if (lastTime != null && (now - lastTime) < DUPLICATE_THRESHOLD_MS) {
            // For SMS apps, allow same-key if text content changed
            // Google Messages reuses the same notification key for each conversation
            // and updates it with new message content
            if (isSmsPackage(packageName)) {
                String lastSmsText = lastSmsContent.get(key);
                Bundle dupExtras = notification.extras;
                String currentText = "";
                if (dupExtras != null) {
                    CharSequence dupTextCs = dupExtras.getCharSequence(Notification.EXTRA_TEXT);
                    currentText = dupTextCs != null ? dupTextCs.toString() : "";
                }
                if (lastSmsText != null && lastSmsText.equals(currentText)) {
                    Log.d(TAG, "Skipping duplicate SMS (same content): " + key);
                    return;
                }
                // Different text = new message, allow through
                Log.i(TAG, "📱 SMS notification updated with new content, processing: " + key);
            } else if (isEmailPkg) {
                Bundle dupExtras = notification.extras;
                String dupTitle = "";
                String dupText = "";
                String dupBigText = "";
                String dupSubText = "";
                if (dupExtras != null) {
                    CharSequence dupTitleCs = dupExtras.getCharSequence(Notification.EXTRA_TITLE);
                    CharSequence dupTextCs = dupExtras.getCharSequence(Notification.EXTRA_TEXT);
                    CharSequence dupBigCs = dupExtras.getCharSequence(Notification.EXTRA_BIG_TEXT);
                    CharSequence dupSubCs = dupExtras.getCharSequence(Notification.EXTRA_SUB_TEXT);
                    dupTitle = dupTitleCs != null ? dupTitleCs.toString() : "";
                    dupText = dupTextCs != null ? dupTextCs.toString() : "";
                    dupBigText = dupBigCs != null ? dupBigCs.toString() : "";
                    dupSubText = dupSubCs != null ? dupSubCs.toString() : "";
                }
                String currentEmailSnapshot = dupTitle + "|" + dupText + "|" + dupBigText + "|" + dupSubText;
                String previousEmailSnapshot = lastEmailContent.get(key);
                if (previousEmailSnapshot != null && previousEmailSnapshot.equals(currentEmailSnapshot)) {
                    Log.d(TAG, "Skipping duplicate email (same content): " + key);
                    return;
                }
                Log.i(TAG, "📧 Email notification updated with new content, processing: " + key);
            } else {
                if (packageName.equals("com.whatsapp") || packageName.equals("com.whatsapp.w4b")) {
                    Log.d(TAG, "🔴 WHATSAPP: Skipping duplicate notification");
                }
                Log.d(TAG, "Skipping duplicate notification: " + key);
                return;
            }
        }

        Bundle extras = notification.extras;
        String title = "";
        String text = "";
        String bigText = "";
        String subText = "";
        String extractedPhoneNumber = null; // رقم الهاتف للـ SMS أو المكالمات

        if (extras != null) {
            CharSequence titleCs = extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence textCs = extras.getCharSequence(Notification.EXTRA_TEXT);
            CharSequence bigTextCs = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            CharSequence subTextCs = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);

            title = titleCs != null ? titleCs.toString() : "";
            text = textCs != null ? textCs.toString() : "";
            bigText = bigTextCs != null ? bigTextCs.toString() : "";
            subText = subTextCs != null ? subTextCs.toString() : "";
            
            // محاولة استخراج رقم الهاتف من extras (لتطبيقات SMS)
            if (isSmsPackage(packageName)) {
                // Google Messages: استخدم extra_im_notification_participant_normalized_destination
                String normalizedDest = extras.getString("extra_im_notification_participant_normalized_destination");
                if (normalizedDest != null && !normalizedDest.isEmpty()) {
                    extractedPhoneNumber = normalizedDest;
                    Log.d(TAG, "SMS phoneNumber from normalized_destination: " + extractedPhoneNumber);
                }
                
                // Samsung Messages: جرب android.people أو android.remoteInputHistory
                if (extractedPhoneNumber == null) {
                    try {
                        // android.people.list may be ArrayList<Person> or CharSequence[] depending on device
                        Object peopleObj = extras.get("android.people.list");
                        if (peopleObj instanceof String[]) {
                            String[] people = (String[]) peopleObj;
                            for (String person : people) {
                                if (person != null && isPhoneNumber(person.replaceAll("[^0-9+]", ""))) {
                                    extractedPhoneNumber = person.replaceAll("[^0-9+]", "");
                                    Log.d(TAG, "SMS phoneNumber from people list: " + extractedPhoneNumber);
                                    break;
                                }
                            }
                        } else if (peopleObj instanceof java.util.ArrayList) {
                            // On newer Android, this is ArrayList<Person>
                            java.util.ArrayList<?> peopleList = (java.util.ArrayList<?>) peopleObj;
                            for (Object person : peopleList) {
                                String personStr = person != null ? person.toString() : null;
                                if (personStr != null && isPhoneNumber(personStr.replaceAll("[^0-9+]", ""))) {
                                    extractedPhoneNumber = personStr.replaceAll("[^0-9+]", "");
                                    Log.d(TAG, "SMS phoneNumber from people list (ArrayList): " + extractedPhoneNumber);
                                    break;
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "Error reading people list extra: " + e.getMessage());
                    }
                }
                
                // جرب android.summaryText (يحتوي أحياناً الرقم)
                if (extractedPhoneNumber == null) {
                    CharSequence summaryText = extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT);
                    if (summaryText != null && isPhoneNumber(summaryText.toString())) {
                        extractedPhoneNumber = summaryText.toString();
                    }
                }
                
                // جرب android.infoText
                if (extractedPhoneNumber == null) {
                    CharSequence infoText = extras.getCharSequence(Notification.EXTRA_INFO_TEXT);
                    if (infoText != null && isPhoneNumber(infoText.toString())) {
                        extractedPhoneNumber = infoText.toString();
                    }
                }
                
                // جرب subText
                if (extractedPhoneNumber == null && !subText.isEmpty() && isPhoneNumber(subText)) {
                    extractedPhoneNumber = subText;
                }
                
                // جرب استخراج رقم من title (ممكن يكون title = "050 123 4567")
                if (extractedPhoneNumber == null && title != null && !title.isEmpty()) {
                    String cleanTitle = title.replaceAll("[\\s\\-\\(\\)]", "");
                    if (isPhoneNumber(cleanTitle)) {
                        extractedPhoneNumber = cleanTitle;
                        Log.d(TAG, "SMS phoneNumber from cleaned title: " + extractedPhoneNumber);
                    }
                }
                
                // Log SMS extras for debugging (safely)
                Log.d(TAG, "SMS Extras - title: " + title + ", text: " + text + ", subText: " + subText + ", phoneNumber: " + extractedPhoneNumber);
                Log.d(TAG, "SMS Notification Key: " + key);
                // Safely dump extras keys (some values may be non-serializable Parcelables)
                try {
                    for (String extraKey : extras.keySet()) {
                        try {
                            Object value = extras.get(extraKey);
                            if (value instanceof String || value instanceof CharSequence) {
                                Log.d(TAG, "SMS Extra[" + extraKey + "] = " + value);
                            } else if (value != null) {
                                Log.d(TAG, "SMS Extra[" + extraKey + "] = (" + value.getClass().getSimpleName() + ")");
                            }
                        } catch (Exception innerEx) {
                            Log.d(TAG, "SMS Extra[" + extraKey + "] = <unreadable>");
                        }
                    }
                } catch (Exception dumpEx) {
                    Log.w(TAG, "Error dumping SMS extras: " + dumpEx.getMessage());
                }
            }
            
            // محاولة استخراج رقم الهاتف للمكالمات
            if (isPhonePackage(packageName)) {
                Log.d(TAG, "📞 CALL NOTIFICATION - Extracting phone number from: title=" + title + ", text=" + text);

                // Diagnostic dump (v1.1.9): for saved-contact outgoing calls the dialer
                // often omits a tel: URI, so dump every extra + Person URI to reveal
                // exactly what source carries the number on this device/dialer.
                try {
                    if (extras != null) {
                        for (String extraKey : extras.keySet()) {
                            try {
                                Object value = extras.get(extraKey);
                                if (value instanceof String || value instanceof CharSequence) {
                                    Log.d(TAG, "📞 CallExtra[" + extraKey + "] = " + value);
                                } else if (value != null) {
                                    Log.d(TAG, "📞 CallExtra[" + extraKey + "] = (" + value.getClass().getSimpleName() + ")");
                                }
                            } catch (Exception innerEx) {
                                Log.d(TAG, "📞 CallExtra[" + extraKey + "] = <unreadable>");
                            }
                        }
                        dumpCallPersonUris(extras);
                    }
                } catch (Exception dumpEx) {
                    Log.w(TAG, "Error dumping call extras: " + dumpEx.getMessage());
                }
                
                // جرب استخراج من text أولاً (قد يحتوي على الرقم)
                if (text != null && !text.isEmpty() && isPhoneNumber(text)) {
                    extractedPhoneNumber = text;
                    Log.d(TAG, "📞 Found phone number in text: " + extractedPhoneNumber);
                }
                
                // جرب استخراج من subText
                if (extractedPhoneNumber == null && !subText.isEmpty() && isPhoneNumber(subText)) {
                    extractedPhoneNumber = subText;
                    Log.d(TAG, "📞 Found phone number in subText: " + extractedPhoneNumber);
                }
                
                // جرب استخراج من title إذا كان رقم
                if (extractedPhoneNumber == null && title != null && !title.isEmpty() && isPhoneNumber(title)) {
                    extractedPhoneNumber = title;
                    Log.d(TAG, "📞 Found phone number in title: " + extractedPhoneNumber);
                }
                
                // جرب استخراج رقم من داخل title (قد يحتوي على رموز)
                if (extractedPhoneNumber == null && title != null && !title.isEmpty()) {
                    String phoneInTitle = extractPhoneFromText(title);
                    if (phoneInTitle != null) {
                        extractedPhoneNumber = phoneInTitle;
                        Log.d(TAG, "📞 Extracted phone from title text: " + extractedPhoneNumber);
                    }
                }
                
                // إذا لم نجد رقم، جرب البحث في جهات الاتصال بالاسم
                // SKIP for outgoing calls: this turns a dialed short code (e.g. "110")
                // into a contact's full saved number when Google Dialer T9-matches the
                // notification title to a contact (e.g. "Springs 2 $110k").
                if (extractedPhoneNumber == null && title != null && !title.isEmpty()
                        && !CallReceiver.isOutgoingCallActive()) {
                    String phoneFromContacts = getPhoneNumberFromContactName(title);
                    if (phoneFromContacts != null) {
                        extractedPhoneNumber = phoneFromContacts;
                        Log.d(TAG, "📞 Found phone number from contacts for '" + title + "': " + extractedPhoneNumber);
                    }
                }

                // v1.1.2.22: For unregistered numbers the dialer may put the digits
                // in `text`/`subText` (e.g. "0501234567 • Mobile") rather than title.
                // Try extractPhoneFromText on those too — strips formatting and
                // returns any 7–15 digit sequence with an optional leading '+'.
                if (extractedPhoneNumber == null && text != null && !text.isEmpty()) {
                    String p = extractPhoneFromText(text);
                    if (p != null) {
                        extractedPhoneNumber = p;
                        Log.d(TAG, "📞 Extracted phone from text: " + extractedPhoneNumber);
                    }
                }
                if (extractedPhoneNumber == null && subText != null && !subText.isEmpty()) {
                    String p = extractPhoneFromText(subText);
                    if (p != null) {
                        extractedPhoneNumber = p;
                        Log.d(TAG, "📞 Extracted phone from subText: " + extractedPhoneNumber);
                    }
                }

                // v1.1.2.22: Inspect Notification.CallStyle extras (API 31+) and the
                // generic EXTRA_PEOPLE array — these carry tel: URIs even when the
                // visible title/text show a contact-style label.
                // RE-ENABLED for outgoing calls (v1.1.7): the CallStyle person URI is
                // an AUTHORITATIVE tel: URI of the actual dialed target — for a saved
                // contact this is the ONLY place the real number exists on Android 10+
                // (CallLog not populated mid-call, NEW_OUTGOING_CALL not broadcast,
                // title shows the contact NAME). Without this, outgoing_call is never
                // written for saved contacts and the extension popup never opens.
                // The T9 short-code concern (e.g. dialing "110" displayed as a contact)
                // does NOT apply here: the tel: URI carries the literal dialed digits,
                // not a name→number reverse lookup. Only getPhoneNumberFromContactName
                // (the name reverse-lookup above) stays disabled for outgoing calls.
                if (extractedPhoneNumber == null && extras != null) {
                    String p = extractPhoneFromCallExtras(extras);
                    if (p != null) {
                        extractedPhoneNumber = p;
                        Log.d(TAG, "📞 Extracted phone from CallStyle/people extras: " + extractedPhoneNumber);
                    }
                }

                // v1.1.2.22b: Short-code fallback (3–15 digits). Carriers/IVRs use
                // short codes like 155, 911, *100# — these are valid dialed numbers
                // but the standard 7+ digit extractor rejects them. Try the loose
                // extractor on title/text/subText.
                if (extractedPhoneNumber == null && title != null && !title.isEmpty()) {
                    String p = extractDialedNumberFromText(title);
                    if (p != null) {
                        extractedPhoneNumber = p;
                        Log.d(TAG, "📞 Extracted short-code from title: " + extractedPhoneNumber);
                    }
                }
                if (extractedPhoneNumber == null && text != null && !text.isEmpty()) {
                    String p = extractDialedNumberFromText(text);
                    if (p != null) {
                        extractedPhoneNumber = p;
                        Log.d(TAG, "📞 Extracted short-code from text: " + extractedPhoneNumber);
                    }
                }
                if (extractedPhoneNumber == null && subText != null && !subText.isEmpty()) {
                    String p = extractDialedNumberFromText(subText);
                    if (p != null) {
                        extractedPhoneNumber = p;
                        Log.d(TAG, "📞 Extracted short-code from subText: " + extractedPhoneNumber);
                    }
                }

                // v1.1.2.22: Last-resort sweep — scan every CharSequence extra for a
                // phone-shaped substring. Custom dialers (Samsung, Xiaomi) sometimes
                // bury the dialed number in non-standard keys like "android.bigText"
                // or "android.summaryText".
                if (extractedPhoneNumber == null && extras != null) {
                    String p = sweepExtrasForPhone(extras);
                    if (p != null) {
                        extractedPhoneNumber = p;
                        Log.d(TAG, "📞 Extracted phone from extras sweep: " + extractedPhoneNumber);
                    }
                }

                Log.d(TAG, "📞 CALL - Final phoneNumber: " + extractedPhoneNumber + ", contactName: " + title);

                // BUGFIX (v1.1.2.21): On Android 10+ the CallLog row for an active
                // outgoing call is often not populated until the call ends, so the
                // CallReceiver retries miss it and the Chrome-extension popup never
                // opens. Use the dialer's ongoing notification as a reliable source
                // for the dialed number during an active outgoing call.
                if (extractedPhoneNumber != null && !extractedPhoneNumber.isEmpty()) {
                    try {
                        CallReceiver.onDialerNotificationNumber(this, extractedPhoneNumber);
                    } catch (Throwable t) {
                        Log.w(TAG, "onDialerNotificationNumber failed: " + t.getMessage());
                    }
                }
            }
        }

        // Skip if both title and text are empty
        if (title.isEmpty() && text.isEmpty()) {
            if (packageName.equals("com.whatsapp") || packageName.equals("com.whatsapp.w4b")) {
                Log.d(TAG, "🔴 WHATSAPP: Skipping empty notification");
            }
            Log.d(TAG, "Skipping empty notification from: " + packageName);
            return;
        }

        // Skip summary-style notifications (e.g., "X messages from Y chats")
        // Exception: email apps - "2 new messages" is the only indication that a 2nd email
        // arrived when Gmail bundles them. We still want to capture the latest content.
        if (isSummaryText(text) && !isEmailPkg) {
            if (packageName.equals("com.whatsapp") || packageName.equals("com.whatsapp.w4b")) {
                Log.d(TAG, "🔴 WHATSAPP: Skipping summary notification: " + text);
            }
            Log.d(TAG, "Skipping summary notification: " + text);
            return;
        }

        // For apps that repeatedly notify about unread messages (Gmail, Google, etc.)
        // Check if we've already processed the same content recently
        if (isRepetitiveNotificationApp(packageName)) {
            String contentKey = packageName + "_" + title + "_" + text;
            String lastContentTime = lastNotificationContent.get(contentKey);
            if (lastContentTime != null) {
                long lastTime2 = Long.parseLong(lastContentTime);
                if ((now - lastTime2) < CONTENT_DUPLICATE_THRESHOLD_MS) {
                    Log.d(TAG, "Skipping duplicate content from " + packageName + ": " + title);
                    return;
                }
            }
            // Store this content with timestamp
            lastNotificationContent.put(contentKey, String.valueOf(now));
        }

        String type = getNotificationType(packageName, title, text);
        String appName = getAppName(packageName);
        boolean isMissedCall = isMissedCallNotification(packageName, title, text);
        String appIcon = getAppIconBase64(packageName);

        // Skip SMS notifications already captured by SmsReceiver/BackgroundSmsService
        // or by SentSmsObserver (outgoing SMS). This prevents duplicate Firestore documents.
        if (type.equals("sms")) {
            // Check 0: empty body. Google Messages frequently posts the SMS notification
            // BEFORE EXTRA_TEXT is populated — title is set, body is "" — then updates the
            // same notification a few seconds later with the real text. If we write the empty
            // doc now, the extension shows the header instantly but the body only appears 5–8s
            // later (when SmsReceiver/BackgroundSmsService writes the full PDU body and merges
            // into the same docId). Skipping the empty-body write lets BackgroundSmsService be
            // the single writer with the full body from the start.
            String trimmedText = text != null ? text.trim() : "";
            String trimmedBig = bigText != null ? bigText.trim() : "";
            if (trimmedText.isEmpty() && trimmedBig.isEmpty()) {
                Log.i(TAG, "📱 SMS skip: empty body (Google Messages not ready yet) — BackgroundSmsService will write");
                lastNotificationTime.put(key, now);
                return;
            }

            boolean alreadyCaptured = false;
            
            // Check 1: sender-based dedup for incoming SMS (if phone number available)
            if (extractedPhoneNumber != null) {
                if (SmsReceiver.wasRecentlyCaptured(extractedPhoneNumber, postTime)) {
                    alreadyCaptured = true;
                    Log.i(TAG, "📱 SMS dedup: matched by sender " + extractedPhoneNumber);
                }
            }
            
            // Check 2: outgoing SMS dedup (sent from phone or extension)
            // SentSmsObserver and SmsRequestService both call markSentByExtension()
            if (!alreadyCaptured && extractedPhoneNumber != null) {
                if (SmsReceiver.wasSentByExtension(extractedPhoneNumber)) {
                    alreadyCaptured = true;
                    Log.i(TAG, "📱 SMS dedup: outgoing SMS to " + extractedPhoneNumber);
                }
            }
            
            // Check 3: body-based dedup (works even without phone number)
            // Catches cases where Google Messages shows contact name instead of number,
            // or when there's a race between SentSmsObserver and NotificationService
            if (!alreadyCaptured) {
                if (SmsReceiver.wasBodyRecentlyCaptured(text)) {
                    alreadyCaptured = true;
                    Log.i(TAG, "📱 SMS dedup: matched by body content hash");
                }
            }
            
            if (alreadyCaptured) {
                Log.i(TAG, "📱 SMS already captured, skipping to avoid duplicate");
                lastNotificationTime.put(key, now);
                lastSmsContent.put(key, text);
                return;
            }
        }

        // Skip call/missed_call notifications - CallReceiver handles calls directly
        // via the call log with accurate type, duration, and timestamp.
        // NotificationService creates duplicates with wrong data.
        if (type.equals("call") || type.equals("missed_call")) {
            Log.i(TAG, "📞 Skipping call notification (CallReceiver handles calls): " + title + " - " + text);
            lastNotificationTime.put(key, now);
            return;
        }

        // Update tracking
        lastNotificationTime.put(key, now);
        processedKeys.add(key);
        
        // Track SMS content for duplicate detection
        if (isSmsPackage(packageName)) {
            lastSmsContent.put(key, text);
        }
        // Track email content for same-key update detection
        if (isEmailPkg) {
            lastEmailContent.put(key, title + "|" + text + "|" + bigText + "|" + subText);
        }

        Log.i(TAG, ">>> NEW NOTIFICATION <<<");
        Log.i(TAG, "  Package: " + packageName);
        Log.i(TAG, "  App: " + appName);
        Log.i(TAG, "  Type: " + type);
        Log.i(TAG, "  Title: " + title);
        Log.i(TAG, "  Text: " + text);
        Log.i(TAG, "  Is Missed Call: " + isMissedCall);
        Log.i(TAG, "  Has App Icon: " + (appIcon != null));
        Log.i(TAG, "  Post Time: " + postTime + " (age: " + (now - postTime) + "ms)");
        Log.i(TAG, "  Extracted Phone Number: " + extractedPhoneNumber);

        if (packageName.equals("com.whatsapp") || packageName.equals("com.whatsapp.w4b")) {
            Log.i(TAG, "🟢 WHATSAPP NOTIFICATION ACCEPTED AND WILL BE SAVED!");
        }

        // Skip media playback/status notifications (Spotify, YouTube Music, etc.)
        // These notifications update very frequently while music is playing and are
        // not meaningful events for notification sync.
        if (isMediaPlaybackNotification(notification, packageName, title, text)) {
            Log.d(TAG, "Skipping media playback notification: " + packageName + " - " + key);
            return;
        }

        // Always send to Firebase (works even when app is closed)
        sendToFirebase(sbn.getId(), key, packageName, title, text, bigText, subText,
                type, postTime, appName, isMissedCall, appIcon, extractedPhoneNumber);

        // Try to send to React Native (only works when app is open)
        WritableMap params = Arguments.createMap();
        params.putString("id", String.valueOf(sbn.getId()));
        params.putString("key", key);
        params.putString("packageName", packageName);
        params.putString("title", title);
        params.putString("text", text);
        params.putString("bigText", bigText);
        params.putString("subText", subText);
        params.putString("type", type);
        params.putDouble("timestamp", postTime);
        params.putString("appName", appName);
        params.putBoolean("isMissedCall", isMissedCall);
        params.putBoolean("isNew", true);
        if (appIcon != null) {
            params.putString("appIcon", appIcon);
        }
        // إضافة رقم الهاتف للمكالمات
        if (extractedPhoneNumber != null) {
            params.putString("phoneNumber", extractedPhoneNumber);
        }

        sendEventToReact("onNotificationReceived", params);
    }

    /**
     * Send notification directly to Firebase Firestore
     */
    private void sendToFirebase(int id, String key, String packageName, String title,
            String text, String bigText, String subText, String type,
            long timestamp, String appName, boolean isMissedCall, String appIcon,
            String extractedPhoneNumber) {
        try {
            if (firebaseHelper != null && firebaseHelper.isLoggedIn()) {
                String phoneNumber = null;
                String contactName = null;
                
                if (type.equals("sms")) {
                    // للـ SMS: استخراج رقم الهاتف واسم جهة الاتصال
                    if (extractedPhoneNumber != null && !extractedPhoneNumber.isEmpty() && isPhoneNumber(extractedPhoneNumber)) {
                        phoneNumber = extractedPhoneNumber;
                        contactName = title;
                    } else {
                        // محاولة استخراج من key أو title أو جهات الاتصال
                        phoneNumber = extractPhoneNumber(title, key);
                        if (phoneNumber != null && !phoneNumber.equals(title)) {
                            contactName = title;
                        } else if (phoneNumber != null && phoneNumber.equals(title) && isPhoneNumber(title)) {
                            // title هو الرقم نفسه، لا يوجد اسم
                            contactName = null;
                        }
                    }
                    
                    // إذا لم نجد رقم هاتف صالح، نحاول استخدام title كـ fallback
                    // على بعض الأجهزة (Samsung, Xiaomi) الإشعار لا يحتوي على رقم هاتف في key أو extras
                    if (phoneNumber == null || !isPhoneNumber(phoneNumber)) {
                        if (title != null && !title.isEmpty()) {
                            // title قد يكون اسم جهة اتصال أو رقم هاتف
                            String phoneFromTitle = extractPhoneFromText(title);
                            if (phoneFromTitle != null) {
                                phoneNumber = phoneFromTitle;
                                Log.i(TAG, "SMS: Extracted phone from title text: " + phoneNumber);
                            } else if (isPhoneNumber(title.replaceAll("[\\s\\-\\(\\)]", ""))) {
                                phoneNumber = title.replaceAll("[\\s\\-\\(\\)]", "");
                                Log.i(TAG, "SMS: Using cleaned title as phone: " + phoneNumber);
                            } else {
                                // title هو اسم جهة اتصال - نستخدمه كمعرف
                                contactName = title;
                                // نبحث عن رقمه في جهات الاتصال
                                String phoneFromContacts = getPhoneNumberFromContactName(title);
                                if (phoneFromContacts != null) {
                                    phoneNumber = phoneFromContacts;
                                    Log.i(TAG, "SMS: Found phone from contacts for '" + title + "': " + phoneNumber);
                                } else {
                                    // لم نجد رقم - نستخدم title كمعرف (أفضل من تجاهل الرسالة)
                                    phoneNumber = title;
                                    Log.w(TAG, "SMS: No phone number found, using title as identifier: " + title);
                                }
                            }
                        } else {
                            // لا يوجد title ولا رقم - نتجاهل
                            Log.w(TAG, "SMS without any identifier, skipping");
                            return;
                        }
                    }
                    
                    Log.i(TAG, "SMS phoneNumber: " + phoneNumber + ", contactName: " + contactName);
                } else if (type.equals("call") || type.equals("missed_call")) {
                    // للمكالمات: Samsung وبعض الأجهزة ترسل title = "Call" أو "Missed call"
                    // والرقم أو اسم جهة الاتصال يكون في text
                    // لذلك نتحقق من title قبل استخدامه كاسم جهة اتصال
                    
                    // كلمات وصف المكالمات (ليست أسماء جهات اتصال)
                    String titleLower = title != null ? title.toLowerCase().trim() : "";
                    boolean titleIsCallDescription = 
                        titleLower.equals("call") ||
                        titleLower.equals("calling") ||
                        titleLower.equals("incoming call") ||
                        titleLower.equals("outgoing call") ||
                        titleLower.equals("missed call") ||
                        titleLower.equals("missed calls") ||
                        titleLower.equals("ongoing call") ||
                        titleLower.equals("on hold") ||
                        titleLower.equals("dialing") ||
                        titleLower.equals("ringing") ||
                        titleLower.contains("missed call") ||
                        titleLower.contains("calls") ||
                        titleLower.equals("مكالمة") ||
                        titleLower.equals("مكالمة فائتة") ||
                        titleLower.equals("مكالمات فائتة") ||
                        titleLower.equals("مكالمة واردة") ||
                        titleLower.equals("مكالمة صادرة") ||
                        titleLower.equals("اتصال") ||
                        titleLower.matches("^\\d{1,4}$"); // أرقام قصيرة جداً مثل "155"
                    
                    // 1) استخدام الرقم المستخرج سابقاً
                    if (extractedPhoneNumber != null && !extractedPhoneNumber.isEmpty()) {
                        phoneNumber = extractedPhoneNumber;
                    }
                    
                    // 2) محاولة استخراج رقم الهاتف من text
                    if (phoneNumber == null && text != null && !text.isEmpty()) {
                        if (isPhoneNumber(text)) {
                            phoneNumber = text;
                        } else {
                            String phoneInText = extractPhoneFromText(text);
                            if (phoneInText != null) {
                                phoneNumber = phoneInText;
                            }
                        }
                    }
                    
                    // 3) إذا title هو رقم هاتف صالح (7+ أرقام)
                    if (phoneNumber == null && title != null && !title.isEmpty() && isPhoneNumber(title)) {
                        phoneNumber = title;
                    }
                    
                    // 4) تحديد اسم جهة الاتصال
                    if (titleIsCallDescription) {
                        // title هو وصف مكالمة، نبحث عن الاسم في text
                        if (text != null && !text.isEmpty() && !isPhoneNumber(text)) {
                            // text يحتوي اسم جهة اتصال
                            contactName = text;
                            // ونبحث عن رقمه
                            if (phoneNumber == null) {
                                String phoneFromContacts = getPhoneNumberFromContactName(text);
                                if (phoneFromContacts != null) {
                                    phoneNumber = phoneFromContacts;
                                }
                            }
                        } else if (phoneNumber != null) {
                            // عندنا رقم بس ما عندنا اسم، نبحث في جهات الاتصال
                            String nameFromContacts = getContactNameFromNumber(phoneNumber);
                            if (nameFromContacts != null) {
                                contactName = nameFromContacts;
                            }
                        }
                    } else if (!isPhoneNumber(title)) {
                        // title ليس وصف مكالمة وليس رقم = اسم جهة اتصال حقيقي
                        contactName = title;
                        // إذا ما لقينا رقم، نبحث بالاسم
                        if (phoneNumber == null) {
                            String phoneFromContacts = getPhoneNumberFromContactName(title);
                            if (phoneFromContacts != null) {
                                phoneNumber = phoneFromContacts;
                            }
                        }
                    }
                    
                    Log.i(TAG, "📞 CALL phoneNumber: " + phoneNumber + ", contactName: " + contactName + " (titleIsDesc: " + titleIsCallDescription + ")");
                }
                
                firebaseHelper.sendNotificationToFirestore(
                    String.valueOf(id), key, packageName, title, text,
                    bigText, subText, type, timestamp, appName, isMissedCall, appIcon,
                    phoneNumber, contactName
                );
                Log.i(TAG, "Notification queued for Firebase");

                // For ACTIVE incoming call notifications (not missed calls), update the
                // ringing_call/current doc with the real phone number + contact name.
                // This is necessary because CallReceiver on Android 10+ receives null
                // EXTRA_INCOMING_NUMBER, so it writes the doc with empty fields.
                // Guard rails to prevent stale/wrong notifications from overwriting:
                //   1) Must be from a known dialer/phone package (not SMS/WhatsApp/etc.)
                //   2) Notification must be fresh (posted within last 5 seconds) so an
                //      old re-processed notification can't hijack a new call's popup.
                if (type.equals("call") && !isMissedCall) {
                    boolean isDialerPkg = false;
                    for (String p : PHONE_PACKAGES) {
                        if (p.equals(packageName)) { isDialerPkg = true; break; }
                    }
                    long ageMs = System.currentTimeMillis() - timestamp;
                    if (!isDialerPkg) {
                        Log.i(TAG, "📞 Skipping ringing_call update — package not a dialer: " + packageName);
                    } else if (ageMs > 5000) {
                        Log.i(TAG, "📞 Skipping ringing_call update — stale notification (age=" + ageMs + "ms)");
                    } else {
                        try {
                            String finalPhone = (phoneNumber != null && !phoneNumber.isEmpty()) ? phoneNumber : "";
                            String finalContact = (contactName != null && !contactName.isEmpty()) ? contactName : "";
                            if (!finalPhone.isEmpty() || !finalContact.isEmpty()) {
                                firebaseHelper.writeRingingCall(finalPhone, finalContact, -1);
                                Log.i(TAG, "📞 Updated ringing_call from system phone notification — phone=" + finalPhone + ", contact=" + finalContact);
                            }
                        } catch (Exception ringEx) {
                            Log.e(TAG, "Error updating ringing_call from notification", ringEx);
                        }
                    }
                }
            } else {
                Log.d(TAG, "User not logged in, skipping Firebase");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error sending to Firebase: " + e.getMessage());
        }
    }

    /**
     * Extract phone number from SMS notification
     * The key often contains the phone number, e.g., "0|com.google.android.apps.messaging|0|+1234567890|..."
     */
    private String extractPhoneNumber(String title, String key) {
        // أولاً: جرب استخراج من key الإشعار
        if (key != null && !key.isEmpty()) {
            String[] parts = key.split("\\|");
            for (String part : parts) {
                String trimmed = part.trim();
                // ابحث عن جزء يبدو كرقم هاتف (يبدأ بـ + أو أرقام فقط)
                if (trimmed.matches("^\\+?[0-9]{7,15}$")) {
                    return trimmed;
                }
            }
        }
        
        // ثانياً: إذا كان title يبدو كرقم هاتف
        if (title != null && !title.isEmpty()) {
            // إزالة المسافات والشرطات
            String cleanTitle = title.replaceAll("[\\s\\-]", "");
            if (cleanTitle.matches("^\\+?[0-9]{7,15}$")) {
                return title;
            }
        }
        
        // ثالثاً: البحث في جهات الاتصال باستخدام الاسم
        if (title != null && !title.isEmpty()) {
            String phoneFromContacts = getPhoneNumberFromContactName(title);
            if (phoneFromContacts != null) {
                Log.i(TAG, "Found phone number from contacts for '" + title + "': " + phoneFromContacts);
                return phoneFromContacts;
            }
        }
        
        // إذا لم نجد رقم، أرجع null (لا نستخدم الاسم كرقم)
        return null;
    }

    /**
     * Search for phone number in contacts by contact name
     */
    private String getPhoneNumberFromContactName(String contactName) {
        if (contactName == null || contactName.isEmpty()) {
            Log.d(TAG, "📒 getPhoneNumberFromContactName: contactName is null or empty");
            return null;
        }
        
        Log.d(TAG, "📒 Searching for contact: '" + contactName + "'");
        
        try {
            ContentResolver contentResolver = getContentResolver();
            
            // البحث عن جهة الاتصال بالاسم
            Uri uri = ContactsContract.CommonDataKinds.Phone.CONTENT_URI;
            String[] projection = new String[] {
                ContactsContract.CommonDataKinds.Phone.NUMBER,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME
            };
            
            // أولاً: البحث بالمطابقة التامة
            String selection = ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " = ?";
            String[] selectionArgs = new String[] { contactName };
            
            Cursor cursor = contentResolver.query(uri, projection, selection, selectionArgs, null);
            
            if (cursor != null) {
                try {
                    Log.d(TAG, "📒 Exact match query returned " + cursor.getCount() + " results");
                    if (cursor.moveToFirst()) {
                        int numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                        int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                        if (numberIndex >= 0) {
                            String phoneNumber = cursor.getString(numberIndex);
                            String foundName = nameIndex >= 0 ? cursor.getString(nameIndex) : "";
                            Log.d(TAG, "📒 Found contact - Name: " + foundName + ", Number: " + phoneNumber);
                            if (phoneNumber != null && !phoneNumber.isEmpty()) {
                                phoneNumber = phoneNumber.replaceAll("[\\s\\-\\(\\)]", "");
                                Log.d(TAG, "📒 ✅ Returning phone number: " + phoneNumber);
                                return phoneNumber;
                            }
                        }
                    }
                } finally {
                    cursor.close();
                }
            }
            
            // ثانياً: البحث بمطابقة جزئية (LIKE)
            selection = ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?";
            selectionArgs = new String[] { "%" + contactName + "%" };
            
            cursor = contentResolver.query(uri, projection, selection, selectionArgs, null);
            
            if (cursor != null) {
                try {
                    Log.d(TAG, "📒 Partial match query returned " + cursor.getCount() + " results");
                    if (cursor.moveToFirst()) {
                        int numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                        int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                        if (numberIndex >= 0) {
                            String phoneNumber = cursor.getString(numberIndex);
                            String foundName = nameIndex >= 0 ? cursor.getString(nameIndex) : "";
                            Log.d(TAG, "📒 Found contact (partial) - Name: " + foundName + ", Number: " + phoneNumber);
                            if (phoneNumber != null && !phoneNumber.isEmpty()) {
                                phoneNumber = phoneNumber.replaceAll("[\\s\\-\\(\\)]", "");
                                Log.d(TAG, "📒 ✅ Returning phone number: " + phoneNumber);
                                return phoneNumber;
                            }
                        }
                    }
                } finally {
                    cursor.close();
                }
            }
            
            // ثالثاً: البحث بدون حساسية لحالة الأحرف (COLLATE NOCASE)
            selection = ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ? COLLATE NOCASE";
            selectionArgs = new String[] { contactName };
            
            cursor = contentResolver.query(uri, projection, selection, selectionArgs, null);
            
            if (cursor != null) {
                try {
                    Log.d(TAG, "📒 Case-insensitive query returned " + cursor.getCount() + " results");
                    if (cursor.moveToFirst()) {
                        int numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                        int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                        if (numberIndex >= 0) {
                            String phoneNumber = cursor.getString(numberIndex);
                            String foundName = nameIndex >= 0 ? cursor.getString(nameIndex) : "";
                            Log.d(TAG, "📒 Found contact (case-insensitive) - Name: " + foundName + ", Number: " + phoneNumber);
                            if (phoneNumber != null && !phoneNumber.isEmpty()) {
                                phoneNumber = phoneNumber.replaceAll("[\\s\\-\\(\\)]", "");
                                Log.d(TAG, "📒 ✅ Returning phone number: " + phoneNumber);
                                return phoneNumber;
                            }
                        }
                    }
                } finally {
                    cursor.close();
                }
            }
            
            // رابعاً: عرض كل جهات الاتصال للتشخيص (أول 20 فقط)
            Log.d(TAG, "📒 ❌ Contact not found! Listing first 20 contacts for debugging...");
            cursor = contentResolver.query(uri, projection, null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC LIMIT 20");
            if (cursor != null) {
                try {
                    while (cursor.moveToNext()) {
                        int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                        int numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                        if (nameIndex >= 0 && numberIndex >= 0) {
                            String name = cursor.getString(nameIndex);
                            String number = cursor.getString(numberIndex);
                            Log.d(TAG, "📒 Available contact: '" + name + "' -> " + number);
                        }
                    }
                } finally {
                    cursor.close();
                }
            }
            
        } catch (SecurityException e) {
            Log.e(TAG, "📒 ❌ Permission denied for contacts: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "📒 ❌ Error searching contacts: " + e.getMessage());
            e.printStackTrace();
        }
        
        Log.d(TAG, "📒 ❌ No phone number found for contact: '" + contactName + "'");
        return null;
    }

    /**
     * Search for contact name by phone number (reverse lookup)
     */
    private String getContactNameFromNumber(String phoneNumber) {
        if (phoneNumber == null || phoneNumber.isEmpty()) return null;
        
        try {
            Uri uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phoneNumber)
            );
            
            String[] projection = new String[] {
                ContactsContract.PhoneLookup.DISPLAY_NAME
            };
            
            Cursor cursor = getContentResolver().query(uri, projection, null, null, null);
            if (cursor != null) {
                try {
                    if (cursor.moveToFirst()) {
                        int nameIndex = cursor.getColumnIndex(ContactsContract.PhoneLookup.DISPLAY_NAME);
                        if (nameIndex >= 0) {
                            String name = cursor.getString(nameIndex);
                            if (name != null && !name.isEmpty()) {
                                Log.d(TAG, "📒 Found contact name for " + phoneNumber + ": " + name);
                                return name;
                            }
                        }
                    }
                } finally {
                    cursor.close();
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "📒 Error looking up contact name: " + e.getMessage());
        }
        
        return null;
    }

    /**
     * Check if a string looks like a phone number
     */
    private boolean isPhoneNumber(String text) {
        if (text == null || text.isEmpty()) return false;
        String clean = text.replaceAll("[\\s\\-\\(\\)]", "");
        return clean.matches("^\\+?[0-9]{7,15}$");
    }

    /**
     * v1.1.2.22: Extract a phone number from {@link Notification.CallStyle} and the
     * generic {@code android.people}/{@code android.people.list} extras. These carry
     * canonical {@code tel:} URIs (or {@link android.app.Person} objects whose URI is
     * {@code tel:…}), which is the most reliable source for unregistered numbers.
     */
    private String extractPhoneFromCallExtras(Bundle extras) {
        if (extras == null) return null;
        try {
            // CallStyle (API 31+): EXTRA_CALL_PERSON
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    Object callPerson = extras.getParcelable("android.callPerson");
                    String p = phoneFromPerson(callPerson);
                    if (p != null) return p;
                } catch (Exception ignore) {}
            }
            // EXTRA_PEOPLE (legacy string array of URIs)
            try {
                String[] people = extras.getStringArray(Notification.EXTRA_PEOPLE);
                if (people != null) {
                    for (String uri : people) {
                        String p = phoneFromUri(uri);
                        if (p != null) return p;
                    }
                }
            } catch (Exception ignore) {}
            // EXTRA_PEOPLE_LIST (API 28+, parcelable list of Person)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                try {
                    java.util.ArrayList<android.os.Parcelable> list =
                            extras.getParcelableArrayList(Notification.EXTRA_PEOPLE_LIST);
                    if (list != null) {
                        for (android.os.Parcelable pcl : list) {
                            String p = phoneFromPerson(pcl);
                            if (p != null) return p;
                        }
                    }
                } catch (Exception ignore) {}
            }
        } catch (Exception e) {
            Log.w(TAG, "extractPhoneFromCallExtras failed: " + e.getMessage());
        }
        return null;
    }

    /** Returns a digit-only number from an {@link android.app.Person}'s URI if it is {@code tel:…}. */
    private String phoneFromPerson(Object personObj) {
        if (personObj == null) return null;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null;
        try {
            if (personObj instanceof android.app.Person) {
                android.app.Person p = (android.app.Person) personObj;
                return phoneFromUri(p.getUri());
            }
        } catch (Exception ignore) {}
        return null;
    }

    /** Returns digits from a {@code tel:+971501234567} or {@code tel:155} URI, or
     *  resolves a {@code content://com.android.contacts/…} lookup URI (saved contacts)
     *  to the contact's phone number. Returns null otherwise.
     *  Uses the loose extractor so short codes (3+ digits) are preserved — tel: URIs
     *  and contact lookups are authoritative so there's no false-positive risk here. */
    private String phoneFromUri(String uri) {
        if (uri == null || uri.isEmpty()) return null;
        String lower = uri.toLowerCase();
        if (lower.startsWith("tel:")) {
            String raw = uri.substring(4);
            try { raw = java.net.URLDecoder.decode(raw, "UTF-8"); } catch (Exception ignore) {}
            return extractDialedNumberFromText(raw);
        }
        // Saved contacts: the dialer's Person URI points at the contacts provider
        // (e.g. content://com.android.contacts/contacts/lookup/0r1-…/1) instead of a
        // tel: URI. Resolve it to the contact's number — this is the dialer's own
        // authoritative pointer to the exact contact, NOT a fuzzy T9 name match.
        if (lower.startsWith("content:")) {
            return phoneFromContactUri(uri);
        }
        return null;
    }

    /** Resolves a contacts-provider URI to the contact's primary phone number. */
    private String phoneFromContactUri(String uriStr) {
        if (uriStr == null || uriStr.isEmpty()) return null;
        try {
            Uri uri = Uri.parse(uriStr);
            ContentResolver cr = getContentResolver();
            long contactId = -1;
            try (Cursor c = cr.query(uri, new String[]{ ContactsContract.Contacts._ID }, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int idx = c.getColumnIndex(ContactsContract.Contacts._ID);
                    if (idx >= 0) contactId = c.getLong(idx);
                }
            } catch (Exception ignore) {}
            if (contactId < 0) return null;
            try (Cursor pc = cr.query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    new String[]{ ContactsContract.CommonDataKinds.Phone.NUMBER },
                    ContactsContract.CommonDataKinds.Phone.CONTACT_ID + " = ?",
                    new String[]{ String.valueOf(contactId) }, null)) {
                if (pc != null && pc.moveToFirst()) {
                    String num = pc.getString(0);
                    if (num != null && !num.isEmpty()) {
                        num = num.replaceAll("[\\s\\-\\(\\)]", "");
                        Log.d(TAG, "📞 Resolved phone from contact URI: " + num);
                        return num;
                    }
                }
            } catch (Exception ignore) {}
        } catch (Exception e) {
            Log.w(TAG, "phoneFromContactUri failed: " + e.getMessage());
        }
        return null;
    }

    /** Diagnostic: log the Person URIs carried by a call-style notification's extras. */
    private void dumpCallPersonUris(Bundle extras) {
        if (extras == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Object callPerson = extras.getParcelable("android.callPerson");
                if (callPerson instanceof android.app.Person) {
                    android.app.Person p = (android.app.Person) callPerson;
                    Log.d(TAG, "📞 callPerson name=" + p.getName() + ", uri=" + p.getUri());
                }
            }
            String[] people = extras.getStringArray(Notification.EXTRA_PEOPLE);
            if (people != null) {
                for (String u : people) Log.d(TAG, "📞 EXTRA_PEOPLE uri=" + u);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                java.util.ArrayList<android.os.Parcelable> list =
                        extras.getParcelableArrayList(Notification.EXTRA_PEOPLE_LIST);
                if (list != null) {
                    for (android.os.Parcelable pcl : list) {
                        if (pcl instanceof android.app.Person) {
                            android.app.Person p = (android.app.Person) pcl;
                            Log.d(TAG, "📞 EXTRA_PEOPLE_LIST name=" + p.getName() + ", uri=" + p.getUri());
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "dumpCallPersonUris failed: " + e.getMessage());
        }
    }

    /**
     * v1.1.2.22b: Looser extractor that accepts 3–15 digits (with optional leading +).
     * Use ONLY for authoritative sources (tel: URIs, dialer notification title for
     * outgoing-call style notifications) — NEVER for the sweep, since it would
     * match too many random digit runs.
     */
    private String extractDialedNumberFromText(String text) {
        if (text == null || text.isEmpty()) return null;
        StringBuilder sb = new StringBuilder();
        boolean firstPlus = true;
        for (char c : text.toCharArray()) {
            if (Character.isDigit(c)) {
                sb.append(c);
            } else if (c == '+' && firstPlus && sb.length() == 0) {
                sb.append(c);
                firstPlus = false;
            }
        }
        String extracted = sb.toString();
        int digits = extracted.startsWith("+") ? extracted.length() - 1 : extracted.length();
        if (digits >= 3 && digits <= 15) {
            Log.d(TAG, "extractDialedNumberFromText: '" + text + "' -> '" + extracted + "'");
            return extracted;
        }
        return null;
    }

    /**
     * v1.1.2.22: Last-resort sweep — scan every CharSequence extra for a phone-shaped
     * substring. Returns the first 7–15-digit run (optionally with leading '+') found.
     */
    private String sweepExtrasForPhone(Bundle extras) {
        if (extras == null) return null;
        try {
            for (String k : extras.keySet()) {
                try {
                    Object v = extras.get(k);
                    if (v instanceof CharSequence) {
                        String s = v.toString();
                        if (s == null || s.isEmpty()) continue;
                        String p = extractPhoneFromText(s);
                        if (p != null) {
                            Log.d(TAG, "📞 sweepExtrasForPhone matched key=" + k + " value='" + s + "' -> " + p);
                            return p;
                        }
                    }
                } catch (Exception ignore) {}
            }
        } catch (Exception e) {
            Log.w(TAG, "sweepExtrasForPhone failed: " + e.getMessage());
        }
        return null;
    }
    
    /**
     * Extract phone number from text that may contain other characters
     * e.g., "📒010 23395696📒" -> "01023395696"
     */
    private String extractPhoneFromText(String text) {
        if (text == null || text.isEmpty()) return null;
        
        // إزالة كل الأحرف غير الأرقام باستثناء + في البداية
        StringBuilder sb = new StringBuilder();
        boolean firstPlus = true;
        
        for (char c : text.toCharArray()) {
            if (Character.isDigit(c)) {
                sb.append(c);
            } else if (c == '+' && firstPlus && sb.length() == 0) {
                sb.append(c);
                firstPlus = false;
            }
        }
        
        String extracted = sb.toString();
        
        // تحقق من أن الرقم المستخرج صالح
        if (extracted.length() >= 7 && extracted.length() <= 15) {
            Log.d(TAG, "extractPhoneFromText: '" + text + "' -> '" + extracted + "'");
            return extracted;
        }
        
        return null;
    }

    /**
     * Check if text is a summary or system notification (not a real message)
     */
    private boolean isSummaryText(String text) {
        if (text == null || text.isEmpty()) return false;

        String lower = text.toLowerCase();

        // System/background notifications - NOT real messages
        if (lower.contains("doing work in the background") ||
            lower.contains("working in background") ||
            lower.contains("running in background") ||
            lower.contains("is running") ||
            lower.contains("تعمل في الخلفية") ||
            lower.contains("يعمل في الخلفية")) {
            return true;
        }

        // Common summary patterns
        return lower.matches(".*\\d+\\s*(messages?|msgs?)\\s*(from|in)\\s*\\d+.*") ||
               lower.contains("new messages") ||
               lower.contains("messages from") ||
               lower.contains("unread messages") ||
               lower.matches(".*\\d+\\s*رسائل.*") ||
               lower.matches(".*\\d+\\s*رسالة.*");
    }

    /**
     * Detect media playback notifications (music/video transport controls) that
     * can fire repeatedly while playback state changes.
     */
    private boolean isMediaPlaybackNotification(Notification notification, String packageName, String title, String text) {
        if (notification == null) return false;

        // Android transport category is the strongest signal for media playback.
        if (Notification.CATEGORY_TRANSPORT.equals(notification.category)) {
            return true;
        }

        Bundle extras = notification.extras;
        if (extras != null) {
            // Media notifications typically include a media session token reference.
            if (extras.containsKey("android.mediaSession") || extras.containsKey("android.mediaRemoteDevice")) {
                return true;
            }
        }

        // Fallback for OEM variants where category is not set consistently.
        String combined = ((title != null ? title : "") + " " + (text != null ? text : "")).toLowerCase();
        boolean hasPlaybackKeyword =
                combined.contains("now playing") ||
                combined.contains("playing") ||
                combined.contains("paused") ||
                combined.contains("next track") ||
                combined.contains("previous track") ||
                combined.contains("قيد التشغيل") ||
                combined.contains("يتم التشغيل") ||
                combined.contains("إيقاف مؤقت");

        return isKnownMediaAppPackage(packageName) && hasPlaybackKeyword;
    }

    private boolean isKnownMediaAppPackage(String packageName) {
        if (packageName == null) return false;

        return packageName.equals("com.spotify.music") ||
               packageName.equals("com.google.android.apps.youtube.music") ||
               packageName.equals("com.google.android.youtube") ||
               packageName.equals("deezer.android.app") ||
               packageName.equals("com.apple.android.music") ||
               packageName.equals("com.soundcloud.android") ||
               packageName.equals("com.gaana") ||
               packageName.equals("com.jio.media.jiobeats") ||
               packageName.equals("com.saavn.android") ||
               packageName.equals("com.amazon.mp3") ||
               packageName.equals("com.shazam.android") ||
               packageName.contains("music") ||
               packageName.contains("player");
    }

    /**
     * Check if this app tends to repeatedly send the same notification
     * (like Gmail showing unread count, or Google notifications)
     * NOTE: SMS and Phone apps are EXCLUDED - they should never be filtered
     */
    private boolean isRepetitiveNotificationApp(String packageName) {
        if (packageName == null) return false;
        
        // NEVER filter SMS or Phone apps - they are critical
        if (isSmsPackage(packageName) || isPhonePackage(packageName)) {
            return false;
        }
        
        // NOTE: Gmail and other email apps are intentionally NOT listed here.
        // Each new email is a distinct event and must not be deduplicated by content.
        // Only filter pure status/persistent apps that repeat the same notification
        // constantly without user-triggered events.
        return false;
    }

    /**
     * Check if this package is an email/mail app.
     * Email apps use FLAG_GROUP_SUMMARY and "N new messages" text even for
     * single new emails when the inbox already has unread messages, so we
     * must NOT apply those filters for them.
     */
    private boolean isEmailPackage(String packageName) {
        if (packageName == null) return false;
        // Explicit known email package names first (avoids false positives from string matching)
        if (packageName.equals("com.google.android.gm") ||           // Gmail
            packageName.equals("com.microsoft.office.outlook") ||    // Outlook
            packageName.equals("com.yahoo.mobile.client.android.mail") || // Yahoo Mail
            packageName.equals("com.samsung.android.email.provider") || // Samsung Email
            packageName.equals("me.proton.android.mail") ||          // Proton Mail
            packageName.equals("com.fastmail.app") ||                // Fastmail
            packageName.equals("com.basecamp.trix") ||               // HEY Email
            packageName.equals("com.twofortyfouram.locale")) {        // Spark
            return true;
        }
        // Fallback: package name string hints
        return packageName.contains("mail") ||
               packageName.contains("email") ||
               packageName.contains("outlook") ||
               packageName.contains("yahoo") ||
               packageName.contains("proton");
    }

    /**
     * Check if this is a Google system/persistent package whose notifications
     * repeat constantly and are not meaningful to sync to the extension.
     * (e.g., "At a glance" weather, Play Services, system UI, etc.)
     */
    private boolean isGoogleSystemPackage(String packageName) {
        if (packageName == null) return false;
        
        return packageName.equals("com.google.android.googlequicksearchbox") || // Google app (At a Glance, Discover)
               packageName.equals("com.google.android.gms") ||                  // Google Play Services
               packageName.equals("com.google.android.gsf") ||                  // Google Services Framework
               packageName.equals("com.android.vending") ||                     // Google Play Store
               packageName.equals("com.google.android.apps.wellbeing") ||       // Digital Wellbeing
               packageName.equals("com.google.android.apps.nexuslauncher") ||   // Pixel Launcher
               packageName.equals("com.google.android.projection.gearhead") ||  // Android Auto
               packageName.equals("com.google.android.apps.gcs") ||             // Google Connectivity Services
               packageName.equals("com.google.android.ext.services") ||         // Android System Intelligence
               packageName.equals("com.android.systemui") ||                    // System UI
               packageName.equals("com.android.providers.downloads") ||         // Download Manager
               packageName.equals("android");                                   // Android System
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        if (sbn == null) return;

        String key = sbn.getKey();

        // Clean up tracking
        processedKeys.remove(key);
        lastNotificationTime.remove(key);
        lastEmailContent.remove(key);

        Log.d(TAG, "Notification removed: " + key);

        WritableMap params = Arguments.createMap();
        params.putString("key", key);
        params.putString("packageName", sbn.getPackageName());

        sendEventToReact("onNotificationRemoved", params);
    }

    private boolean isSmsPackage(String packageName) {
        if (packageName == null) return false;

        for (String pkg : SMS_PACKAGES) {
            if (packageName.equals(pkg)) return true;
        }

        return packageName.contains("messaging") ||
               packageName.contains("mms") ||
               packageName.contains("sms");
    }

    private boolean isPhonePackage(String packageName) {
        if (packageName == null) return false;

        for (String pkg : PHONE_PACKAGES) {
            if (packageName.equals(pkg)) return true;
        }

        return packageName.contains("dialer") ||
               packageName.contains("phone") ||
               packageName.contains("incallui");
    }

    private boolean isMissedCallNotification(String packageName, String title, String text) {
        String combined = (title + " " + text).toLowerCase();

        // Check for WhatsApp missed calls
        if (packageName.equals("com.whatsapp") || packageName.equals("com.whatsapp.w4b")) {
            if (combined.contains("missed") && (combined.contains("call") || combined.contains("voice"))) {
                return true;
            }
            // Arabic patterns for WhatsApp
            if (combined.contains("فائت") || combined.contains("لم يرد")) {
                return true;
            }
        }

        // Check for phone app missed calls
        if (isPhonePackage(packageName)) {
            // English patterns
            if (combined.contains("missed call") || combined.contains("missed calls")) {
                return true;
            }

            // Arabic patterns
            if (combined.contains("مكالمة فائتة") || combined.contains("مكالمات فائتة")) {
                return true;
            }

            // Other language patterns
            if (combined.contains("appel manqué") ||  // French
                combined.contains("llamada perdida") || // Spanish
                combined.contains("verpasster anruf")) { // German
                return true;
            }
        }

        return false;
    }

    private String getNotificationType(String packageName, String title, String text) {
        if (packageName == null) return "other";

        if (isSmsPackage(packageName)) {
            return "sms";
        }

        if (isPhonePackage(packageName)) {
            if (isMissedCallNotification(packageName, title, text)) {
                return "missed_call";
            }
            return "call";
        }

        if (packageName.equals("com.whatsapp") ||
            packageName.equals("com.whatsapp.w4b")) {
            // Check if it's a WhatsApp call
            if (isMissedCallNotification(packageName, title, text)) {
                return "whatsapp_call";
            }
            return "whatsapp";
        }

        if (packageName.equals("org.telegram.messenger") ||
            packageName.contains("telegram")) {
            return "telegram";
        }

        if (packageName.equals("com.facebook.orca") ||
            packageName.equals("com.facebook.mlite")) {
            return "messenger";
        }

        if (packageName.equals("com.instagram.android")) {
            return "instagram";
        }

        if (packageName.equals("com.twitter.android") ||
            packageName.equals("com.twitter.android.lite")) {
            return "twitter";
        }

        if (packageName.contains("mail") ||
            packageName.contains("email") ||
            packageName.equals("com.google.android.gm") ||
            packageName.equals("com.microsoft.office.outlook") ||
            packageName.contains("outlook")) {
            return "email";
        }

        return "other";
    }

    private String getAppName(String packageName) {
        try {
            return getPackageManager().getApplicationLabel(
                getPackageManager().getApplicationInfo(packageName, 0)
            ).toString();
        } catch (Exception e) {
            Log.e(TAG, "Error getting app name: " + e.getMessage());
            return packageName;
        }
    }

    /**
     * Get app icon as Base64 string
     * Uses caching to avoid repeated conversions
     */
    private String getAppIconBase64(String packageName) {
        // Check cache first
        if (iconCache.containsKey(packageName)) {
            return iconCache.get(packageName);
        }

        try {
            PackageManager pm = getPackageManager();
            Drawable drawable = pm.getApplicationIcon(packageName);
            
            // Convert drawable to bitmap
            Bitmap bitmap;
            if (drawable instanceof BitmapDrawable) {
                bitmap = ((BitmapDrawable) drawable).getBitmap();
            } else {
                // Create bitmap from drawable
                int width = drawable.getIntrinsicWidth() > 0 ? drawable.getIntrinsicWidth() : 48;
                int height = drawable.getIntrinsicHeight() > 0 ? drawable.getIntrinsicHeight() : 48;
                bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bitmap);
                drawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
                drawable.draw(canvas);
            }

            // Scale down to 48x48 for smaller size
            Bitmap scaledBitmap = Bitmap.createScaledBitmap(bitmap, 48, 48, true);

            // Convert to Base64
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            scaledBitmap.compress(Bitmap.CompressFormat.PNG, 80, baos);
            byte[] imageBytes = baos.toByteArray();
            String base64 = Base64.encodeToString(imageBytes, Base64.NO_WRAP);
            
            // Add data URI prefix
            String dataUri = "data:image/png;base64," + base64;

            // Cache it
            iconCache.put(packageName, dataUri);

            Log.d(TAG, "App icon cached for: " + packageName + " (size: " + dataUri.length() + " chars)");
            return dataUri;

        } catch (Exception e) {
            Log.e(TAG, "Error getting app icon: " + e.getMessage());
            return null;
        }
    }

    private void sendEventToReact(final String eventName, final WritableMap params) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    ReactApplication app = (ReactApplication) getApplication();
                    if (app == null) {
                        Log.d(TAG, "ReactApplication is null - app might be closed");
                        return;
                    }

                    ReactHost reactHost = app.getReactHost();
                    if (reactHost == null) {
                        Log.d(TAG, "ReactHost is null - app might be closed");
                        return;
                    }

                    ReactContext context = reactHost.getCurrentReactContext();
                    if (context == null) {
                        Log.d(TAG, "ReactContext is null - app might be closed");
                        return;
                    }

                    if (!context.hasActiveReactInstance()) {
                        Log.d(TAG, "No active React instance - app might be closed");
                        return;
                    }

                    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                            .emit(eventName, params);

                    Log.i(TAG, "Event sent to React: " + eventName);

                } catch (Exception e) {
                    Log.d(TAG, "Could not send to React (app closed?): " + e.getMessage());
                }
            }
        });
    }
}

