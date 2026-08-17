package com.IRopit;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.ContentObserver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.provider.ContactsContract;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

import android.Manifest;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.SetOptions;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.IRopit.SmsReceiver;

/**
 * ContentObserver that monitors the SMS content provider for outgoing (sent) messages.
 * When the user sends an SMS from the native phone SMS app, this observer detects it
 * and saves it to Firestore so it appears in the Chrome extension.
 *
 * Registered in SmsRequestService (long-running foreground service).
 */
public class SentSmsObserver extends ContentObserver {
    private static final String TAG = "SentSmsObserver";
    
    // URI to observe all SMS changes
    private static final Uri SMS_URI = Uri.parse("content://sms");
    // URI to query sent messages
    private static final Uri SMS_SENT_URI = Uri.parse("content://sms/sent");
    
    // Dedup: track last processed SMS ID to avoid reprocessing
    private long lastProcessedSmsId = -1;
    
    // Dedup: track recently saved outgoing SMS (by body hash) to avoid saving SMS sent from extension
    private static final ConcurrentHashMap<String, Long> recentExtensionSms = new ConcurrentHashMap<>();
    private static final long EXTENSION_SMS_DEDUP_WINDOW_MS = 60000; // 1 minute
    
    private final Context context;
    private final ContentResolver contentResolver;
    private final FirebaseFirestore db;
    private final FirebaseAuth auth;
    private final FirebaseHelper firebaseHelper;
    
    // Throttle: don't process more than once per second
    private long lastProcessTime = 0;
    private static final long THROTTLE_MS = 1000;
    
    // Polling fallback: some devices don't fire ContentObserver for sent SMS
    private Handler pollingHandler;
    private Runnable pollingRunnable;
    private static final long POLLING_INTERVAL_FAST_MS = 10000; // 10 seconds
    private static final long POLLING_INTERVAL_SLOW_MS = 30000; // 30 seconds
    private static final long FAST_POLL_WINDOW_MS = 2 * 60 * 1000; // first 2 minutes
    private long pollingStartedAt = 0L;
    
    public SentSmsObserver(Handler handler, Context context) {
        super(handler);
        this.context = context;
        this.contentResolver = context.getContentResolver();
        this.db = FirebaseFirestore.getInstance();
        this.auth = FirebaseAuth.getInstance();
        this.firebaseHelper = FirebaseHelper.getInstance(context);
        this.pollingHandler = handler;
        
        // Initialize lastProcessedSmsId with the current latest sent SMS
        initLastSmsId();
        
        Log.i(TAG, "SentSmsObserver created, lastProcessedSmsId: " + lastProcessedSmsId);
    }
    
    /**
     * Initialize with the current latest sent SMS ID so we don't process old messages.
     */
    private void initLastSmsId() {
        try {
            // Query the highest _id from all sent SMS (type=2) in content://sms
            // Using content://sms instead of content://sms/sent for better compatibility
            Cursor cursor = contentResolver.query(
                SMS_URI,
                new String[]{"_id"},
                "type = 2",
                null,
                "_id DESC"
            );
            
            if (cursor != null) {
                try {
                    if (cursor.moveToFirst()) {
                        lastProcessedSmsId = cursor.getLong(0);
                    }
                } finally {
                    cursor.close();
                }
            }
            Log.i(TAG, "Initialized lastProcessedSmsId: " + lastProcessedSmsId);
        } catch (Exception e) {
            Log.e(TAG, "Error initializing last SMS ID: " + e.getMessage());
        }
    }
    
    /**
     * Register this observer on the SMS content provider.
     */
    public void register() {
        try {
            contentResolver.registerContentObserver(SMS_URI, true, this);
            Log.i(TAG, "✅ SentSmsObserver registered on content://sms");
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to register SentSmsObserver: " + e.getMessage());
        }
        
        // Start polling fallback - some devices (Samsung, Xiaomi) don't 
        // reliably fire ContentObserver for sent SMS
        startPolling();
    }
    
    /**
     * Unregister this observer.
     */
    public void unregister() {
        try {
            contentResolver.unregisterContentObserver(this);
            Log.i(TAG, "SentSmsObserver unregistered");
        } catch (Exception e) {
            Log.e(TAG, "Error unregistering SentSmsObserver: " + e.getMessage());
        }
        stopPolling();
    }
    
