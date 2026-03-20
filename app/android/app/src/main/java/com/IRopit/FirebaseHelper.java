package com.IRopit;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.google.firebase.FirebaseApp;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.SetOptions;

import java.util.HashMap;
import java.util.Map;


public class FirebaseHelper {
    private static final String TAG = "ZyncIT_Firebase";
    private static final String PREFS_NAME = "ZyncITPrefs";
    private static final String KEY_USER_ID = "userId";
    private static final String KEY_DEVICE_ID = "deviceId";
    private static final String KEY_DEVICE_NAME = "deviceName";
    private static final String KEY_IS_LOGGED_IN = "isLoggedIn";

    private static FirebaseHelper instance;
    private FirebaseFirestore db;
    private Context context;

    private FirebaseHelper(Context context) {
        this.context = context.getApplicationContext();
        initFirebase();
    }

    public static synchronized FirebaseHelper getInstance(Context context) {
        if (instance == null) {
            instance = new FirebaseHelper(context);
        }
        return instance;
    }

    private void initFirebase() {
        try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                FirebaseApp.initializeApp(context);
            }
            db = FirebaseFirestore.getInstance();
            Log.i(TAG, "Firebase initialized successfully");
        } catch (Exception e) {
            Log.e(TAG, "Error initializing Firebase: " + e.getMessage());
        }
    }

    public void saveUserCredentials(String userId, String deviceId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putString(KEY_USER_ID, userId)
                .putString(KEY_DEVICE_ID, deviceId)
                .putBoolean(KEY_IS_LOGGED_IN, true)
                .apply();
        Log.i(TAG, "User credentials saved: userId=" + userId + ", deviceId=" + deviceId);
    }
    
    public void saveDeviceName(String deviceName) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putString(KEY_DEVICE_NAME, deviceName)
                .apply();
        Log.i(TAG, "Device name saved: " + deviceName);
    }
    
    public String getDeviceName() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String savedName = prefs.getString(KEY_DEVICE_NAME, null);
        if (savedName != null && !savedName.isEmpty()) {
            return savedName;
        }
        // Fallback to "Android" if no name saved
        return "Android";
    }

    public void clearUserCredentials() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .remove(KEY_USER_ID)
                .remove(KEY_DEVICE_ID)
                .putBoolean(KEY_IS_LOGGED_IN, false)
                .apply();
        Log.i(TAG, "User credentials cleared");
    }

    public String getUserId() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_USER_ID, null);
    }

    public String getDeviceId() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_DEVICE_ID, null);
    }

    public boolean isLoggedIn() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_IS_LOGGED_IN, false);
    }

    public void sendNotificationToFirestore(String id, String key, String packageName, 
            String title, String text, String bigText, String subText, 
            String type, long timestamp, String appName, boolean isMissedCall, String appIcon) {
        sendNotificationToFirestore(id, key, packageName, title, text, bigText, subText,
            type, timestamp, appName, isMissedCall, appIcon, null, null);
    }

    public void sendNotificationToFirestore(String id, String key, String packageName, 
            String title, String text, String bigText, String subText, 
            String type, long timestamp, String appName, boolean isMissedCall, String appIcon,
            String phoneNumber, String contactName) {
        
        String userId = getUserId();
        String deviceId = getDeviceId();

        if (userId == null || deviceId == null) {
            Log.w(TAG, "Cannot send to Firestore: User not logged in");
            return;
        }

        if (db == null) {
            initFirebase();
            if (db == null) {
                Log.e(TAG, "Firestore not initialized");
                return;
            }
        }

        Map<String, Object> notification = new HashMap<>();
        notification.put("id", id);
        notification.put("key", key);
        notification.put("packageName", packageName);
        notification.put("title", title);
        notification.put("text", text);
        notification.put("bigText", bigText);
        notification.put("subText", subText);
        notification.put("type", type);
        // For SMS: use current system time since Google Messages reuses postTime
        if (type.equals("sms")) {
            notification.put("timestamp", System.currentTimeMillis());
        } else {
            notification.put("timestamp", timestamp);
        }
        notification.put("appName", appName);
        notification.put("isMissedCall", isMissedCall);
        notification.put("isNew", true);
        notification.put("createdAt", System.currentTimeMillis());
        notification.put("read", false);
        if (appIcon != null) {
            notification.put("appIcon", appIcon);
        }
        // For SMS: also store text as "body" for compatibility with extension/app
        if (type.equals("sms")) {
            String messageBody = (bigText != null && !bigText.isEmpty()) ? bigText : text;
            notification.put("body", messageBody);
            notification.put("direction", "incoming");
        }
        // حفظ phoneNumber و contactName للـ SMS
        if (phoneNumber != null && !phoneNumber.isEmpty()) {
            notification.put("phoneNumber", phoneNumber);
        }
        if (contactName != null) {
            notification.put("contactName", contactName);
        }

        String docId;
        if (type.equals("sms")) {
            // For SMS: use deterministic docId that matches across both services
            // IMPORTANT: Use ONLY the "text" field (not bigText) for the hash!
            // BackgroundSmsService hashes the raw SMS body, which matches the notification's
            // "text" field. Google Messages puts conversation history in "bigText" which 
            // differs from the raw SMS body and causes mismatched docIds → duplicates.
            String bodyForHash = (text != null ? text : "").trim();
            int bodyHash = Math.abs(bodyForHash.hashCode());
            // Use the passed timestamp (not System.currentTimeMillis()) for dayBucket
            // to match BackgroundSmsService which uses the PDU timestamp
            long dayBucket = timestamp / (24 * 60 * 60 * 1000);
            docId = "sms_" + deviceId + "_" + dayBucket + "_" + bodyHash;
        } else {
            docId = key.replaceAll("[^a-zA-Z0-9]", "_");
        }

        db.collection("users")
                .document(userId)
                .collection("devices")
                .document(deviceId)
                .collection("notifications")
                .document(docId)
                .set(notification, SetOptions.merge())
                .addOnSuccessListener(aVoid -> {
                    Log.i(TAG, "Notification sent to Firestore: " + docId);
                })
                .addOnFailureListener(e -> {
                    Log.e(TAG, "Error sending notification to Firestore: " + e.getMessage());
                });
    }

    public void sendCallToFirestore(String phoneNumber, String contactName, 
            String callType, long timestamp, int duration, int simSlot) {
        
        String userId = getUserId();
        String deviceId = getDeviceId();

        if (userId == null || deviceId == null) {
            Log.w(TAG, "Cannot send call to Firestore: User not logged in");
            return;
        }

        if (db == null) {
            initFirebase();
            if (db == null) {
                Log.e(TAG, "Firestore not initialized");
                return;
            }
        }

        Map<String, Object> call = new HashMap<>();
        call.put("phoneNumber", phoneNumber);
        call.put("contactName", contactName != null ? contactName : phoneNumber);
        call.put("type", callType);
        call.put("callType", callType); // backward compatibility
        call.put("timestamp", timestamp);
        call.put("duration", duration);
        call.put("deviceId", deviceId);
        call.put("deviceName", getDeviceName());
        call.put("simSlot", simSlot);
        call.put("createdAt", System.currentTimeMillis());
        call.put("read", false);

        // Use stable docId: call_timestamp_phoneNumber (matches React Native callStore format)
        String cleanPhone = phoneNumber.replaceAll("[^0-9+]", "");
        String docId = ("call_" + timestamp + "_" + cleanPhone).replaceAll("[/\\.]", "_");

        db.collection("users")
                .document(userId)
                .collection("devices")
                .document(deviceId)
                .collection("calls")
                .document(docId)
                .set(call, SetOptions.merge())
                .addOnSuccessListener(aVoid -> {
                    Log.i(TAG, "Call sent to Firestore: " + docId);
                })
                .addOnFailureListener(e -> {
                    Log.e(TAG, "Error sending call to Firestore: " + e.getMessage());
                });
    }
}

