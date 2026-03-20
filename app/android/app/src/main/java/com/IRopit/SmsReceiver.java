package com.IRopit;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.ContactsContract;
import android.telephony.SmsMessage;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "SmsReceiver";
    private static ReactApplicationContext reactContext;
    
    // Set لتتبع الرسائل التي تم معالجتها لتجنب التكرار
    private static final Set<String> processedMessages = new HashSet<>();
    private static final long MESSAGE_EXPIRY_MS = 5000; // 5 ثوان
    
    // Track recently captured SMS so NotificationService can avoid duplicates
    private static final ConcurrentHashMap<String, Long> recentlyCapturedSms = new ConcurrentHashMap<>();
    // Track recently sent SMS (from extension) so NotificationService can skip outgoing SMS notifications
    private static final ConcurrentHashMap<String, Long> recentlySentSms = new ConcurrentHashMap<>();
    // Track recently captured SMS body hashes for content-based dedup
    // (works even when NotificationService can't extract phone number)
    private static final ConcurrentHashMap<Integer, Long> recentBodyHashes = new ConcurrentHashMap<>();
    private static final long DEDUP_WINDOW_MS = 60000; // 60 seconds (increased from 30s)
    
    /**
     * Mark an SMS as sent by the extension. NotificationService will skip notifications for these.
     */
    public static void markSentByExtension(String phoneNumber, long timestamp) {
        if (phoneNumber == null) return;
        String normalized = phoneNumber.replaceAll("[^0-9+]", "");
        recentlySentSms.put(normalized, timestamp);
        Log.d("SmsReceiver", "Marked extension-sent SMS to: " + normalized);
        // Cleanup old entries
        long now = System.currentTimeMillis();
        recentlySentSms.entrySet().removeIf(e -> now - e.getValue() > 60000);
    }
    
    /**
     * Check if an SMS to this number was recently sent by the extension.
     * Used by NotificationService to avoid showing outgoing SMS confirmation notifications.
     */
    public static boolean wasSentByExtension(String phoneNumber) {
        if (phoneNumber == null) return false;
        String normalized = phoneNumber.replaceAll("[^0-9+]", "");
        Long sentTime = recentlySentSms.get(normalized);
        if (sentTime != null && System.currentTimeMillis() - sentTime < 60000) {
            return true;
        }
        // Check last 4 digits for format differences
        if (normalized.length() >= 4) {
            String last4 = normalized.substring(normalized.length() - 4);
            for (java.util.Map.Entry<String, Long> entry : recentlySentSms.entrySet()) {
                if (entry.getKey().endsWith(last4) && System.currentTimeMillis() - entry.getValue() < 60000) {
                    return true;
                }
            }
        }
        return false;
    }
    
    /**
     * Track an SMS body hash so NotificationService can detect duplicates by content.
     * This works even when NotificationService can't extract a phone number from the notification.
     */
    public static void trackBodyHash(String body) {
        if (body == null) return;
        int hash = Math.abs(body.trim().hashCode());
        recentBodyHashes.put(hash, System.currentTimeMillis());
        Log.d("SmsReceiver", "Tracked SMS body hash: " + hash);
        // Cleanup old entries
        long cutoff = System.currentTimeMillis() - DEDUP_WINDOW_MS;
        recentBodyHashes.entrySet().removeIf(e -> e.getValue() < cutoff);
    }
    
    /**
     * Check if an SMS with the same body text was recently captured by SmsReceiver.
     * Used by NotificationService as a fallback dedup when phone number is unavailable.
     */
    public static boolean wasBodyRecentlyCaptured(String body) {
        if (body == null || body.trim().isEmpty()) return false;
        int hash = Math.abs(body.trim().hashCode());
        Long time = recentBodyHashes.get(hash);
        if (time != null && System.currentTimeMillis() - time < DEDUP_WINDOW_MS) {
            return true;
        }
        return false;
    }
    
    /**
     * Check if an SMS from this sender was recently captured by SmsReceiver.
     * Used by NotificationService to avoid duplicate processing.
     */
    public static boolean wasRecentlyCaptured(String sender, long timestamp) {
        if (sender == null) return false;
        String normalizedSender = sender.replaceAll("[^0-9+]", "");
        long now = System.currentTimeMillis();
        
        // Check by sender (any recent SMS from this sender)
        Long capturedTime = recentlyCapturedSms.get(normalizedSender);
        if (capturedTime != null) {
            // Accept if captured within the dedup window relative to either
            // the passed timestamp OR the current time (handles PDU vs postTime mismatch)
            if (Math.abs(capturedTime - timestamp) < DEDUP_WINDOW_MS || 
                Math.abs(now - capturedTime) < DEDUP_WINDOW_MS) {
                return true;
            }
        }
        // Also check last 4 digits (for format differences)
        if (normalizedSender.length() >= 4) {
            String last4 = normalizedSender.substring(normalizedSender.length() - 4);
            for (java.util.Map.Entry<String, Long> entry : recentlyCapturedSms.entrySet()) {
                if (entry.getKey().endsWith(last4)) {
                    if (Math.abs(entry.getValue() - timestamp) < DEDUP_WINDOW_MS ||
                        Math.abs(now - entry.getValue()) < DEDUP_WINDOW_MS) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    
    // تنظيف الرسائل القديمة من الـ Set
    private static class MessageCleanupTask implements Runnable {
        private final String messageKey;
        
        MessageCleanupTask(String key) {
            this.messageKey = key;
        }
        
        @Override
        public void run() {
            processedMessages.remove(messageKey);
        }
    }

    public static void setReactContext(ReactApplicationContext context) {
        reactContext = context;
        Log.d(TAG, "React context set");
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "=== SMS RECEIVER TRIGGERED ===");
        Log.d(TAG, "onReceive called with action: " + (intent != null ? intent.getAction() : "null"));
        
        if (intent == null) {
            Log.e(TAG, "Intent is null!");
            return;
        }
        
        String action = intent.getAction();
        Log.d(TAG, "Processing action: " + action);
        
        if ("android.provider.Telephony.SMS_RECEIVED".equals(action)) {
            Log.d(TAG, "SMS_RECEIVED action matched!");

            // Extract SIM slot from subscription ID in the broadcast intent
            int simSlot = -1;
            try {
                int subId = intent.getIntExtra("subscription", -1);
                if (subId == -1 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                    subId = intent.getIntExtra(SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX, -1);
                }
                if (subId >= 0) {
                    // On API 29+ use getSlotIndex which doesn't need READ_PHONE_NUMBERS
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        SubscriptionManager sm = (SubscriptionManager) context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                        if (sm != null) simSlot = sm.getSlotIndex(subId);
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1 &&
                            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE)
                                    == PackageManager.PERMISSION_GRANTED) {
                        SubscriptionManager sm = (SubscriptionManager) context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                        if (sm != null) {
                            SubscriptionInfo info = sm.getActiveSubscriptionInfo(subId);
                            if (info != null) simSlot = info.getSimSlotIndex();
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not resolve simSlot from intent: " + e.getMessage());
            }

            Bundle bundle = intent.getExtras();
            if (bundle != null) {
                Object[] pdus = (Object[]) bundle.get("pdus");
                String format = bundle.getString("format");
                
                if (pdus != null) {
                    StringBuilder fullMessage = new StringBuilder();
                    String sender = null;
                    long timestamp = System.currentTimeMillis();
                    
                    for (Object pdu : pdus) {
                        SmsMessage sms;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            sms = SmsMessage.createFromPdu((byte[]) pdu, format);
                        } else {
                            sms = SmsMessage.createFromPdu((byte[]) pdu);
                        }
                        
                        if (sms != null) {
                            if (sender == null) {
                                sender = sms.getOriginatingAddress();
                                timestamp = sms.getTimestampMillis();
                            }
                            fullMessage.append(sms.getMessageBody());
                        }
                    }
                    
                    Log.d(TAG, "SMS received from: " + sender + ", message: " + fullMessage.toString());
                    
                    // إنشاء مفتاح فريد للرسالة (sender + timestamp + message hash)
                    String messageKey = sender + "_" + timestamp + "_" + fullMessage.toString().hashCode();
                    
                    // التحقق من أن الرسالة لم تتم معالجتها مسبقاً
                    if (processedMessages.contains(messageKey)) {
                        Log.w(TAG, "⏭️ Duplicate SMS detected, skipping: " + messageKey);
                        return;
                    }
                    
                    // إضافة للقائمة المعالجة
                    processedMessages.add(messageKey);
                    Log.d(TAG, "✅ New unique SMS, processing: " + messageKey);
                    
                    // جدولة إزالة المفتاح بعد 5 ثوان لتجنب memory leak
                    android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
                    handler.postDelayed(new MessageCleanupTask(messageKey), MESSAGE_EXPIRY_MS);
                    
                    // جلب اسم جهة الاتصال
                    String contactName = getContactName(context, sender);

                    sendSmsEvent(context, sender, fullMessage.toString(), timestamp, contactName, simSlot);
                }
            }
        }
    }
    
    private String getContactName(Context context, String phoneNumber) {
        if (phoneNumber == null || phoneNumber.isEmpty()) {
            return "";
        }

        try {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) 
                    != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "READ_CONTACTS permission not granted");
                return "";
            }
            
            ContentResolver resolver = context.getContentResolver();
            
            // Try with original number first
            String name = lookupContactByPhone(resolver, phoneNumber);
            if (name != null && !name.isEmpty()) {
                return name;
            }
            
            // Clean the phone number - remove spaces, dashes, etc.
            String cleanNumber = phoneNumber.replaceAll("[^\\d+]", "");
            
            // Try with clean number
            if (!cleanNumber.equals(phoneNumber)) {
                name = lookupContactByPhone(resolver, cleanNumber);
                if (name != null && !name.isEmpty()) {
                    return name;
                }
            }
            
            // Try without country code (if starts with +)
            if (cleanNumber.startsWith("+")) {
                // Remove + and country code (assume 1-3 digits)
                String withoutPlus = cleanNumber.substring(1);
                
                // Try removing common country codes
                String[] prefixes = {"971", "966", "965", "974", "973", "968", "20", "1", "44", "91"};
                for (String prefix : prefixes) {
                    if (withoutPlus.startsWith(prefix)) {
                        String localNumber = withoutPlus.substring(prefix.length());
                        // Add leading 0 for local format
                        name = lookupContactByPhone(resolver, "0" + localNumber);
                        if (name != null && !name.isEmpty()) {
                            Log.d(TAG, "Found contact with local format: 0" + localNumber);
                            return name;
                        }
                        // Try without leading 0
                        name = lookupContactByPhone(resolver, localNumber);
                        if (name != null && !name.isEmpty()) {
                            return name;
                        }
                    }
                }
            }
            
            // Try adding country code if number starts with 0
            if (cleanNumber.startsWith("0")) {
                String withoutZero = cleanNumber.substring(1);
                // Try UAE format
                name = lookupContactByPhone(resolver, "+971" + withoutZero);
                if (name != null && !name.isEmpty()) {
                    return name;
                }
            }
            
        } catch (Exception e) {
            Log.e(TAG, "Error getting contact name", e);
        }

        return "";
    }
    
    private String lookupContactByPhone(ContentResolver resolver, String phoneNumber) {
        try {
            Uri uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phoneNumber)
            );

            String[] projection = new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME};
            Cursor cursor = resolver.query(uri, projection, null, null, null);

            if (cursor != null) {
                try {
                    if (cursor.moveToFirst()) {
                        String name = cursor.getString(0);
                        Log.d(TAG, "Found contact name: " + name + " for number: " + phoneNumber);
                        return name;
                    }
                } finally {
                    cursor.close();
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error looking up contact: " + phoneNumber, e);
        }
        return null;
    }
    
    private void sendSmsEvent(Context context, String sender, String message, long timestamp, String contactName, int simSlot) {
        // Track this SMS so NotificationService can skip it (avoid duplicate Firestore writes)
        if (sender != null) {
            String normalizedSender = sender.replaceAll("[^0-9+]", "");
            recentlyCapturedSms.put(normalizedSender, timestamp);
            Log.d(TAG, "Tracked SMS from " + normalizedSender + " at " + timestamp + " for dedup");
            
            // Clean old entries (older than DEDUP_WINDOW_MS)
            long cutoff = System.currentTimeMillis() - DEDUP_WINDOW_MS;
            recentlyCapturedSms.entrySet().removeIf(entry -> entry.getValue() < cutoff);
        }
        
        // Also track body hash for content-based dedup
        // (NotificationService uses this when it can't extract a phone number)
        trackBodyHash(message);

        // Always try to save to Firebase using background service
        try {
            Intent backgroundIntent = new Intent(context, BackgroundSmsService.class);
            backgroundIntent.putExtra("sender", sender);
            backgroundIntent.putExtra("message", message);
            backgroundIntent.putExtra("contactName", contactName);
            backgroundIntent.putExtra("timestamp", timestamp);
            backgroundIntent.putExtra("simSlot", simSlot);
            context.startService(backgroundIntent);
            Log.d(TAG, "Starting BackgroundSmsService to save SMS");
        } catch (Exception e) {
            Log.e(TAG, "Error starting BackgroundSmsService", e);
        }
        
        // Also send to React if available
        if (reactContext != null && reactContext.hasActiveReactInstance()) {
            WritableMap params = Arguments.createMap();
            params.putString("id", String.valueOf(System.currentTimeMillis()));
            params.putString("sender", sender != null ? sender : "Unknown");
            params.putString("contactName", contactName != null ? contactName : "");
            params.putString("message", message);
            params.putDouble("timestamp", timestamp);

            Log.d(TAG, "Sending SMS event to React Native - sender: " + sender + ", contact: " + contactName);
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("onSmsReceived", params);
        } else {
            Log.w(TAG, "Cannot send SMS event, no active React instance - but will save to Firebase");
        }
    }

    private void saveSmsToFirebaseBackground(String sender, String message, long timestamp, String contactName) {
        // This will be called from background and save SMS directly to Firebase
        new Thread(() -> {
            try {
                Log.d(TAG, "Saving SMS to Firebase in background...");
                // SMS will be saved by BackgroundSmsService when it's started
            } catch (Exception e) {
                Log.e(TAG, "Error saving SMS to Firebase", e);
            }
        }).start();
    }
}

