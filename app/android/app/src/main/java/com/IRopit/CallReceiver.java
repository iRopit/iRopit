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
import android.provider.CallLog;
import android.provider.ContactsContract;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

public class CallReceiver extends BroadcastReceiver {
    private static final String TAG = "CallReceiver";
    private static ReactApplicationContext reactContext;
    private static String lastState = "";
    private static String lastNumber = "";
    private static long callStartTime = 0;
    private static long callAnswerTime = 0; // time call was actually answered (OFFHOOK)
    private static boolean isIncoming = false;
    private static boolean callEventSent = false;
    private static boolean callWasAnswered = false;

    public static void setReactContext(ReactApplicationContext context) {
        reactContext = context;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        Log.d(TAG, "onReceive: " + action);

        if (TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(action)) {
            String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
            String phoneNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
            Log.d(TAG, "Phone state: " + state + ", number from intent: " + phoneNumber);

            // Always save the phone number if we get it
            if (phoneNumber != null && !phoneNumber.isEmpty()) {
                lastNumber = phoneNumber;
                Log.d(TAG, "Saved lastNumber: " + lastNumber);
            }

            if (state != null && !state.equals(lastState)) {
                handleStateChange(context, state, phoneNumber);
                lastState = state;
            }
        } else if ("android.intent.action.NEW_OUTGOING_CALL".equals(action)) {
            String phoneNumber = intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER);
            Log.d(TAG, "Outgoing call to: " + phoneNumber);
            if (phoneNumber != null) {
                lastNumber = phoneNumber;
                isIncoming = false;
                callWasAnswered = false;
                callStartTime = System.currentTimeMillis();
                callEventSent = false;
            }
        }
    }

    private void handleStateChange(Context context, String state, String phoneNumber) {
        Log.d(TAG, "handleStateChange: " + state + ", number: " + phoneNumber + ", lastNumber: " + lastNumber);

        if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)) {
            // Incoming call ringing
            isIncoming = true;
            callEventSent = false;
            callWasAnswered = false;
            callStartTime = System.currentTimeMillis();

            // Send ringing event if we have a number
            if (lastNumber != null && !lastNumber.isEmpty()) {
                String contactName = getContactName(context, lastNumber);
                sendEvent("onCallReceived", createCallMap(lastNumber, contactName, "incoming", "ringing", 0));
            }
            
        } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
            // Call answered or outgoing call started
            callWasAnswered = true;
            callAnswerTime = System.currentTimeMillis(); // record exact answer time for duration
            // For outgoing calls on Android 10+, NEW_OUTGOING_CALL is not fired,
            // so callStartTime may still be 0 here. Set it now if needed.
            if (!isIncoming && callStartTime == 0) {
                callStartTime = callAnswerTime;
                Log.d(TAG, "Outgoing call started (OFFHOOK), setting callStartTime: " + callStartTime);
            }
            String contactName = getContactName(context, lastNumber);
            if (isIncoming) {
                sendEvent("onCallReceived", createCallMap(lastNumber, contactName, "incoming", "answered", 0));
            } else if (!callEventSent) {
                sendEvent("onCallReceived", createCallMap(lastNumber, contactName, "outgoing", "started", 0));
                callEventSent = true;
            }

        } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
            // Call ended
            if (callStartTime > 0) {
                // Wait for call log to update, then fetch the last call
                final String savedNumber = lastNumber;
                final boolean wasIncoming = isIncoming;
                final long savedStartTime = callStartTime;
                final long savedAnswerTime = callAnswerTime;
                final boolean wasAnswered = callWasAnswered;
                
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    fetchLastCallAndSendEvent(context, savedNumber, wasIncoming, wasAnswered, savedStartTime, savedAnswerTime);
                }, 4000); // 4 seconds - Samsung and some devices need extra time to update call log
            }
            
            // Reset state
            callStartTime = 0;
            callAnswerTime = 0;
            lastNumber = "";
            isIncoming = false;
            callEventSent = false;
            callWasAnswered = false;
        }
    }

    private void fetchLastCallAndSendEvent(Context context, String savedNumber, boolean wasIncoming, boolean wasAnswered, long savedStartTime, long savedAnswerTime) {
        String number = (savedNumber != null && !savedNumber.isEmpty()) ? savedNumber : "";
        String name = "";
        // If incoming and never answered, it's a missed call
        String type = wasIncoming ? (wasAnswered ? "incoming" : "missed") : "outgoing";
        // Duration fallback: measure from answer time (OFFHOOK), not dial/ring time.
        // This avoids including dialing/ringing time in the talk duration.
        long durationBase = (savedAnswerTime > 0) ? savedAnswerTime : savedStartTime;
        int duration = (wasAnswered && durationBase > 0) ? (int) ((System.currentTimeMillis() - durationBase) / 1000) : 0;
        long callDate = savedStartTime; // Will be overridden by call log date if available
        boolean gotCallLogData = false;
        int simSlot = -1;

        // Build phone account ID to SIM slot mapping
        Map<String, Integer> accountToSlot = new HashMap<>();
        try {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE)
                    == PackageManager.PERMISSION_GRANTED) {
                SubscriptionManager sm = (SubscriptionManager) context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                if (sm != null) {
                    List<SubscriptionInfo> subs = sm.getActiveSubscriptionInfoList();
                    if (subs != null) {
                        for (SubscriptionInfo info : subs) {
                            String iccId = info.getIccId();
                            if (iccId != null) {
                                accountToSlot.put(iccId, info.getSimSlotIndex());
                            }
                            accountToSlot.put(String.valueOf(info.getSubscriptionId()), info.getSimSlotIndex());
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not read SIM slot info", e);
        }
        
        try {
            // Check permission
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) 
                    == PackageManager.PERMISSION_GRANTED) {
                
                ContentResolver resolver = context.getContentResolver();
                // Query without LIMIT in sortOrder - use separate limit parameter
                Cursor cursor = resolver.query(
                    CallLog.Calls.CONTENT_URI,
                    new String[]{
                        CallLog.Calls.NUMBER,
                        CallLog.Calls.CACHED_NAME,
                        CallLog.Calls.TYPE,
                        CallLog.Calls.DURATION,
                        CallLog.Calls.DATE,
                        CallLog.Calls.PHONE_ACCOUNT_ID
                    },
                    null,
                    null,
                    CallLog.Calls.DATE + " DESC"
                );

                if (cursor != null) {
                    try {
                        if (cursor.moveToFirst()) {
                            String logNumber = cursor.getString(0);
                            String logName = cursor.getString(1);
                            int logType = cursor.getInt(2);
                            int logDuration = cursor.getInt(3);
                            long logDate = cursor.getLong(4);

                            // Resolve SIM slot from PHONE_ACCOUNT_ID
                            String phoneAccountId = cursor.getString(5);
                            if (phoneAccountId != null && !phoneAccountId.isEmpty()) {
                                Integer slot = accountToSlot.get(phoneAccountId);
                                // Fallback: try last token after ';' (e.g. "com.android.phone;2" -> "2")
                                if (slot == null && phoneAccountId.contains(";")) {
                                    String suffix = phoneAccountId.substring(phoneAccountId.lastIndexOf(';') + 1);
                                    slot = accountToSlot.get(suffix);
                                }
                                // Fallback: try all split tokens
                                if (slot == null) {
                                    for (String part : phoneAccountId.split("[^a-zA-Z0-9]")) {
                                        if (!part.isEmpty()) {
                                            slot = accountToSlot.get(part);
                                            if (slot != null) break;
                                        }
                                    }
                                }
                                if (slot != null) {
                                    simSlot = slot;
                                }
                            }

                            Log.d(TAG, "=== CALL LOG DATA ===");
                            Log.d(TAG, "logNumber: '" + logNumber + "' (null? " + (logNumber == null) + ", empty? " + (logNumber != null && logNumber.isEmpty()) + ")");
                            Log.d(TAG, "logName: '" + logName + "'");
                            Log.d(TAG, "logType: " + logType + ", logDuration: " + logDuration + ", simSlot: " + simSlot);
                            Log.d(TAG, "savedNumber was: '" + savedNumber + "'");
                            Log.d(TAG, "current number is: '" + number + "'");

                            // Use call log data if the entry date is close to when we started tracking
                            // (logDate is the call START time, so compare against savedStartTime not currentTime)
                            // Allow up to 30s before savedStartTime (device clock drift) or any time after.
                            //
                            // Safety check: if the call was never answered (wasAnswered=false) but the log
                            // shows a completed incoming/outgoing call with non-zero duration, that entry
                            // belongs to a PREVIOUS call that ended just before ours started. Reject it.
                            boolean callLogIsConsistent = wasAnswered || logDuration == 0 ||
                                    (logType != CallLog.Calls.INCOMING_TYPE && logType != CallLog.Calls.OUTGOING_TYPE);
                            if (!callLogIsConsistent) {
                                Log.w(TAG, "⚠️ Call log inconsistency: wasAnswered=false but logType=" + logType +
                                        ", logDuration=" + logDuration + ". Previous call entry — ignoring call log.");
                            }
                            if (logDate >= savedStartTime - 30000 && callLogIsConsistent) {
                                gotCallLogData = true;
                                // Always use number from call log as it's more reliable
                                if (logNumber != null && !logNumber.isEmpty()) {
                                    number = logNumber;
                                    Log.d(TAG, "✅ Using number from call log: " + number);
                                } else {
                                    Log.w(TAG, "⚠️ Call log number is empty/null, keeping: " + number);
                                }
                                if (logName != null && !logName.isEmpty()) {
                                    name = logName;
                                    Log.d(TAG, "✅ Using name from call log: " + name);
                                }
                                duration = logDuration;
                                callDate = logDate; // Use actual call date from call log
                                
                                switch (logType) {
                                    case CallLog.Calls.INCOMING_TYPE:
                                        type = "incoming";
                                        break;
                                    case CallLog.Calls.OUTGOING_TYPE:
                                        type = "outgoing";
                                        break;
                                    case CallLog.Calls.MISSED_TYPE:
                                        type = "missed";
                                        break;
                                    case CallLog.Calls.REJECTED_TYPE:
                                        type = "rejected";
                                        break;
                                }
                                Log.d(TAG, "✅ Got call log data: type=" + type + ", duration=" + duration + ", date=" + logDate);
                            } else {
                                Log.w(TAG, "Call log entry too old (" + (System.currentTimeMillis() - logDate) + "ms), ignoring");
                            }
                        }
                    } finally {
                        cursor.close();
                    }
                }
            } else {
                Log.w(TAG, "READ_CALL_LOG permission not granted");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error fetching call log", e);
        }
        
        // Final check - if number is still empty, log warning
        if (number == null || number.isEmpty()) {
            Log.w(TAG, "WARNING: Phone number is empty! savedNumber=" + savedNumber);
            number = "Unknown";
        }
        
        // If still no name, try to get from contacts
        if ((name == null || name.isEmpty()) && number != null && !number.isEmpty() && !number.equals("Unknown")) {
            name = getContactName(context, number);
        }
        
        // If call log data wasn't available, use the wasAnswered flag as ground truth
        if (!gotCallLogData) {
            if (wasIncoming && !wasAnswered) {
                type = "missed";
                duration = 0;
                Log.d(TAG, "No call log data + call not answered → marking as missed");
            } else if (wasIncoming && wasAnswered) {
                // Duration fallback: time from ring start to IDLE is an overestimate;
                // clamp to a safe value until call log is available on next sync
                Log.d(TAG, "No call log data, incoming answered call duration estimate: " + duration);
            }
        }

        Log.d(TAG, "Final call data: number=" + number + ", name=" + name + ", type=" + type + ", duration=" + duration + ", date=" + callDate + ", simSlot=" + simSlot);

        WritableMap callMap = createCallMap(number, name, type, "ended", duration, callDate);
        callMap.putInt("simSlot", simSlot);
        sendEvent("onCallReceived", callMap);
        
        // Also save directly to Firebase for when app is in background
        // This ensures calls are captured even without an active React instance
        try {
            FirebaseHelper firebaseHelper = FirebaseHelper.getInstance(context);
            if (firebaseHelper != null && firebaseHelper.isLoggedIn()) {
                firebaseHelper.sendCallToFirestore(number, name, type, callDate, duration, simSlot);
                Log.d(TAG, "✅ Call saved to Firebase directly: " + number + " (" + type + ", SIM" + simSlot + ")");
            } else {
                Log.w(TAG, "Cannot save call to Firebase: user not logged in");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error saving call to Firebase", e);
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
                String withoutPlus = cleanNumber.substring(1);
                
                // Try removing common country codes
                String[] prefixes = {"971", "966", "965", "974", "973", "968", "20", "1", "44", "91"};
                for (String prefix : prefixes) {
                    if (withoutPlus.startsWith(prefix)) {
                        String localNumber = withoutPlus.substring(prefix.length());
                        // Add leading 0 for local format
                        name = lookupContactByPhone(resolver, "0" + localNumber);
                        if (name != null && !name.isEmpty()) {
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

    private WritableMap createCallMap(String phoneNumber, String contactName, String type, String status, int duration) {
        return createCallMap(phoneNumber, contactName, type, status, duration, System.currentTimeMillis());
    }

    private WritableMap createCallMap(String phoneNumber, String contactName, String type, String status, int duration, long timestamp) {
        WritableMap map = Arguments.createMap();
        map.putString("id", String.valueOf(timestamp));
        map.putString("phoneNumber", phoneNumber != null && !phoneNumber.isEmpty() ? phoneNumber : "Unknown");
        map.putString("contactName", contactName != null ? contactName : "");
        map.putString("type", type);
        map.putString("status", status);
        map.putDouble("timestamp", (double) timestamp);
        map.putInt("duration", duration);

        Log.d(TAG, "createCallMap: phone=" + phoneNumber + ", contact=" + contactName + ", type=" + type + ", status=" + status + ", timestamp=" + timestamp);
        return map;
    }

    private void sendEvent(String eventName, WritableMap params) {
        if (reactContext != null && reactContext.hasActiveReactInstance()) {
            Log.d(TAG, "Sending event: " + eventName);
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(eventName, params);
        } else {
            Log.w(TAG, "Cannot send event, no active React instance");
        }
    }
}

