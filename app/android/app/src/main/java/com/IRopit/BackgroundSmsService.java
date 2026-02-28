package com.IRopit;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.SetOptions;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

public class BackgroundSmsService extends Service {
    private static final String TAG = "BackgroundSmsService";
    private static final int NOTIFICATION_ID = 1001;
    private FirebaseFirestore db;
    private FirebaseAuth auth;
    private FirebaseHelper firebaseHelper;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "BackgroundSmsService created");
        
        // Create notification channel for Android 8.0+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    "sync_channel",
                    "iRopit Sync",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
        
        db = FirebaseFirestore.getInstance();
        auth = FirebaseAuth.getInstance();
        firebaseHelper = FirebaseHelper.getInstance(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "onStartCommand called");

        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        // Start foreground service for background persistence
        try {
            startForeground(NOTIFICATION_ID, createNotification().build());
        } catch (Exception e) {
            Log.e(TAG, "Failed to start foreground: " + e.getMessage());
            // Still try to process the SMS even without foreground
        }

        String sender = intent.getStringExtra("sender");
        String message = intent.getStringExtra("message");
        String contactName = intent.getStringExtra("contactName");
        long timestamp = intent.getLongExtra("timestamp", System.currentTimeMillis());
        String deviceId = intent.getStringExtra("deviceId");
        String deviceName = intent.getStringExtra("deviceName");

        Log.d(TAG, "SMS received in background service: " + sender + " - " + message);
        
        // Save SMS to Firebase using FirebaseHelper
        if (sender != null && message != null) {
            saveSmsToFirebase(sender, message, timestamp, contactName);
        }
        
        // Stop the service after saving
        stopSelf();

        return START_NOT_STICKY;
    }

    private void saveSmsToFirebase(String sender, String message, long timestamp, String contactName) {
        Log.d(TAG, "saveSmsToFirebase called - sender: " + sender);
        
        if (auth.getCurrentUser() == null) {
            Log.w(TAG, "❌ No user logged in, cannot save SMS");
            return;
        }

        String userId = auth.getCurrentUser().getUid();
        String deviceId = firebaseHelper.getDeviceId();
        String deviceName = firebaseHelper.getDeviceName(); // Get friendly name instead of model

        Log.d(TAG, "userId: " + userId + ", deviceId: " + deviceId + ", deviceName: " + deviceName);

        if (deviceId == null || deviceId.isEmpty()) {
            Log.w(TAG, "❌ No device ID found in SharedPreferences, cannot save SMS");
            return;
        }

        // Create notification document
        Map<String, Object> smsData = new HashMap<>();
        // Use body-only hash for docId to match across both services
        // (NotificationService uses same formula in FirebaseHelper)
        String bodyForHash = (message != null ? message : "").trim();
        int bodyHash = Math.abs(bodyForHash.hashCode());
        long dayBucket = timestamp / (24 * 60 * 60 * 1000);
        String docId = "sms_" + deviceId + "_" + dayBucket + "_" + bodyHash;
        
        smsData.put("id", docId);
        smsData.put("key", "sms_" + docId);
        smsData.put("packageName", "com.android.mms");
        smsData.put("title", contactName != null && !contactName.isEmpty() ? contactName : sender);
        smsData.put("text", message);
        smsData.put("content", message);
        smsData.put("appName", "SMS");
        smsData.put("type", "sms");
        smsData.put("smsType", "inbox");
        smsData.put("timestamp", timestamp);
        smsData.put("receivedAt", timestamp);
        smsData.put("read", false);
        smsData.put("userId", userId);
        smsData.put("deviceId", deviceId);
        smsData.put("deviceName", deviceName);
        smsData.put("phoneNumber", sender);
        smsData.put("contactName", contactName != null ? contactName : "");
        smsData.put("syncedAt", System.currentTimeMillis());

        // Save to notifications collection
        db.collection("users")
            .document(userId)
            .collection("devices")
            .document(deviceId)
            .collection("notifications")
            .document(docId)
            .set(smsData, SetOptions.merge())
            .addOnSuccessListener(aVoid -> {
                Log.d(TAG, "✅ SMS saved to Firebase: " + sender);
            })
            .addOnFailureListener(e -> {
                Log.e(TAG, "❌ Error saving SMS to Firebase", e);
            });
    }

    private NotificationCompat.Builder createNotification() {
        return new NotificationCompat.Builder(this, "sync_channel")
                .setContentTitle("iRopit")
                .setContentText("Syncing messages...")
                .setSmallIcon(R.drawable.ic_notification)
                .setOngoing(true);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "BackgroundSmsService destroyed");
    }
}

