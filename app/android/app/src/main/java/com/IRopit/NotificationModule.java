package com.IRopit;

import android.content.ComponentName;
import android.content.Intent;
import android.provider.Settings;
import android.text.TextUtils;
import android.os.PowerManager;
import android.net.Uri;
import android.os.Build;
import android.content.Context;
import android.app.NotificationManager;
import android.app.NotificationChannel;
import android.service.notification.NotificationListenerService;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.module.annotations.ReactModule;

@ReactModule(name = NotificationModule.NAME)
public class NotificationModule extends ReactContextBaseJavaModule {
    public static final String NAME = "NotificationModule";
    private final ReactApplicationContext reactContext;

    public NotificationModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void isPermissionGranted(Promise promise) {
        try {
            String packageName = reactContext.getPackageName();
            String flat = Settings.Secure.getString(
                reactContext.getContentResolver(),
                "enabled_notification_listeners"
            );

            if (flat != null && !TextUtils.isEmpty(flat)) {
                String[] names = flat.split(":");
                for (String name : names) {
                    ComponentName cn = ComponentName.unflattenFromString(name);
                    if (cn != null && cn.getPackageName().equals(packageName)) {
                        promise.resolve(true);
                        return;
                    }
                }
            }
            promise.resolve(false);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void openSettings(Promise promise) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void isServiceConnected(Promise promise) {
        // Only return true if service instance actually exists and is connected
        // Don't use permission check as fallback - MIUI can have permission but block the service
        boolean isConnected = NotificationService.isConnected();
        
        // If not connected but permission is granted, try to request rebind
        if (!isConnected) {
            try {
                String packageName = reactContext.getPackageName();
                String flat = Settings.Secure.getString(
                    reactContext.getContentResolver(),
                    "enabled_notification_listeners"
                );

                if (flat != null && !TextUtils.isEmpty(flat)) {
                    String[] names = flat.split(":");
                    for (String name : names) {
                        ComponentName cn = ComponentName.unflattenFromString(name);
                        if (cn != null && cn.getPackageName().equals(packageName)) {
                            // Permission granted but not connected - try rebind
                            try {
                                ComponentName componentName = new ComponentName(
                                    reactContext.getPackageName(),
                                    NotificationService.class.getName()
                                );
                                NotificationListenerService.requestRebind(componentName);
                            } catch (Exception ignored) {}
                            break;
                        }
                    }
                }
            } catch (Exception ignored) {}
        }
        
        promise.resolve(isConnected);
    }

    /**
     * Open MIUI AutoStart settings to allow the app to start automatically
     * This is required for NotificationListenerService to work on MIUI devices
     */
    @ReactMethod
    public void openAutoStartSettings(Promise promise) {
        try {
            Intent intent = new Intent();
            String manufacturer = android.os.Build.MANUFACTURER.toLowerCase();
            
            if (manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco")) {
                // MIUI AutoStart settings
                intent.setComponent(new ComponentName("com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"));
            } else if (manufacturer.contains("oppo")) {
                // OPPO AutoStart settings
                intent.setComponent(new ComponentName("com.coloros.safecenter",
                    "com.coloros.safecenter.permission.startup.StartupAppListActivity"));
            } else if (manufacturer.contains("vivo")) {
                // Vivo AutoStart settings
                intent.setComponent(new ComponentName("com.vivo.permissionmanager",
                    "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"));
            } else if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
                // Huawei AutoStart settings
                intent.setComponent(new ComponentName("com.huawei.systemmanager",
                    "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
            } else if (manufacturer.contains("samsung")) {
                // Samsung doesn't have traditional AutoStart, open battery settings
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(android.net.Uri.parse("package:" + reactContext.getPackageName()));
            } else {
                // Fallback to app settings
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(android.net.Uri.parse("package:" + reactContext.getPackageName()));
            }
            
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            // Fallback to app settings if specific settings not found
            try {
                Intent fallbackIntent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallbackIntent.setData(android.net.Uri.parse("package:" + reactContext.getPackageName()));
                fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(fallbackIntent);
                promise.resolve(true);
            } catch (Exception e2) {
                promise.reject("ERROR", e2.getMessage());
            }
        }
    }

    /**
     * Open battery optimization settings to disable battery optimization for the app
     */
    @ReactMethod
    public void openBatterySettings(Promise promise) {
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            // Fallback to general battery settings
            try {
                Intent fallbackIntent = new Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS);
                fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(fallbackIntent);
                promise.resolve(true);
            } catch (Exception e2) {
                promise.reject("ERROR", e2.getMessage());
            }
        }
    }

    /**
     * Check if battery optimization is disabled for this app
     */
    @ReactMethod
    public void isBatteryOptimized(Promise promise) {
        try {
            PowerManager pm = (PowerManager) reactContext.getSystemService(Context.POWER_SERVICE);
            boolean isIgnoring = pm.isIgnoringBatteryOptimizations(reactContext.getPackageName());
            promise.resolve(!isIgnoring); // true = optimized (bad), false = exempt (good)
        } catch (Exception e) {
            promise.resolve(true);
        }
    }

    /**
     * Request battery optimization exemption directly (shows system dialog)
     */
    @ReactMethod
    public void requestBatteryExemption(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) reactContext.getSystemService(Context.POWER_SERVICE);
                if (!pm.isIgnoringBatteryOptimizations(reactContext.getPackageName())) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + reactContext.getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    reactContext.startActivity(intent);
                    promise.resolve(true);
                } else {
                    promise.resolve(false); // Already exempt
                }
            } else {
                promise.resolve(false);
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Check if the device is a Chinese ROM (MIUI, ColorOS, etc.) that blocks background services
     */
    @ReactMethod
    public void isMiuiDevice(Promise promise) {
        String manufacturer = android.os.Build.MANUFACTURER.toLowerCase();
        boolean isMiui = manufacturer.contains("xiaomi") || 
                         manufacturer.contains("redmi") || 
                         manufacturer.contains("poco") ||
                         manufacturer.contains("oppo") ||
                         manufacturer.contains("vivo") ||
                         manufacturer.contains("huawei") ||
                         manufacturer.contains("honor");
        promise.resolve(isMiui);
    }

    /**
     * Check if app notifications are enabled (user hasn't muted them in system settings)
     */
    @ReactMethod
    public void areNotificationsEnabled(Promise promise) {
        try {
            NotificationManager nm = (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            promise.resolve(nm.areNotificationsEnabled());
        } catch (Exception e) {
            promise.resolve(true);
        }
    }

    /**
     * Get list of muted/blocked notification channel names
     * Returns comma-separated Arabic names of blocked channels
     */
    @ReactMethod
    public void getMutedChannels(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
                StringBuilder muted = new StringBuilder();
                String[][] channels = {
                    {"iropit_sms", "\u0627\u0644\u0631\u0633\u0627\u0626\u0644"},
                    {"iropit_calls", "\u0627\u0644\u0645\u0643\u0627\u0644\u0645\u0627\u062a"},
                    {"iropit_chat", "\u0627\u0644\u0645\u062d\u0627\u062f\u062b\u0627\u062a"}
                };
                for (String[] ch : channels) {
                    NotificationChannel channel = nm.getNotificationChannel(ch[0]);
                    if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) {
                        if (muted.length() > 0) muted.append(",");
                        muted.append(ch[1]);
                    }
                }
                promise.resolve(muted.toString());
            } else {
                promise.resolve("");
            }
        } catch (Exception e) {
            promise.resolve("");
        }
    }

    /**
     * Open the app's notification settings page directly
     */
    @ReactMethod
    public void openAppNotificationSettings(Promise promise) {
        try {
            Intent intent = new Intent();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, reactContext.getPackageName());
            } else {
                intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + reactContext.getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }
}