    /**
     * Start periodic polling for new sent SMS as a fallback.
     */
    private void startPolling() {
        if (pollingRunnable != null) return;

        pollingStartedAt = System.currentTimeMillis();

        // Run an immediate check so recent SMS are fetched without waiting for first timer tick.
        try {
            checkForNewSentSms();
        } catch (Exception e) {
            Log.e(TAG, "Initial polling check error: " + e.getMessage());
        }
        
        pollingRunnable = new Runnable() {
            @Override
            public void run() {
                try {
                    Log.d(TAG, "🔄 Polling for new sent SMS...");
                    checkForNewSentSms();
                } catch (Exception e) {
                    Log.e(TAG, "Polling error: " + e.getMessage());
                }
                if (pollingHandler != null && pollingRunnable != null) {
                    long elapsed = System.currentTimeMillis() - pollingStartedAt;
                    long interval = elapsed <= FAST_POLL_WINDOW_MS
                            ? POLLING_INTERVAL_FAST_MS
                            : POLLING_INTERVAL_SLOW_MS;
                    pollingHandler.postDelayed(pollingRunnable, interval);
                }
            }
        };
        
        // Start first scheduled poll quickly after startup
        pollingHandler.postDelayed(pollingRunnable, 3000);
        Log.i(TAG, "🔄 Sent SMS polling started (fast="
                + (POLLING_INTERVAL_FAST_MS / 1000)
                + "s for " + (FAST_POLL_WINDOW_MS / 1000)
                + "s, then slow=" + (POLLING_INTERVAL_SLOW_MS / 1000) + "s)");
    }
    
    /**
     * Stop periodic polling.
     */
    private void stopPolling() {
        if (pollingHandler != null && pollingRunnable != null) {
            pollingHandler.removeCallbacks(pollingRunnable);
            pollingRunnable = null;
            Log.i(TAG, "Sent SMS polling stopped");
        }
    }
    
    /**
     * Called by SmsRequestService when it sends an SMS on behalf of the extension.
     * We track these so we don't double-save them.
     */
    public static void markExtensionSms(String phoneNumber, String body) {
        if (phoneNumber == null || body == null) return;
        String key = phoneNumber.replaceAll("[^0-9+]", "") + "_" + body.trim().hashCode();
        recentExtensionSms.put(key, System.currentTimeMillis());
        Log.d(TAG, "Marked extension SMS for dedup: " + key);
        
        // Cleanup old entries
        long now = System.currentTimeMillis();
        recentExtensionSms.entrySet().removeIf(entry -> 
            now - entry.getValue() > EXTENSION_SMS_DEDUP_WINDOW_MS
        );
    }
    
    /**
     * Check if this SMS was sent from the extension (should not be saved again).
     */
    private boolean isExtensionSms(String phoneNumber, String body) {
        if (phoneNumber == null || body == null) return false;
        String key = phoneNumber.replaceAll("[^0-9+]", "") + "_" + body.trim().hashCode();
        Long time = recentExtensionSms.get(key);
        if (time != null && System.currentTimeMillis() - time < EXTENSION_SMS_DEDUP_WINDOW_MS) {
            return true;
        }
        return false;
    }
    
    @Override
    public void onChange(boolean selfChange) {
        onChange(selfChange, null);
    }
    
    @Override
    public void onChange(boolean selfChange, Uri uri) {
        long now = System.currentTimeMillis();
        
        // Throttle: don't process too frequently
        if (now - lastProcessTime < THROTTLE_MS) {
            return;
        }
        lastProcessTime = now;
        
        Log.d(TAG, "SMS content changed, checking for new sent messages...");
        
        try {
            checkForNewSentSms();
        } catch (Exception e) {
            Log.e(TAG, "Error checking for sent SMS: " + e.getMessage(), e);
        }
    }
    
