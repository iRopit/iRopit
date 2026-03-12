package com.IRopit;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
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
    private static final int NOTIFICATION_ID = 2003;

    private FirebaseFirestore db;
    private ListenerRegistration callRequestListener;
    private String userId;
    private String deviceId;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "CallRequestService created");
        db = FirebaseFirestore.getInstance();
        createNotificationChannel();
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
                    Log.e(TAG, "Listen failed: " + error);
                    return;
                }
                if (snapshots == null) return;

                for (DocumentChange dc : snapshots.getDocumentChanges()) {
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
            startActivity(dialIntent);

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
