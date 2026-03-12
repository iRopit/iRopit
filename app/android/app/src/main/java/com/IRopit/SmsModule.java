package com.IRopit;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;
import android.telephony.SmsManager;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.util.ArrayList;

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
            WritableArray smsList = Arguments.createArray();
            ContentResolver cr = reactContext.getContentResolver();
            // Read ALL SMS (inbox + sent) - type 1=inbox, 2=sent
            Cursor cursor = cr.query(
                Uri.parse("content://sms"),
                new String[]{"_id", "address", "body", "date", "read", "type"},
                "type IN (1, 2)",
                null,
                "date DESC"
            );

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
}
