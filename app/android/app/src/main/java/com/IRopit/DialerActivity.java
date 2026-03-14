package com.IRopit;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

/**
 * Transparent trampoline activity that immediately opens the system dialer.
 * Launched via setFullScreenIntent so Android auto-starts it without user tap.
 */
public class DialerActivity extends Activity {
    private static final String TAG = "DialerActivity";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String phoneNumber = getIntent().getStringExtra("phoneNumber");
        int notificationId = getIntent().getIntExtra("notificationId", -1);
        Log.d(TAG, "DialerActivity launched for: " + phoneNumber);

        // Dismiss the dial notification immediately
        if (notificationId >= 0) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.cancel(notificationId);
        }

        if (phoneNumber != null && !phoneNumber.isEmpty()) {
            try {
                Intent dialIntent = new Intent(Intent.ACTION_DIAL);
                dialIntent.setData(Uri.parse("tel:" + Uri.encode(phoneNumber)));
                startActivity(dialIntent);
            } catch (Exception e) {
                Log.e(TAG, "Failed to open dialer: " + e);
            }
        }
        finish();
    }
}
