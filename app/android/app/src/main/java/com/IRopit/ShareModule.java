package com.IRopit;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
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

    public static final String NAME = "ShareModule";
    private static final String TAG = "ShareModule";
    private static final String EVENT_SHARE = "SharedDataReceived";

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
    }

    @Override
    public void onHostResume() {
        // Activity came to foreground — React instance should be active now.
        // Attempt to emit any pending share data that arrived during cold start.
        tryEmitPending();
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
    }

    private void tryEmitPending() {
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
        Log.d(TAG, "getSharedData called, hasPending=" + hasPending);
        if (!hasPending) {
            promise.resolve(null);
            return;
        }
        WritableMap map = buildWritableMap();
        clearPending();
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
