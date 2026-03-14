package com.IRopit;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.os.Bundle;
import android.util.Log;

/**
 * Transparent activity that copies a message to clipboard.
 * Launched via setFullScreenIntent so it has a focused window context,
 * making setPrimaryClip() reliable on all Android versions including Samsung One UI.
 */
public class MessageCopyActivity extends Activity {
    private static final String TAG = "MessageCopyActivity";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String message = getIntent().getStringExtra("message");
        Log.d(TAG, "MessageCopyActivity: copying message length=" + (message != null ? message.length() : 0));
        if (message != null && !message.isEmpty()) {
            try {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(ClipData.newPlainText("iRopit", message));
                    Log.d(TAG, "Message copied to clipboard successfully");
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to copy to clipboard: " + e);
            }
        }
        finish();
    }
}
