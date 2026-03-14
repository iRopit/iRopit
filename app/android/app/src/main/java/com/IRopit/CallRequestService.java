package com.IRopit;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.provider.ContactsContract;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.firebase.firestore.DocumentChange;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.ListenerRegistration;

public class CallRequestService extends Service {
    private static final String TAG = "CallRequestService";
    private static final String CHANNEL_ID = "iropit_service_channel";
    private static final String DIAL_CHANNEL_ID = "call_dial_channel";
    private static final int NOTIFICATION_ID = 1001;
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
            // Look up contact name
            String contactName = getContactName(phoneNumber);
            String displayName = (contactName != null && !contactName.isEmpty())
                ? contactName : phoneNumber;

            // Launch DialerActivity directly — it's a transparent trampoline that opens
            // the system dialer. Works on all Android versions because we're a foreground service.
            boolean launched = false;
            try {
                Intent activityIntent = new Intent(this, DialerActivity.class);
                activityIntent.putExtra("phoneNumber", phoneNumber);
                activityIntent.putExtra("notificationId", -1);
                activityIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(activityIntent);
                launched = true;
                Log.d(TAG, "DialerActivity launched directly for: " + displayName);
            } catch (Exception e) {
                Log.w(TAG, "Direct launch failed, falling back to notification: " + e.getMessage());
            }

            // Fallback: notification with full-screen intent (in case direct launch is blocked)
            if (!launched) {
                Intent dialIntent = new Intent(Intent.ACTION_DIAL);
                dialIntent.setData(Uri.parse("tel:" + Uri.encode(phoneNumber)));
                dialIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                showDialNotification(phoneNumber, displayName, dialIntent);
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

    private void showDialNotification(String phoneNumber, String displayName, Intent dialIntent) {
        int notificationId = DIAL_NOTIFICATION_BASE_ID + (dialNotificationCounter++ % 10);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        // Full-screen intent: launches DialerActivity (transparent trampoline) automatically
        Intent activityIntent = new Intent(this, DialerActivity.class);
        activityIntent.putExtra("phoneNumber", phoneNumber);
        activityIntent.putExtra("notificationId", notificationId);
        activityIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent fullScreenIntent = PendingIntent.getActivity(this, notificationId, activityIntent, flags);

        // Fallback content intent: direct dial if user taps the notification manually
        PendingIntent contentIntent = PendingIntent.getActivity(this, notificationId + 100, dialIntent, flags);

        Notification notification = new NotificationCompat.Builder(this, DIAL_CHANNEL_ID)
            .setContentTitle("Calling " + displayName)
            .setContentText(displayName.equals(phoneNumber) ? "" : phoneNumber)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(contentIntent)
            .setFullScreenIntent(fullScreenIntent, true)
            .setAutoCancel(true)
            .setTimeoutAfter(5000)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .build();

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(notificationId, notification);
        }
        Log.d(TAG, "Dial notification shown for: " + displayName + " (" + phoneNumber + ")");
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
                        int idx = cursor.getColumnIndex(ContactsContract.PhoneLookup.DISPLAY_NAME);
                        if (idx >= 0) return cursor.getString(idx);
                    }
                } finally {
                    cursor.close();
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Contact lookup failed: " + e.getMessage());
        }
        return null;
    }
}

