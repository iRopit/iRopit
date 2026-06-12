package com.IRopit;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CallLog.Calls;
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
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

public class CallLogModule extends ReactContextBaseJavaModule {
    private static final String TAG = "CallLogModule";
    private final ReactApplicationContext reactContext;
    private CallReceiver callReceiver;
    private boolean isReceiverRegistered = false;

    public CallLogModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        CallReceiver.setReactContext(reactContext);
    }

    @Override
    public String getName() {
        return "CallLogModule";
    }

    @ReactMethod
    public void getCallLog(int limit, Promise promise) {
        try {
            if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_CALL_LOG)
                    != PackageManager.PERMISSION_GRANTED) {
                promise.reject("PERMISSION_DENIED", "Call log permission not granted");
                return;
            }

            WritableArray callList = Arguments.createArray();
            ContentResolver cr = reactContext.getContentResolver();
            
            // Build phone account ID to SIM slot mapping
            Map<String, Integer> accountToSlot = new HashMap<>();
            try {
                if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_PHONE_STATE)
                        == PackageManager.PERMISSION_GRANTED) {
                    SubscriptionManager sm = (SubscriptionManager) reactContext.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                    if (sm != null) {
                        List<SubscriptionInfo> subs = sm.getActiveSubscriptionInfoList();
                        if (subs != null) {
                            for (SubscriptionInfo info : subs) {
                                String iccId = info.getIccId();
                                if (iccId != null) {
                                    accountToSlot.put(iccId, info.getSimSlotIndex());
                                }
                                // Also map subscription ID string
                                accountToSlot.put(String.valueOf(info.getSubscriptionId()), info.getSimSlotIndex());
                            }
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not read SIM slot info", e);
            }

            // Only include regular phone calls (exclude WhatsApp, Telegram, Viber, etc.).
            // Also require NUMBER != '' to exclude VoIP/Meet calls that are logged with
            // a NULL component name and empty phone number (e.g. Google Meet calls),
            // which would otherwise appear as "Unknown · VoIP" in the Chrome extension.
            String selection = "(" + Calls.PHONE_ACCOUNT_COMPONENT_NAME + " IS NULL OR " +
                    Calls.PHONE_ACCOUNT_COMPONENT_NAME + " LIKE ? OR " +
                    Calls.PHONE_ACCOUNT_COMPONENT_NAME + " LIKE ?) AND " +
                    Calls.NUMBER + " IS NOT NULL AND " + Calls.NUMBER + " != ''";
            String[] selectionArgs = new String[]{"%telephony%", "%com.android.phone%"};

            Cursor cursor = cr.query(
                Calls.CONTENT_URI,
                new String[]{
                    Calls._ID,
                    Calls.NUMBER,
                    Calls.CACHED_NAME,
                    Calls.TYPE,
                    Calls.DATE,
                    Calls.DURATION,
                    Calls.PHONE_ACCOUNT_ID
                },
                selection,
                selectionArgs,
                Calls.DATE + " DESC"
            );

            int count = 0;
            if (cursor != null && cursor.moveToFirst()) {
                do {
                    if (count >= limit) break;
                    
                    WritableMap call = Arguments.createMap();
                    call.putString("id", cursor.getString(0));
                    call.putString("phoneNumber", cursor.getString(1));
                    call.putString("contactName", cursor.getString(2));
                    
                    int type = cursor.getInt(3);
                    String callType;
                    switch (type) {
                        case Calls.INCOMING_TYPE:
                            callType = "incoming";
                            break;
                        case Calls.OUTGOING_TYPE:
                            callType = "outgoing";
                            break;
                        case Calls.MISSED_TYPE:
                            callType = "missed";
                            break;
                        case Calls.REJECTED_TYPE:
                            callType = "rejected";
                            break;
                        default:
                            callType = "unknown";
                    }
                    call.putString("type", callType);
                    call.putDouble("timestamp", cursor.getLong(4));
                    call.putInt("duration", cursor.getInt(5));

                    // Resolve SIM slot from PHONE_ACCOUNT_ID
                    String phoneAccountId = cursor.getString(6);
                    int simSlot = -1;
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
                                SubscriptionManager sm = (SubscriptionManager) reactContext.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                                if (sm != null) {
                                    // Try parsing phoneAccountId parts as subscription ID
                                    for (String part : phoneAccountId.split("[^0-9]")) {
                                        if (!part.isEmpty()) {
                                            try {
                                                int subId = Integer.parseInt(part);
                                                int idx = sm.getSlotIndex(subId);
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
                    call.putInt("simSlot", simSlot);
                    
                    callList.pushMap(call);
                    count++;
                } while (cursor.moveToNext());
                cursor.close();
            }

            Log.d(TAG, "Loaded " + callList.size() + " calls from device");
            promise.resolve(callList);
        } catch (Exception e) {
            Log.e(TAG, "Error getting call log", e);
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void startListening(Promise promise) {
        try {
            if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_PHONE_STATE)
                    != PackageManager.PERMISSION_GRANTED) {
                promise.reject("PERMISSION_DENIED", "Phone state permission not granted");
                return;
            }

            if (!isReceiverRegistered) {
                callReceiver = new CallReceiver();
                IntentFilter intentFilter = new IntentFilter();
                intentFilter.addAction(TelephonyManager.ACTION_PHONE_STATE_CHANGED);
                intentFilter.addAction("android.intent.action.NEW_OUTGOING_CALL");
                reactContext.registerReceiver(callReceiver, intentFilter);
                isReceiverRegistered = true;
            }

            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", "Failed to start call listener: " + e.getMessage());
        }
    }

    @ReactMethod
    public void stopListening(Promise promise) {
        try {
            if (isReceiverRegistered && callReceiver != null) {
                reactContext.unregisterReceiver(callReceiver);
                isReceiverRegistered = false;
                callReceiver = null;
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", "Failed to stop call listener: " + e.getMessage());
        }
    }

    @ReactMethod
    public void getSimCountryIso(Promise promise) {
        try {
            TelephonyManager tm = (TelephonyManager) reactContext.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm != null) {
                String iso = tm.getSimCountryIso();
                if (iso != null && !iso.isEmpty()) {
                    promise.resolve(iso.toUpperCase());
                    return;
                }
                // Fallback to network country
                String networkIso = tm.getNetworkCountryIso();
                if (networkIso != null && !networkIso.isEmpty()) {
                    promise.resolve(networkIso.toUpperCase());
                    return;
                }
            }
            promise.resolve("");
        } catch (Exception e) {
            promise.resolve("");
        }
    }

    @ReactMethod
    public void addListener(String eventName) {
        // Required for NativeEventEmitter
    }

    @ReactMethod
    public void removeListeners(int count) {
        // Required for NativeEventEmitter
    }
}

