package com.IRopit;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.ContactsContract;
import android.service.notification.NotificationListenerService;
import android.telephony.SmsManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentChange;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.ListenerRegistration;
import com.google.firebase.firestore.Query;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

public class SmsRequestService extends Service {
    private static final String TAG = "SmsRequestService";
    private static final String CHANNEL_ID = "iropit_service_channel";
    private static final String SMS_COPY_CHANNEL_ID = "sms_copy_channel";
    private static final int NOTIFICATION_ID = 1001;
    private int smsCopyNotifCounter = 0;
    private static final long WATCHDOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    private FirebaseFirestore db;
    private ListenerRegistration smsRequestListener;
    private String userId;
    private String deviceId;
    private Handler watchdogHandler;
    private Runnable watchdogRunnable;
    private SentSmsObserver sentSmsObserver;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "SmsRequestService created");
        db = FirebaseFirestore.getInstance();
        createNotificationChannel();
        createSmsCopyChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "SmsRequestService started");

        // MUST call startForeground() before anything else (Android 8+ requirement)
        // Wrap in try-catch to prevent crash loop when foreground service quota is exhausted
        try {
            startForeground(NOTIFICATION_ID, createNotification());
        } catch (Exception e) {
            Log.e(TAG, "Failed to start foreground service: " + e.getMessage());
            // If we can't start as foreground, stop gracefully to avoid crash loop
            stopSelf();
            return START_NOT_STICKY;
        }

        // Get credentials from SharedPreferences
        SharedPreferences prefs = getSharedPreferences("ZyncITPrefs", MODE_PRIVATE);
        userId = prefs.getString("userId", null);
        deviceId = prefs.getString("deviceId", null);

        if (userId == null || deviceId == null) {
            Log.e(TAG, "No credentials found, stopping service");
            stopSelf();
            return START_NOT_STICKY;
        }

        // Start listening for SMS requests
        startListening();

        // Start observing outgoing SMS from the native SMS app
        startSentSmsObserver();

        // Start watchdog to keep NotificationListenerService alive (MIUI fix)
        startNotificationServiceWatchdog();

        return START_STICKY;
    }

    /**
     * Start observing the SMS content provider for outgoing messages.
     * This captures SMS sent from the phone's native SMS app.
     */
    private void startSentSmsObserver() {
        try {
            if (sentSmsObserver != null) {
                Log.d(TAG, "SentSmsObserver already running");
                return;
            }
            Handler handler = new Handler(Looper.getMainLooper());
            sentSmsObserver = new SentSmsObserver(handler, this);
            sentSmsObserver.register();
            Log.i(TAG, "✅ SentSmsObserver started - monitoring outgoing SMS");
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to start SentSmsObserver: " + e.getMessage());
        }
    }

    /**
     * Watchdog: periodically checks if NotificationListenerService is still connected.
     * On MIUI/Xiaomi, the system often unbinds the listener silently.
     * This watchdog detects that and forces a rebind.
     */
    private void startNotificationServiceWatchdog() {
        if (watchdogHandler != null) return;
        
        watchdogHandler = new Handler(Looper.getMainLooper());
        watchdogRunnable = new Runnable() {
            @Override
            public void run() {
                boolean isConnected = NotificationService.isConnected();
                if (!isConnected) {
                    Log.w(TAG, "⚠️ WATCHDOG: NotificationService is NOT connected! Attempting rebind...");
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                            ComponentName componentName = new ComponentName(
                                getPackageName(),
                                NotificationService.class.getName()
                            );
                            NotificationListenerService.requestRebind(componentName);
                            Log.i(TAG, "✅ WATCHDOG: Rebind requested for NotificationService");
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "❌ WATCHDOG: Rebind failed: " + e.getMessage());
                    }
                } else {
                    Log.d(TAG, "✅ WATCHDOG: NotificationService is connected and healthy");
                }
                
                // Schedule next check
                watchdogHandler.postDelayed(this, WATCHDOG_INTERVAL_MS);
            }
        };
        
        // First check after 30 seconds, then every 5 minutes
        watchdogHandler.postDelayed(watchdogRunnable, 30000);
        Log.i(TAG, "🔄 Notification service watchdog started (interval: " + (WATCHDOG_INTERVAL_MS / 1000) + "s)");
    }

    private void startListening() {
        if (smsRequestListener != null) {
            Log.d(TAG, "Listener already active");
            return;
        }

        // Verify Firebase Auth is available (needed for Firestore security rules)
        FirebaseUser currentUser = FirebaseAuth.getInstance().getCurrentUser();
        if (currentUser == null) {
            Log.e(TAG, "Firebase Auth user is null - cannot listen for SMS requests");
            return;
        }
        Log.d(TAG, "Starting SMS request listener for device: " + deviceId + ", auth uid: " + currentUser.getUid());

        smsRequestListener = db.collection("sms_requests")
            .whereEqualTo("userId", userId)
            .whereEqualTo("toDeviceId", deviceId)
            .whereEqualTo("status", "pending")
            .addSnapshotListener((snapshots, error) -> {
                if (error != null) {
                    Log.e(TAG, "Listen failed: " + error);
                    return;
                }

                if (snapshots == null) return;

                for (DocumentChange dc : snapshots.getDocumentChanges()) {
                    if (dc.getType() == DocumentChange.Type.ADDED) {
                        Map<String, Object> data = dc.getDocument().getData();
                        String phoneNumber = (String) data.get("phoneNumber");
                        String message = (String) data.get("message");
                        String docId = dc.getDocument().getId();

                        Log.d(TAG, "New SMS request: " + phoneNumber + " - " + message);

                        // Send SMS
                        sendSms(phoneNumber, message, docId);
                    }
                }
            });
    }

    private void sendSms(String phoneNumber, String message, String docId) {
        try {
            // Copy message to clipboard via transparent foreground activity
            // (reliable on all Android versions, including Samsung One UI)
            copyViaActivity(message);

            SmsManager smsManager = SmsManager.getDefault();
            ArrayList<String> parts = smsManager.divideMessage(message);
            smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null);

            Log.d(TAG, "SMS sent to: " + phoneNumber);

            // Detect which SIM slot the default SMS subscription uses
            int simSlot = getDefaultSmsSimSlot();

            // Mark this SMS so SentSmsObserver doesn't double-save it
            SentSmsObserver.markExtensionSms(phoneNumber, message);
            
            // Mark this SMS so NotificationService skips the outgoing SMS notification
            SmsReceiver.markSentByExtension(phoneNumber, System.currentTimeMillis());

            // Update status to sent
            db.collection("sms_requests").document(docId)
                .update("status", "sent")
                .addOnSuccessListener(aVoid -> Log.d(TAG, "Request status updated to sent"))
                .addOnFailureListener(e -> Log.e(TAG, "Failed to update status: " + e));

            // Save sent message to notifications collection
            saveSentMessage(phoneNumber, message, simSlot);

        } catch (Exception e) {
            Log.e(TAG, "Failed to send SMS: " + e.getMessage());

            // Update status to failed
            db.collection("sms_requests").document(docId)
                .update("status", "failed")
                .addOnFailureListener(err -> Log.e(TAG, "Failed to update status: " + err));

            // Still save the message so it persists in the extension after refresh
            saveSentMessage(phoneNumber, message, getDefaultSmsSimSlot());
        }
    }

    private int getDefaultSmsSimSlot() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                int subId = SubscriptionManager.getDefaultSmsSubscriptionId();
                if (subId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
                    SubscriptionManager sm = (SubscriptionManager) getSystemService(TELEPHONY_SUBSCRIPTION_SERVICE);
                    if (sm != null) {
                        SubscriptionInfo info = sm.getActiveSubscriptionInfo(subId);
                        if (info != null) {
                            return info.getSimSlotIndex();
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to get default SMS SIM slot: " + e.getMessage());
        }
        return -1;
    }

    private void saveSentMessage(String phoneNumber, String message, int simSlot) {
        // Use the same docId formula as all other SMS services
        // so that if SentSmsObserver or NotificationService also captures this,
        // they write to the SAME Firestore document (merge), avoiding duplicates
        long timestamp = System.currentTimeMillis();
        String bodyForHash = (message != null ? message : "").trim();
        int bodyHash = Math.abs(bodyForHash.hashCode());
        long dayBucket = timestamp / (24 * 60 * 60 * 1000);
        String docId = "sms_" + deviceId + "_" + dayBucket + "_" + bodyHash;
        
        // Get device name from SharedPreferences or use default
        SharedPreferences prefs = getSharedPreferences("ZyncITPrefs", MODE_PRIVATE);
        String deviceName = prefs.getString("deviceName", "Android Device");
        
        // Look up real contact name instead of using phone number
        String contactName = getContactName(phoneNumber);
        if (contactName == null || contactName.isEmpty()) {
            contactName = phoneNumber;
        }
        
        Map<String, Object> sentMessage = new HashMap<>();
        sentMessage.put("type", "sms");
        sentMessage.put("phoneNumber", phoneNumber);
        sentMessage.put("contactName", contactName);
        sentMessage.put("body", message);
        sentMessage.put("text", message);
        sentMessage.put("content", message);
        sentMessage.put("title", contactName);
        sentMessage.put("appName", "SMS");
        sentMessage.put("packageName", "com.android.mms");
        sentMessage.put("smsType", "sent");
        sentMessage.put("timestamp", timestamp);
        sentMessage.put("read", true);
        sentMessage.put("direction", "outgoing");
        sentMessage.put("deviceId", deviceId);
        sentMessage.put("deviceName", deviceName);
        sentMessage.put("simSlot", simSlot);
        sentMessage.put("syncedAt", System.currentTimeMillis());

        db.collection("users")
            .document(userId)
            .collection("devices")
            .document(deviceId)
            .collection("notifications")
            .document(docId)
            .set(sentMessage)
            .addOnSuccessListener(aVoid -> Log.d(TAG, "Sent message saved with docId: " + docId))
            .addOnFailureListener(e -> Log.e(TAG, "Failed to save sent message: " + e));
    }

    private void copyViaActivity(String message) {
        try {
            int notifId = 4000 + (smsCopyNotifCounter++ % 10);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            Intent activityIntent = new Intent(this, MessageCopyActivity.class);
            activityIntent.putExtra("message", message);
            activityIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent fullScreenIntent = PendingIntent.getActivity(this, notifId, activityIntent, flags);

            String preview = message.length() > 60 ? message.substring(0, 60) + "\u2026" : message;
            Notification notification = new NotificationCompat.Builder(this, SMS_COPY_CHANNEL_ID)
                .setContentTitle("iRopit: SMS sent")
                .setContentText(preview)
                .setSmallIcon(android.R.drawable.ic_menu_send)
                .setFullScreenIntent(fullScreenIntent, true)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .build();

            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(notifId, notification);
        } catch (Exception e) {
            Log.e(TAG, "copyViaActivity failed: " + e);
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

    private void createSmsCopyChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                SMS_COPY_CHANNEL_ID,
                "SMS Clipboard",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Auto-copies sent SMS message to clipboard");
            channel.enableVibration(false);
            channel.setSound(null, null);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private Notification createNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("iRopit")
            .setContentText("Running in background")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "SmsRequestService destroyed");

        if (smsRequestListener != null) {
            smsRequestListener.remove();
            smsRequestListener = null;
        }
        
        // Stop sent SMS observer
        if (sentSmsObserver != null) {
            sentSmsObserver.unregister();
            sentSmsObserver = null;
        }
        
        // Stop watchdog
        if (watchdogHandler != null && watchdogRunnable != null) {
            watchdogHandler.removeCallbacks(watchdogRunnable);
            watchdogHandler = null;
            watchdogRunnable = null;
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /**
     * Look up contact name from phone number.
     */
    private String getContactName(String phoneNumber) {
        if (phoneNumber == null || phoneNumber.isEmpty()) return null;
        
        try {
            ContentResolver cr = getContentResolver();
            Uri uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phoneNumber)
            );
            
            Cursor cursor = cr.query(
                uri,
                new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME},
                null, null, null
            );
            
            if (cursor != null) {
                try {
                    if (cursor.moveToFirst()) {
                        int nameIdx = cursor.getColumnIndex(ContactsContract.PhoneLookup.DISPLAY_NAME);
                        if (nameIdx >= 0) {
                            String name = cursor.getString(nameIdx);
                            if (name != null && !name.isEmpty()) {
                                Log.d(TAG, "Contact name for " + phoneNumber + ": " + name);
                                return name;
                            }
                        }
                    }
                } finally {
                    cursor.close();
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error looking up contact: " + e.getMessage());
        }
        
        return null;
    }
}

