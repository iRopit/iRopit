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
    private static String lastRingingNumber = ""; // last number we wrote ringing_call for
    // True when `lastNumber` was just set by a fresh NEW_OUTGOING_CALL broadcast
    // (i.e., it represents the current dial, not a residue from a previous call).
    // Older Androids (<=9) fire NEW_OUTGOING_CALL with the dialed number; we can
    // trust it as the real number when this flag is set.
    private static boolean lastNumberFromBroadcast = false;
    // Pending call-log lookup runnable (OFFHOOK → delayed). Stored so we can
    // cancel it in IDLE if the call ends before the 1800 ms delay fires.
    private static android.os.Handler outgoingLookupHandler = null;
    private static Runnable outgoingLookupRunnable = null;

    // ── Active outgoing-call state ───────────────────────────────────────────────
    // These fields are set in OFFHOOK (outgoing) and cleared in IDLE. The
    // NotificationService consults them when a dialer notification arrives so it
    // can fill in the dialed number on devices where CallLog is not populated
    // during an active call.
    private static volatile boolean outgoingCallActive = false;
    static boolean isOutgoingCallActive() { return outgoingCallActive; }
    private static volatile boolean outgoingDocWritten = false;
    private static volatile long outgoingBaselineCallLogId = -1L;
    private static volatile long outgoingOffhookTime = 0L;
    private static volatile String outgoingLastNumberAtOffhook = "";
    private static volatile String outgoingLastStateAtOffhook = "";

    /**
     * Called by {@link NotificationService} when a dialer-app notification carries
     * a phone number. If there is an active outgoing call that hasn't yet had its
     * Firestore doc written with a real number, we write it now.
     *
     * @param context any context (we use applicationContext)
     * @param number  the phone number extracted from the dialer notification
     */
    public static void onDialerNotificationNumber(Context context, String number) {
        if (number == null || number.isEmpty()) return;
        if (!outgoingCallActive || outgoingDocWritten) return;
        writeOutgoingNow(context.getApplicationContext(), number, "dialer-notification");
    }

    /** Single point of truth for writing outgoing_call/current with a real number. */
    private static synchronized void writeOutgoingNow(Context appCtx, String number, String source) {
        if (number == null || number.isEmpty()) return;
        if (outgoingDocWritten) return; // write once per call
        try {
            FirebaseHelper fb = FirebaseHelper.getInstance(appCtx);
            if (fb == null || !fb.isLoggedIn()) {
                Log.w(TAG, "Cannot write outgoing_call: user not logged in (source=" + source + ")");
                return;
            }
            outgoingDocWritten = true;
            lastNumber = number;
            String cn = "";
            try { cn = staticGetContactName(appCtx, number); } catch (Exception ignore) {}
            Map<String, Object> dbg = new HashMap<>();
            dbg.put("source", source);
            dbg.put("lastNumberAtOffhook", outgoingLastNumberAtOffhook);
            dbg.put("lastStateAtOffhook", outgoingLastStateAtOffhook);
            dbg.put("baselineCallLogId", outgoingBaselineCallLogId);
            dbg.put("offhookTime", outgoingOffhookTime);
            dbg.put("matchedNumber", number);
            dbg.put("appVersion", "1.1.7");
            fb.writeOutgoingCall(number, cn, -1, dbg);
            Log.d(TAG, "✅ outgoing_call written (" + source + ") number=" + number);
        } catch (Exception e) {
            Log.e(TAG, "Error in writeOutgoingNow", e);
        }
    }

    /** Static-friendly contact name lookup (delegates to the instance helper). */
    private static String staticGetContactName(Context context, String phoneNumber) {
        if (phoneNumber == null || phoneNumber.isEmpty()) return "";
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS)
                != PackageManager.PERMISSION_GRANTED) return "";
        Cursor cursor = null;
        try {
            Uri uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phoneNumber));
            cursor = context.getContentResolver().query(uri,
                new String[] { ContactsContract.PhoneLookup.DISPLAY_NAME },
                null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (Exception e) {
            Log.w(TAG, "staticGetContactName failed: " + e.getMessage());
        } finally {
            if (cursor != null) try { cursor.close(); } catch (Exception ignore) {}
        }
        return "";
    }

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
            } else if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)
                    && phoneNumber != null && !phoneNumber.isEmpty()
                    && !phoneNumber.equals(lastRingingNumber)) {
                // Same RINGING state but a DIFFERENT phone number — this happens
                // for call-waiting or when the OS re-broadcasts RINGING without an
                // intervening IDLE. Without this branch the new caller would be
                // silently dropped because `state.equals(lastState)`.
                Log.d(TAG, "RINGING re-broadcast with new number — forcing re-handle: " + phoneNumber);
                handleStateChange(context, state, phoneNumber);
            }
        } else if ("android.intent.action.NEW_OUTGOING_CALL".equals(action)) {
            String phoneNumber = intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER);
            Log.d(TAG, "Outgoing call to: " + phoneNumber);
            if (phoneNumber != null) {
                lastNumber = phoneNumber;
                lastNumberFromBroadcast = true; // trusted: came from system broadcast for THIS dial
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

            // On Android 10+, lastNumber may be empty (EXTRA_INCOMING_NUMBER is null
            // for non-default-dialer apps). Still write ringing_call so the Chrome
            // extension shows "Unknown" — better than nothing.
            String ringNumber = (lastNumber != null && !lastNumber.isEmpty()) ? lastNumber : "";
            String ringContact = "";
            if (!ringNumber.isEmpty()) {
                ringContact = getContactName(context, ringNumber);
                sendEvent("onCallReceived", createCallMap(ringNumber, ringContact, "incoming", "ringing", 0));
            } else {
                Log.w(TAG, "RINGING with empty number (Android 10+ privacy) — writing ringing_call with Unknown");
            }

            // Write ringing_call directly to Firestore (works even when app is in background)
            try {
                FirebaseHelper fbHelper = FirebaseHelper.getInstance(context);
                if (fbHelper != null && fbHelper.isLoggedIn()) {
                    fbHelper.writeRingingCall(ringNumber, ringContact, -1);
                    lastRingingNumber = ringNumber;
                    Log.d(TAG, "✅ ringing_call written to Firestore — number=" + ringNumber);
                } else {
                    Log.w(TAG, "Cannot write ringing_call: user not logged in");
                }
            } catch (Exception e) {
                Log.e(TAG, "Error writing ringing_call", e);
            }
            
        } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
            // Call answered or outgoing call started — clear the ringing popup
            try {
                FirebaseHelper fbHelper = FirebaseHelper.getInstance(context);
                if (fbHelper != null && fbHelper.isLoggedIn()) {
                    fbHelper.clearRingingCall();
                }
            } catch (Exception e) {
                Log.e(TAG, "Error clearing ringing_call on OFFHOOK", e);
            }

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

                // Write outgoing_call sentinel natively so the Chrome extension popup
                // works even when the React Native JS thread is not running
                // (app killed / backgrounded). Mirrors writeRingingCall pattern.
                //
                // STRATEGY (v1.1.2.21): NEVER write an empty outgoing_call doc — that
                // makes the popup open showing "Unknown". Only write once we have a
                // real phone number. Sources (in priority order):
                //   1) Fresh NEW_OUTGOING_CALL broadcast (older Androids ≤9).
                //   2) Immediate CallLog query (delay=0) — works on many devices.
                //   3) Retried CallLog queries at 150/300/600/1200/2400/4000 ms.
                //   4) Dialer-app ongoing notification (via NotificationService) —
                //      the ONLY reliable source on Android 10+ where CallLog only
                //      populates after IDLE. Requires Notification Access permission.
                // Any source that fires first wins (guarded by outgoingDocWritten).
                final Context appCtx = context.getApplicationContext();
                final long callOffhookTime = System.currentTimeMillis();
                final String lastNumberAtOffhook = lastNumber == null ? "" : lastNumber;
                final String lastStateAtOffhook = lastState == null ? "" : lastState;
                final boolean numberFromBroadcast = lastNumberFromBroadcast;
                // Capture call-log baseline NOW so it represents pre-dial state.
                final long baselineCallLogId = queryMaxCallLogId(appCtx);

                // Publish shared state so NotificationService can also write.
                outgoingCallActive = true;
                outgoingDocWritten = false;
                outgoingBaselineCallLogId = baselineCallLogId;
                outgoingOffhookTime = callOffhookTime;
                outgoingLastNumberAtOffhook = lastNumberAtOffhook;
                outgoingLastStateAtOffhook = lastStateAtOffhook;

                Log.d(TAG, "Outgoing lookup baseline _ID=" + baselineCallLogId
                        + " lastNumberAtOffhook='" + lastNumberAtOffhook
                        + "' fromBroadcast=" + numberFromBroadcast);

                // Consume the broadcast freshness flag so a subsequent OFFHOOK without
                // a new NEW_OUTGOING_CALL won't mistakenly trust the leftover.
                lastNumberFromBroadcast = false;

                // 1) Trust fresh NEW_OUTGOING_CALL broadcast (older Android dialers).
                if (numberFromBroadcast && !lastNumberAtOffhook.isEmpty()) {
                    writeOutgoingNow(appCtx, lastNumberAtOffhook, "new-outgoing-broadcast");
                }

                // 2) Immediate CallLog lookup.
                if (!outgoingDocWritten) {
                    String dialedNow = queryLatestOutgoingNumberAfterId(appCtx, baselineCallLogId);
                    if (dialedNow != null && !dialedNow.isEmpty()) {
                        writeOutgoingNow(appCtx, dialedNow, "immediate-lookup");
                    }
                }

                // 3) Schedule CallLog retries. Stops as soon as outgoingDocWritten is true
                //    (which can happen via the dialer-notification path too).
                if (outgoingLookupHandler != null && outgoingLookupRunnable != null) {
                    outgoingLookupHandler.removeCallbacks(outgoingLookupRunnable);
                }
                if (!outgoingDocWritten) {
                    outgoingLookupHandler = new android.os.Handler(android.os.Looper.getMainLooper());
                    final int[] attempt = { 0 };
                    final long[] delays = { 150, 300, 600, 1200, 2400, 4000 };
                    outgoingLookupRunnable = new Runnable() {
                        @Override
                        public void run() {
                            try {
                                if (outgoingDocWritten || !outgoingCallActive) {
                                    outgoingLookupRunnable = null;
                                    outgoingLookupHandler = null;
                                    return;
                                }
                                String dialed = queryLatestOutgoingNumberAfterId(appCtx, baselineCallLogId);
                                if (dialed != null && !dialed.isEmpty()) {
                                    writeOutgoingNow(appCtx, dialed,
                                            "delayed-lookup-attempt-" + (attempt[0] + 1));
                                    outgoingLookupRunnable = null;
                                    outgoingLookupHandler = null;
                                    return;
                                }
                                attempt[0]++;
                                if (attempt[0] < delays.length && outgoingLookupHandler != null) {
                                    Log.d(TAG, "Outgoing lookup attempt " + attempt[0]
                                            + " — no new OUTGOING row yet (baseline=" + baselineCallLogId
                                            + "), retrying in " + delays[attempt[0]] + "ms");
                                    outgoingLookupHandler.postDelayed(this, delays[attempt[0]]);
                                } else {
                                    Log.w(TAG, "Could not resolve dialed number from call log after "
                                            + attempt[0] + " attempts (baseline=" + baselineCallLogId
                                            + ") — relying on dialer notification (if any)");
                                    outgoingLookupRunnable = null;
                                    outgoingLookupHandler = null;
                                }
                            } catch (Exception e) {
                                Log.e(TAG, "Error in delayed outgoing_call lookup", e);
                                outgoingLookupRunnable = null;
                                outgoingLookupHandler = null;
                            }
                        }
                    };
                    outgoingLookupHandler.postDelayed(outgoingLookupRunnable, delays[0]);
                }
            }

        } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
            // Cancel any pending call-log lookup so it can't re-write outgoing_call
            // after clearOutgoingCall() has already removed the doc (this would make
            // the extension pop up a stale popup on the *next* call).
            if (outgoingLookupHandler != null && outgoingLookupRunnable != null) {
                outgoingLookupHandler.removeCallbacks(outgoingLookupRunnable);
                outgoingLookupRunnable = null;
                outgoingLookupHandler = null;
                Log.d(TAG, "Cancelled pending outgoing_call lookup (call ended before delay)");
            }
            // Call ended — clear the ringing popup (covers missed/rejected calls too)
            try {
                FirebaseHelper fbHelper = FirebaseHelper.getInstance(context);
                if (fbHelper != null && fbHelper.isLoggedIn()) {
                    fbHelper.clearRingingCall();
                    fbHelper.clearOutgoingCall();
                }
            } catch (Exception e) {
                Log.e(TAG, "Error clearing ringing_call on IDLE", e);
            }

            if (callStartTime > 0) {
                // Wait for call log to update, then fetch the last call
                final String savedNumber = lastNumber;
                final boolean wasIncoming = isIncoming;
                final long savedStartTime = callStartTime;
                final long savedAnswerTime = callAnswerTime;
                final boolean wasAnswered = callWasAnswered;

                // Adaptive call-log polling: write to Firestore as soon as the
                // call-log row is available instead of a flat blind wait. Fast
                // devices surface the call in ~700ms; slow ones (Samsung) still
                // retry up to ~4.3s. Replaces the old fixed 4000ms delay that
                // made every call appear slowly in the extension Calls screen.
                final android.os.Handler clHandler =
                        new android.os.Handler(android.os.Looper.getMainLooper());
                final long[] clDelays = { 700, 900, 1200, 1500 }; // attempts at ~700/1600/2800/4300ms
                final int[] clAttempt = { 0 };
                final Runnable clRunnable = new Runnable() {
                    @Override
                    public void run() {
                        boolean ok = fetchLastCallAndSendEvent(
                                context, savedNumber, wasIncoming, wasAnswered,
                                savedStartTime, savedAnswerTime);
                        if (ok) {
                            Log.d(TAG, "✅ Call log captured on attempt " + (clAttempt[0] + 1));
                            return;
                        }
                        clAttempt[0]++;
                        if (clAttempt[0] < clDelays.length) {
                            clHandler.postDelayed(this, clDelays[clAttempt[0]]);
                        } else {
                            Log.w(TAG, "Call log not available after retries — periodic sync will pick it up");
                        }
                    }
                };
                clHandler.postDelayed(clRunnable, clDelays[0]);
            }
            
            // Reset state
            callStartTime = 0;
            callAnswerTime = 0;
            lastNumber = "";
            lastNumberFromBroadcast = false;
            isIncoming = false;
            callEventSent = false;
            callWasAnswered = false;
            lastRingingNumber = "";
            // Clear shared outgoing-call state used by NotificationService.
            outgoingCallActive = false;
            outgoingDocWritten = false;
            outgoingBaselineCallLogId = -1L;
            outgoingOffhookTime = 0L;
            outgoingLastNumberAtOffhook = "";
            outgoingLastStateAtOffhook = "";
        }
    }

    private boolean fetchLastCallAndSendEvent(Context context, String savedNumber, boolean wasIncoming, boolean wasAnswered, long savedStartTime, long savedAnswerTime) {
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
                // Only include regular phone calls (exclude WhatsApp, Telegram, Viber, etc.)
                String selection = CallLog.Calls.PHONE_ACCOUNT_COMPONENT_NAME + " IS NULL OR " +
                        CallLog.Calls.PHONE_ACCOUNT_COMPONENT_NAME + " LIKE ? OR " +
                        CallLog.Calls.PHONE_ACCOUNT_COMPONENT_NAME + " LIKE ?";
                String[] selectionArgs = new String[]{"%telephony%", "%com.android.phone%"};
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
                    selection,
                    selectionArgs,
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
                                // Fallback: try getSlotIndex() on API 29+ (works on Android 16 without extra permissions)
                                if (slot == null && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                                    try {
                                        SubscriptionManager sm2 = (SubscriptionManager) context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                                        if (sm2 != null) {
                                            for (String part : phoneAccountId.split("[^0-9]")) {
                                                if (!part.isEmpty()) {
                                                    try {
                                                        int subId = Integer.parseInt(part);
                                                        int idx = sm2.getSlotIndex(subId);
                                                        if (idx >= 0) { slot = idx; break; }
                                                    } catch (NumberFormatException ignored) {}
                                                }
                                            }
                                        }
                                    } catch (Exception ignored) {}
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

        Log.d(TAG, "Final call data: number=" + number + ", name=" + name + ", type=" + type + ", duration=" + duration + ", date=" + callDate + ", simSlot=" + simSlot + ", gotCallLogData=" + gotCallLogData);

        // Only save/emit if we have verified call log data.
        // Without call log verification the entry may be a phantom caused by
        // telephony state broadcasts during app install/restart.
        // The periodic sync from CallLogModule will pick up any calls that
        // were missed here.
        if (!gotCallLogData) {
            Log.w(TAG, "⚠️ No matching call log entry found — skipping Firebase save to avoid phantom entry");
            return false;
        }

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
        return true;
    }

    /**
     * Query the most recent OUTGOING entry from CallLog and return its phone number,
     * if it was placed at-or-after {@code sinceMillis}. Used on Android 10+ where
     * NEW_OUTGOING_CALL is no longer broadcast to non-default-dialer apps, so we
     * can't capture the dialed number at OFFHOOK time.
     */
    /** Return the highest CallLog._ID currently in the call log, or -1 if unreadable. */
    private long queryMaxCallLogId(Context context) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG)
                != PackageManager.PERMISSION_GRANTED) {
            return -1L;
        }
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                CallLog.Calls.CONTENT_URI,
                new String[] { CallLog.Calls._ID },
                null, null,
                CallLog.Calls._ID + " DESC LIMIT 1"
            );
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getLong(0);
            }
        } catch (Exception e) {
            Log.e(TAG, "queryMaxCallLogId error", e);
        } finally {
            if (cursor != null) try { cursor.close(); } catch (Exception ignore) {}
        }
        return -1L;
    }

    /**
     * Return the most recent OUTGOING CallLog entry's phone number whose _ID is strictly
     * greater than {@code sinceId}. This guarantees we only match rows that appeared
     * AFTER the current call's OFFHOOK — making stale rows from previous calls impossible
     * to return, regardless of their DURATION or DATE.
     */
    private String queryLatestOutgoingNumberAfterId(Context context, long sinceId) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG)
                != PackageManager.PERMISSION_GRANTED) {
            return "";
        }
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                CallLog.Calls.CONTENT_URI,
                new String[] { CallLog.Calls.NUMBER, CallLog.Calls._ID },
                CallLog.Calls.TYPE + " = ? AND " + CallLog.Calls._ID + " > ?",
                new String[] { String.valueOf(CallLog.Calls.OUTGOING_TYPE), String.valueOf(sinceId) },
                CallLog.Calls._ID + " DESC LIMIT 1"
            );
            if (cursor != null && cursor.moveToFirst()) {
                String num = cursor.getString(0);
                long newId = cursor.getLong(1);
                Log.d(TAG, "queryLatestOutgoingNumberAfterId matched _ID=" + newId + " number=" + num);
                return num != null ? num : "";
            }
        } catch (Exception e) {
            Log.e(TAG, "queryLatestOutgoingNumber error", e);
        } finally {
            if (cursor != null) try { cursor.close(); } catch (Exception ignore) {}
        }
        return "";
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

