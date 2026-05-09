package com.IRopit;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.BatteryManager;
import android.util.Log;

/**
 * Receives system battery change broadcasts and updates the device's battery
 * level in Firestore even when the app is in the background or closed.
 *
 * Registered in AndroidManifest.xml for:
 *   - android.intent.action.BATTERY_CHANGED  (fires on every % change)
 *   - android.intent.action.BATTERY_LOW
 *   - android.intent.action.BATTERY_OKAY
 *   - android.intent.action.ACTION_POWER_CONNECTED
 *   - android.intent.action.ACTION_POWER_DISCONNECTED
 */
public class BatteryReceiver extends BroadcastReceiver {
    private static final String TAG = "BatteryReceiver";

    // Throttle: only write to Firestore if level changed by >= 1% or charging state changed
    private static int lastReportedLevel = -1;
    private static boolean lastReportedCharging = false;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        if (action == null) return;

        FirebaseHelper helper = FirebaseHelper.getInstance(context);
        if (!helper.isLoggedIn()) return;

        int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        int status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);

        if (level < 0 || scale <= 0) return;

        int percent = (int) Math.round((level * 100.0) / scale);
        boolean isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING
                || status == BatteryManager.BATTERY_STATUS_FULL;

        // Skip if nothing meaningful changed (avoid hammering Firestore)
        if (percent == lastReportedLevel && isCharging == lastReportedCharging) {
            return;
        }

        Log.d(TAG, "Battery update: " + percent + "% charging=" + isCharging + " action=" + action);
        lastReportedLevel = percent;
        lastReportedCharging = isCharging;

        helper.updateBatteryLevel(percent, isCharging);
    }
}
