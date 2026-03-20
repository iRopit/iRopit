package com.IRopit;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;
import android.telephony.SmsManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class SmsModule extends ReactContextBaseJavaModule {
    private static final String TAG = "SmsModule";
    private final ReactApplicationContext reactContext;

    public SmsModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        
        // Set the context for SmsReceiver so it can emit events
        SmsReceiver.setReactContext(reactContext);
        Log.d(TAG, "SmsModule initialized, context set for SmsReceiver");
    }

    @Override
    public String getName() {
        return "SmsModule";
    }

    @ReactMethod
    public void getAllSms(int limit, Promise promise) {
        try {
            // Resolve subscriptionId -> slotIndex
            // On Android 16+ getActiveSubscriptionInfoList() is blocked (READ_PHONE_NUMBERS).
            // Use getSlotIndex(subId) on API 29+ as a lightweight alternative.
            SubscriptionManager subscriptionManager = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                subscriptionManager = (SubscriptionManager) reactContext.getSystemService(reactContext.TELEPHONY_SUBSCRIPTION_SERVICE);
            }

            WritableArray smsList = Arguments.createArray();
            ContentResolver cr = reactContext.getContentResolver();
            
            // Android 16+ strips subscription_id from the restricted SMS view.
            // Try subscription_id first, fall back to sub_id, then query without it.
            String[] baseColumns = new String[]{"_id", "address", "body", "date", "read", "type"};
            String[] colsWithSubId = new String[]{"_id", "address", "body", "date", "read", "type", "subscription_id"};
            String[] colsWithSub = new String[]{"_id", "address", "body", "date", "read", "type", "sub_id"};
            
            Cursor cursor = null;
            try {
                cursor = cr.query(Uri.parse("content://sms"), colsWithSubId, "type IN (1, 2)", null, "date DESC");
            } catch (Exception e1) {
                Log.w(TAG, "subscription_id column not available, trying sub_id");
                try {
                    cursor = cr.query(Uri.parse("content://sms"), colsWithSub, "type IN (1, 2)", null, "date DESC");
                } catch (Exception e2) {
                    Log.w(TAG, "sub_id column not available, querying without subscription column");
                    cursor = cr.query(Uri.parse("content://sms"), baseColumns, "type IN (1, 2)", null, "date DESC");
                }
            }

            int count = 0;
            if (cursor != null && cursor.moveToFirst()) {
                do {
                    if (count >= limit) break;

                    WritableMap sms = Arguments.createMap();
                    sms.putString("id", cursor.getString(0));
                    sms.putString("address", cursor.getString(1));
                    sms.putString("body", cursor.getString(2));
                    sms.putDouble("date", cursor.getLong(3));
                    sms.putBoolean("read", cursor.getInt(4) == 1);
                    int smsType = cursor.getInt(5);
                    sms.putString("direction", smsType == 2 ? "outgoing" : "incoming");
                    sms.putString("smsType", smsType == 2 ? "sent" : "inbox");

                    // Resolve SIM slot — try subscription_id first, then sub_id
                    int simSlot = -1;
                    try {
                        int colIdx = cursor.getColumnIndex("subscription_id");
                        if (colIdx < 0) colIdx = cursor.getColumnIndex("sub_id");
                        if (colIdx >= 0) {
                            int subId = cursor.getInt(colIdx);
                            simSlot = resolveSimSlot(subscriptionManager, subId);
                        }
                    } catch (Exception e) { /* ignore */ }
                    sms.putInt("simSlot", simSlot);

                    smsList.pushMap(sms);
                    count++;
                } while (cursor.moveToNext());
                cursor.close();
            }

            Log.d(TAG, "Loaded " + smsList.size() + " SMS from device (inbox + sent)");
            promise.resolve(smsList);
        } catch (Exception e) {
            Log.e(TAG, "Error getting SMS", e);
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void sendSms(String phoneNumber, String message, Promise promise) {
        try {
            SmsManager smsManager = SmsManager.getDefault();
            ArrayList<String> parts = smsManager.divideMessage(message);
            smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
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

    @ReactMethod
    public void getContactName(String phoneNumber, Promise promise) {
        try {
            String contactName = null;
            Uri uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phoneNumber)
            );
            
            Cursor cursor = reactContext.getContentResolver().query(
                uri,
                new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME},
                null, null, null
            );
            
            if (cursor != null) {
                if (cursor.moveToFirst()) {
                    contactName = cursor.getString(0);
                }
                cursor.close();
            }
            
            promise.resolve(contactName);
        } catch (Exception e) {
            promise.resolve(null);
        }
    }

    @ReactMethod
    public void startSmsRequestService(Promise promise) {
        try {
            Intent intent = new Intent(reactContext, SmsRequestService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent);
            } else {
                reactContext.startService(intent);
            }
            Log.d(TAG, "SmsRequestService started");

            // Also start CallRequestService
            Intent callIntent = new Intent(reactContext, CallRequestService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(callIntent);
            } else {
                reactContext.startService(callIntent);
            }
            Log.d(TAG, "CallRequestService started");

            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start SmsRequestService: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void stopSmsRequestService(Promise promise) {
        try {
            Intent intent = new Intent(reactContext, SmsRequestService.class);
            reactContext.stopService(intent);
            Intent callIntent = new Intent(reactContext, CallRequestService.class);
            reactContext.stopService(callIntent);
            Log.d(TAG, "SmsRequestService stopped");
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Resolve SIM slot index from a subscription ID.
     * On API 29+ uses getSlotIndex() which doesn't require READ_PHONE_NUMBERS.
     * Falls back to getActiveSubscriptionInfo() on older APIs.
     */
    private int resolveSimSlot(SubscriptionManager sm, int subId) {
        if (sm == null || subId < 0) return -1;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                return sm.getSlotIndex(subId);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1 &&
                    ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_PHONE_STATE)
                            == PackageManager.PERMISSION_GRANTED) {
                SubscriptionInfo info = sm.getActiveSubscriptionInfo(subId);
                if (info != null) return info.getSimSlotIndex();
            }
        } catch (Exception e) {
            Log.w(TAG, "resolveSimSlot failed for subId " + subId + ": " + e.getMessage());
        }
        return -1;
    }
}
