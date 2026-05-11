package com.IRopit;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

@ReactModule(name = ShareModule.NAME)
public class ShareModule extends ReactContextBaseJavaModule implements LifecycleEventListener {

    public static final String NAME = "IropitShareModule";
    private static final String TAG = "IropitShareModule";
    private static final String EVENT_SHARE = "SharedDataReceived";
    private static final String PREFS = "iropit_share_prefs";
    private static final String KEY_HAS = "has_pending";
    private static final String KEY_MIME = "mime";
    private static final String KEY_TEXT = "text";
    private static final String KEY_SUBJECT = "subject";
    private static final String KEY_URI = "uri";
    private static final String KEY_URIS = "uris"; // JSON-ish: joined by '\n'

    private static String pendingMimeType = null;
    private static String pendingText = null;
    private static String pendingSubject = null;
    private static String pendingUri = null;
    private static List<String> pendingUris = null;
    private static boolean hasPending = false;

    private static ShareModule instance = null;

    private final ReactApplicationContext reactContext;

    public ShareModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        instance = this;
        // Register lifecycle listener so tryEmitPending() is called when the
        // React activity resumes — this covers cold-start where processIntent
        // was called in onCreate() before the bridge was ready.
        reactContext.addLifecycleEventListener(this);
        // If processIntent ran before us (or in a prior process), pick up any
        // persisted share now so the static fields are populated by the time
        // JS polls getSharedData().
        hydrateFromPrefsIfNeeded(reactContext);

    }

    @Override
    public void onHostResume() {
        if (!hasPending) return;
        // Delay the emit so JS has time to mount and register its
        // DeviceEventEmitter listener before we fire the event.
        // We use multiple retries to handle slow bridge init on cold start.
        scheduleEmit(300);
        scheduleEmit(800);
        scheduleEmit(1500);
        scheduleEmit(2500);
    }

    private void scheduleEmit(long delayMs) {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (hasPending) tryEmitPending();
        }, delayMs);
    }

    @Override
    public void onHostPause() {}

    @Override
    public void onHostDestroy() {
        reactContext.removeLifecycleEventListener(this);
    }

    @Override
    public String getName() {
        return NAME;
    }

    private static String copyUriToCache(Context context, Uri uri) {
        try {
            File cacheDir = new File(context.getCacheDir(), "share_cache");
            if (!cacheDir.exists()) cacheDir.mkdirs();

            String rawName = uri.getLastPathSegment();
            if (rawName != null) {
                int slashIdx = rawName.lastIndexOf('/');
                if (slashIdx >= 0) rawName = rawName.substring(slashIdx + 1);
                rawName = rawName.replaceAll("[^a-zA-Z0-9._\\-]", "_");
                if (rawName.isEmpty()) rawName = null;
            }
            if (rawName == null) {
                rawName = "shared_" + System.currentTimeMillis();
            }

            File destFile = new File(cacheDir, System.currentTimeMillis() + "_" + rawName);

            InputStream input = context.getContentResolver().openInputStream(uri);
            if (input == null) return null;

            OutputStream output = new FileOutputStream(destFile);
            byte[] buffer = new byte[8192];
            int len;
            while ((len = input.read(buffer)) != -1) {
                output.write(buffer, 0, len);
            }
            output.close();
            input.close();

            return "file://" + destFile.getAbsolutePath();
        } catch (Exception e) {
            Log.e(TAG, "copyUriToCache failed for " + uri, e);
            return null;
        }
    }

    public static void processIntent(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();
        if (action == null || type == null) return;
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;

        Log.d(TAG, "processIntent: action=" + action + ", type=" + type +
                ", hasStream=" + intent.hasExtra(Intent.EXTRA_STREAM));

        pendingMimeType = type;
        pendingText = null;
        pendingSubject = null;
        pendingUri = null;
        pendingUris = null;
        hasPending = true;

        if (type.startsWith("text/")) {
            pendingText = intent.getStringExtra(Intent.EXTRA_TEXT);
            pendingSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        }

        if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> uriList = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (uriList != null) {
                List<String> localUris = new ArrayList<>();
                for (Uri uri : uriList) {
                    String cached = copyUriToCache(context, uri);
                    localUris.add(cached != null ? cached : uri.toString());
                }
                pendingUris = localUris;
                pendingUri = localUris.isEmpty() ? null : localUris.get(0);
            }
        } else {
            Uri uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            } else {
                uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            }
            if (uri != null) {
                String localUri = copyUriToCache(context, uri);
                if (localUri == null) localUri = uri.toString();
                pendingUri = localUri;
                List<String> list = new ArrayList<>();
                list.add(localUri);
                pendingUris = list;
            }
        }

        if (instance != null) {
            instance.tryEmitPending();
        }

        // Persist as backup so cold-start race never loses the share data.
        try {
            SharedPreferences prefs = context.getApplicationContext()
                    .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            SharedPreferences.Editor e = prefs.edit();
            e.putBoolean(KEY_HAS, true);
            e.putString(KEY_MIME, pendingMimeType);
            e.putString(KEY_TEXT, pendingText);
            e.putString(KEY_SUBJECT, pendingSubject);
            e.putString(KEY_URI, pendingUri);
            if (pendingUris != null) {
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < pendingUris.size(); i++) {
                    if (i > 0) sb.append('\n');
                    sb.append(pendingUris.get(i));
                }
                e.putString(KEY_URIS, sb.toString());
            } else {
                e.remove(KEY_URIS);
            }
            e.apply();
            Log.d(TAG, "processIntent: persisted pending share to SharedPreferences");
        } catch (Exception ex) {
            Log.e(TAG, "processIntent: failed to persist", ex);
        }
    }

    private static void hydrateFromPrefsIfNeeded(Context context) {
        if (hasPending) return;
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getApplicationContext()
                    .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!prefs.getBoolean(KEY_HAS, false)) return;
            pendingMimeType = prefs.getString(KEY_MIME, null);
            pendingText = prefs.getString(KEY_TEXT, null);
            pendingSubject = prefs.getString(KEY_SUBJECT, null);
            pendingUri = prefs.getString(KEY_URI, null);
            String urisStr = prefs.getString(KEY_URIS, null);
            if (urisStr != null && !urisStr.isEmpty()) {
                String[] parts = urisStr.split("\\n");
                List<String> list = new ArrayList<>();
                for (String p : parts) if (p != null && !p.isEmpty()) list.add(p);
                pendingUris = list;
            }
            hasPending = (pendingMimeType != null)
                    && (pendingText != null || pendingUri != null
                        || (pendingUris != null && !pendingUris.isEmpty()));
            Log.d(TAG, "hydrateFromPrefs: restored hasPending=" + hasPending +
                    " mime=" + pendingMimeType + " uri=" + pendingUri);
        } catch (Exception ex) {
            Log.e(TAG, "hydrateFromPrefs failed", ex);
        }
    }

    private static void clearPersisted(Context context) {
        if (context == null) return;
        try {
            context.getApplicationContext()
                    .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().clear().apply();
        } catch (Exception ex) {
            Log.e(TAG, "clearPersisted failed", ex);
        }
    }

    private void tryEmitPending() {
        // Restore from SharedPreferences if static state was wiped (e.g. process death).
        hydrateFromPrefsIfNeeded(reactContext);
        if (!hasPending) return;
        if (!reactContext.hasActiveReactInstance()) {
            Log.d(TAG, "tryEmitPending: no active React instance, keeping pending");
            return;
        }
        WritableMap map = buildWritableMap();
        if (map == null) return;

        Log.d(TAG, "tryEmitPending: emitting SharedDataReceived event, mimeType=" +
                pendingMimeType + ", uri=" + pendingUri +
                ", uriCount=" + (pendingUris != null ? pendingUris.size() : 0));
        try {
            reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(EVENT_SHARE, map);
            Log.d(TAG, "tryEmitPending: emit call succeeded");
            // DO NOT clearPending() here — the data must survive in case the JS
            // DeviceEventEmitter listener wasn't registered yet (cold-start race).
            // getSharedData() is the single authoritative drain that clears it.
        } catch (Exception e) {
            Log.e(TAG, "tryEmitPending: emit FAILED", e);
        }
    }

    private WritableMap buildWritableMap() {
        if (!hasPending) return null;
        WritableMap map = Arguments.createMap();
        if (pendingMimeType != null) map.putString("mimeType", pendingMimeType);
        if (pendingText != null) map.putString("text", pendingText);
        if (pendingSubject != null) map.putString("subject", pendingSubject);
        if (pendingUri != null) map.putString("uri", pendingUri);
        if (pendingUris != null) {
            WritableArray arr = Arguments.createArray();
            for (String u : pendingUris) {
                arr.pushString(u);
            }
            map.putArray("uris", arr);
        }
        return map;
    }

    private static void clearPending() {
        hasPending = false;
        pendingMimeType = null;
        pendingText = null;
        pendingSubject = null;
        pendingUri = null;
        pendingUris = null;
    }

    @ReactMethod
    public void getSharedData(Promise promise) {
        // Recover from SharedPreferences when static state was lost between
        // process death and JS bridge ready.
        hydrateFromPrefsIfNeeded(reactContext);
        Log.d(TAG, "getSharedData called, hasPending=" + hasPending);
        if (!hasPending) {
            promise.resolve(null);
            return;
        }
        WritableMap map = buildWritableMap();
        clearPending();
        clearPersisted(reactContext);
        promise.resolve(map);
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
