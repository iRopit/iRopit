package com.IRopit;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.firebase.firestore.DocumentChange;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.ListenerRegistration;

public class CallRequestService extends Service {
    private static final String TAG = "CallRequestService";
    private static final String CHANNEL_ID = "call_request_channel";
    private static final String DIAL_CHANNEL_ID = "call_dial_channel";
    private static final int NOTIFICATION_ID = 2003;
    private static final int DIAL_NOTIFICATION_BASE_ID = 3000;

    private FirebaseFirestore db;
    private ListenerRegistration callRequestListener;
    private String userId;
    private String deviceId;
    private int dialNotificationCounter = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "CallRequestService created");
        db = FirebaseFirestore.getInstance();
        createNotificationChannel();
        createDialNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "CallRequestService started");

        try {
            startForeground(NOTIFICATION_ID, createNotification());
        } catch (Exception e) {
            Log.e(TAG, "Failed to start foreground service: " + e.getMessage());
            stopSelf();
            return START_NOT_STICKY;
        }

        SharedPreferences prefs = getSharedPreferences("ZyncITPrefs", MODE_PRIVATE);
        userId = prefs.getString("userId", null);
        deviceId = prefs.getString("deviceId", null);

        if (userId == null || deviceId == null) {
            Log.e(TAG, "No credentials found, stopping service");
            stopSelf();
            return START_NOT_STICKY;
        }

        startListening();
        return START_STICKY;
    }

    private void startListening() {
        if (callRequestListener != null) return;

        Log.d(TAG, "Starting call request listener for device: " + deviceId);

        callRequestListener = db.collection("call_requests")
            .whereEqualTo("toDeviceId", deviceId)
            .whereEqualTo("status", "pending")
            .addSnapshotListener((snapshots, error) -> {
                if (error != null) {
                    Log.e(TAG, "Listen failed: " + error.getCode() + " - " + error.getMessage());
                    return;
                }
                if (snapshots == null) {
                    Log.w(TAG, "Snapshot is null");
                    return;
                }
                Log.d(TAG, "Snapshot received: " + snapshots.size() + " docs, " + snapshots.getDocumentChanges().size() + " changes");

                for (DocumentChange dc : snapshots.getDocumentChanges()) {
                    Log.d(TAG, "Doc change type=" + dc.getType() + " id=" + dc.getDocument().getId());
                    if (dc.getType() == DocumentChange.Type.ADDED) {
                        String phoneNumber = (String) dc.getDocument().getData().get("phoneNumber");
                        String docId = dc.getDocument().getId();
                        Log.d(TAG, "New call request to: " + phoneNumber);
                        openDialer(phoneNumber, docId);
                    }
                }
            });
    }

    private void openDialer(String phoneNumber, String docId) {
        try {
            Intent dialIntent = new Intent(Intent.ACTION_DIAL);
            dialIntent.setData(Uri.parse("tel:" + Uri.encode(phoneNumber)));
            dialIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            // On Android 10+ (API 29+), startActivity from a background/foreground service
            // is restricted. Show a tap-to-dial notification that works on all versions.
            boolean launched = false;
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                // Android 9 and below: can start activity directly
                try {
                    startActivity(dialIntent);
                    launched = true;
                } catch (Exception ignored) {}
            }

            if (!launched) {
                // Android 10+: show a high-priority notification the user can tap to dial
                showDialNotification(phoneNumber, dialIntent);
            }

            // Mark request as processed
            db.collection("call_requests").document(docId)
                .update("status", "dialing")
                .addOnSuccessListener(v -> Log.d(TAG, "Call request marked as dialing"))
                .addOnFailureListener(e -> Log.e(TAG, "Failed to update call request: " + e));

        } catch (Exception e) {
            Log.e(TAG, "Failed to open dialer: " + e.getMessage());
            db.collection("call_requests").document(docId)
                .update("status", "failed")
                .addOnFailureListener(err -> Log.e(TAG, "Failed to update status: " + err));
        }
    }

    private void showDialNotification(String phoneNumber, Intent dialIntent) {
        int notificationId = DIAL_NOTIFICATION_BASE_ID + (dialNotificationCounter++ % 10);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        // Full-screen intent: launches DialerActivity (transparent trampoline) automatically
        // without requiring user to tap the notification (same mechanism as incoming call screens)
        Intent activityIntent = new Intent(this, DialerActivity.class);
        activityIntent.putExtra("phoneNumber", phoneNumber);
        activityIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent fullScreenIntent = PendingIntent.getActivity(this, notificationId, activityIntent, flags);

        // Fallback content intent: direct dial if user taps the notification manually
        PendingIntent contentIntent = PendingIntent.getActivity(this, notificationId + 100, dialIntent, flags);

        Notification notification = new NotificationCompat.Builder(this, DIAL_CHANNEL_ID)
            .setContentTitle("Dialing: " + phoneNumber)
            .setContentText("iRopit: Dial request from Chrome extension")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(contentIntent)
            .setFullScreenIntent(fullScreenIntent, true)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .build();

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(notificationId, notification);
        }
        Log.d(TAG, "Dial full-screen intent shown for: " + phoneNumber);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Call Requests",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("iRopit call dial requests");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void createDialNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                DIAL_CHANNEL_ID,
                "Dial Requests",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Tap to open the dialer on your phone");
            channel.enableVibration(true);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private Notification createNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("iRopit")
            .setContentText("Ready to open dialer on request")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (callRequestListener != null) {
            callRequestListener.remove();
            callRequestListener = null;
        }
        Log.d(TAG, "CallRequestService destroyed");
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