    /**
     * Query the sent SMS content provider for messages newer than lastProcessedSmsId.
     */
    private void checkForNewSentSms() {
        if (auth.getCurrentUser() == null) {
            Log.d(TAG, "No user logged in, skipping sent SMS check");
            return;
        }
        
        String userId = auth.getCurrentUser().getUid();
        String deviceId = firebaseHelper.getDeviceId();
        String deviceName = firebaseHelper.getDeviceName();
        
        if (deviceId == null || deviceId.isEmpty()) {
            Log.d(TAG, "No device ID, skipping sent SMS check");
            return;
        }
        
        Cursor cursor = null;
        try {
            // Query sent SMS with _id greater than lastProcessedSmsId
            // type = 2 means "sent", type = 5 means "outbox" (some devices use outbox first)
            // We check both to catch all outgoing SMS
            String selection = "_id > ? AND (type = 2 OR type = 5)";
            String[] selectionArgs = new String[]{String.valueOf(lastProcessedSmsId)};
            
            // Android 16+ strips subscription_id from the restricted SMS view.
            // Try subscription_id first, fall back to sub_id, then query without it.
            String[] baseColumns = new String[]{"_id", "address", "body", "date", "type"};
            String[] colsWithSubId = new String[]{"_id", "address", "body", "date", "type", "subscription_id"};
            String[] colsWithSub = new String[]{"_id", "address", "body", "date", "type", "sub_id"};
            
            try {
                cursor = contentResolver.query(SMS_URI, colsWithSubId, selection, selectionArgs, "_id ASC");
            } catch (Exception e1) {
                Log.w(TAG, "subscription_id column not available, trying sub_id");
                try {
                    cursor = contentResolver.query(SMS_URI, colsWithSub, selection, selectionArgs, "_id ASC");
                } catch (Exception e2) {
                    Log.w(TAG, "sub_id column not available, querying without subscription column");
                    cursor = contentResolver.query(SMS_URI, baseColumns, selection, selectionArgs, "_id ASC");
                }
            }
            
            // Resolve subscriptionId -> slotIndex
            // On Android 16+ getActiveSubscriptionInfoList() is blocked.
            // Use getSlotIndex(subId) on API 29+ as a lightweight alternative.
            SubscriptionManager sm = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                sm = (SubscriptionManager) context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
            }
            
            if (cursor == null) {
                Log.d(TAG, "Cursor is null for sent SMS query");
                return;
            }
            
            int count = cursor.getCount();
            if (count > 0) {
                Log.i(TAG, "📤 Found " + count + " new sent SMS messages");
            }
            
            while (cursor.moveToNext()) {
                long smsId = cursor.getLong(0);
                String address = cursor.getString(1);
                String body = cursor.getString(2);
                long date = cursor.getLong(3);
                int type = cursor.getInt(4);

                // Resolve SIM slot — try subscription_id first, then sub_id
                int simSlot = -1;
                try {
                    int colIdx = cursor.getColumnIndex("subscription_id");
                    if (colIdx < 0) colIdx = cursor.getColumnIndex("sub_id");
                    if (colIdx >= 0) {
                        int subId = cursor.getInt(colIdx);
                        simSlot = resolveSimSlot(sm, subId);
                    }
                } catch (Exception e) { /* ignore */ }
                
                // Update last processed ID
                lastProcessedSmsId = smsId;
                
                if (address == null || address.isEmpty()) {
                    Log.d(TAG, "Skipping SMS with no address, id: " + smsId);
                    continue;
                }
                
                if (body == null) body = "";
                
                // Check if this was sent from the extension (avoid double-saving)
                if (isExtensionSms(address, body)) {
                    Log.d(TAG, "📤 Skipping extension-sent SMS to " + address + " (already saved)");
                    continue;
                }
                
                Log.i(TAG, "📤 New SENT SMS detected - To: " + address + ", Body length: " + body.length());
                
                // Track this outgoing SMS so NotificationService won't save it again
                // (Google Messages posts a notification for sent SMS too)
                SmsReceiver.trackBodyHash(body);
                SmsReceiver.markSentByExtension(address, System.currentTimeMillis());
                Log.d(TAG, "📤 Tracked outgoing SMS for dedup - body hash + phone: " + address);
                
                // Look up contact name
                String contactName = getContactName(address);
                
                // Save to Firestore
                saveSentSmsToFirestore(userId, deviceId, deviceName, address, body, date, contactName, simSlot);
            }
            
        } catch (SecurityException se) {
            Log.e(TAG, "❌ Permission denied reading SMS: " + se.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "❌ Error reading sent SMS: " + e.getMessage(), e);
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
    }
    
    /**
     * Save an outgoing SMS to Firestore in the same format as BackgroundSmsService.
     */
    private void saveSentSmsToFirestore(String userId, String deviceId, String deviceName,
                                         String phoneNumber, String body, long timestamp,
                                         String contactName, int simSlot) {
        try {
            // Generate docId - use "sms_" prefix (same as NotificationService/FirebaseHelper).
            // When a user sends an SMS, BOTH SentSmsObserver AND NotificationService may capture it.
            // NotificationService captures Google Messages' notification and uses this same docId formula.
            // By using the same docId, both services write to the SAME Firestore document (merge),
            // so only one notification appears in the extension.
            // Note: We use just the text body for the hash (same as FirebaseHelper) to ensure matching.
            String bodyForHash = (body != null ? body : "").trim();
            int bodyHash = Math.abs(bodyForHash.hashCode());
            long dayBucket = timestamp / (24 * 60 * 60 * 1000);
            String docId = "sms_" + deviceId + "_" + dayBucket + "_" + bodyHash;
            
            Map<String, Object> smsData = new HashMap<>();
            smsData.put("id", docId);
            smsData.put("key", "sms_" + docId);
            smsData.put("packageName", "com.android.mms");
            smsData.put("title", contactName != null && !contactName.isEmpty() ? contactName : phoneNumber);
            smsData.put("text", body);
            smsData.put("content", body);
            smsData.put("body", body);
            smsData.put("appName", "SMS");
            smsData.put("type", "sms");
            smsData.put("smsType", "sent");
            smsData.put("direction", "outgoing");
            smsData.put("timestamp", timestamp);
            smsData.put("sentAt", timestamp);
            smsData.put("read", true);
            smsData.put("userId", userId);
            smsData.put("deviceId", deviceId);
            smsData.put("deviceName", deviceName);
            smsData.put("phoneNumber", phoneNumber);
            smsData.put("contactName", contactName != null ? contactName : "");
            smsData.put("simSlot", simSlot);
            smsData.put("syncedAt", System.currentTimeMillis());
            
            // Save to notifications collection (same path as incoming SMS)
            db.collection("users")
                .document(userId)
                .collection("devices")
                .document(deviceId)
                .collection("notifications")
                .document(docId)
                .set(smsData, SetOptions.merge())
                .addOnSuccessListener(aVoid -> {
                    Log.i(TAG, "✅ Sent SMS saved to Firestore: " + phoneNumber + " (docId: " + docId + ")");
                })
                .addOnFailureListener(e -> {
                    Log.e(TAG, "❌ Failed to save sent SMS: " + e.getMessage());
                });
                
        } catch (Exception e) {
            Log.e(TAG, "❌ Error saving sent SMS to Firestore: " + e.getMessage(), e);
        }
    }
    
    /**
     * Look up contact name from phone number.
     */
    private String getContactName(String phoneNumber) {
        if (phoneNumber == null || phoneNumber.isEmpty()) return null;
        
        try {
            Uri uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phoneNumber)
            );
            
            Cursor cursor = contentResolver.query(
                uri,
                new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME},
                null, null, null
            );
            
            if (cursor != null) {
                try {
                    if (cursor.moveToFirst()) {
                        int nameIndex = cursor.getColumnIndex(ContactsContract.PhoneLookup.DISPLAY_NAME);
                        if (nameIndex >= 0) {
                            String name = cursor.getString(nameIndex);
                            if (name != null && !name.isEmpty()) {
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

    /**
     * Resolve SIM slot index from a subscription ID.
     * On API 29+ uses getSlotIndex() which doesn't require READ_PHONE_NUMBERS.
     * Falls back to getActiveSubscriptionInfo() on older APIs.
     */
    private int resolveSimSlot(SubscriptionManager sm, int subId) {
        if (sm == null || subId < 0) return -1;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                return sm.getSlotIndex(subId);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1 &&
                    ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE)
                            == PackageManager.PERMISSION_GRANTED) {
                SubscriptionInfo info = sm.getActiveSubscriptionInfo(subId);
                if (info != null) return info.getSimSlotIndex();
            }
        } catch (Exception e) {
            Log.w(TAG, "resolveSimSlot failed for subId " + subId + ": " + e.getMessage());
        }
        return -1;
    }
}
