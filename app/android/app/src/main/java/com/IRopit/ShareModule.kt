package com.IRopit

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream

@ReactModule(name = ShareModule.NAME)
class ShareModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "ShareModule"
        private const val TAG = "ShareModule"
        private const val EVENT_SHARE = "SharedDataReceived"

        private var pendingMimeType: String? = null
        private var pendingText: String? = null
        private var pendingSubject: String? = null
        private var pendingUri: String? = null
        private var pendingUris: List<String>? = null
        private var hasPending = false

        private var instance: ShareModule? = null

        private fun copyUriToCache(context: Context, uri: Uri): String? {
            return try {
                val cacheDir = File(context.cacheDir, "share_cache")
                if (!cacheDir.exists()) cacheDir.mkdirs()
                val rawName = uri.lastPathSegment
                    ?.substringAfterLast('/')
                    ?.replace(Regex("[^a-zA-Z0-9._-]"), "_")
                    ?.takeIf { it.isNotBlank() }
                    ?: "shared_${System.currentTimeMillis()}"
                val destFile = File(cacheDir, "${System.currentTimeMillis()}_$rawName")
                context.contentResolver.openInputStream(uri)?.use { input ->
                    FileOutputStream(destFile).use { output -> input.copyTo(output) }
                } ?: return null
                "file://${destFile.absolutePath}"
            } catch (e: Exception) {
                Log.e(TAG, "copyUriToCache failed for $uri", e)
                null
            }
        }

        fun processIntent(context: Context, intent: Intent?) {
            val action = intent?.action ?: return
            val type = intent.type ?: return
            if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return

            Log.d(TAG, "processIntent: action=$action, type=$type")

            pendingMimeType = type
            pendingText = null
            pendingSubject = null
            pendingUri = null
            pendingUris = null
            hasPending = true

            if (type.startsWith("text/")) {
                pendingText = intent.getStringExtra(Intent.EXTRA_TEXT)
                pendingSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
            }

            if (action == Intent.ACTION_SEND_MULTIPLE) {
                @Suppress("DEPRECATION")
                val uriList = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                if (uriList != null) {
                    val localUris = uriList.map { uri ->
                        copyUriToCache(context, uri) ?: uri.toString()
                    }
                    pendingUris = localUris
                    pendingUri = localUris.firstOrNull()
                }
            } else {
                val uri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
                if (uri != null) {
                    val localUri = copyUriToCache(context, uri) ?: uri.toString()
                    pendingUri = localUri
                    pendingUris = listOf(localUri)
                }
            }

            instance?.tryEmitPending()
        }
    }

    init {
        instance = this
    }

    override fun getName(): String = NAME

    private fun tryEmitPending() {
        if (!hasPending) return
        if (!reactContext.hasActiveReactInstance()) return
        val map = buildWritableMap() ?: return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT_SHARE, map)
        clearPending()
    }

    private fun buildWritableMap(): WritableMap? {
        if (!hasPending) return null
        val map = Arguments.createMap()
        pendingMimeType?.let { map.putString("mimeType", it) }
        pendingText?.let { map.putString("text", it) }
        pendingSubject?.let { map.putString("subject", it) }
        pendingUri?.let { map.putString("uri", it) }
        val uriList = pendingUris
        if (uriList != null) {
            val arr = Arguments.createArray()
            uriList.forEach { arr.pushString(it) }
            map.putArray("uris", arr)
        }
        return map
    }

    private fun clearPending() {
        hasPending = false
        pendingMimeType = null
        pendingText = null
        pendingSubject = null
        pendingUri = null
        pendingUris = null
    }

    @ReactMethod
    fun getSharedData(promise: Promise) {
        if (!hasPending) {
            promise.resolve(null)
            return
        }
        val map = buildWritableMap()
        clearPending()
        promise.resolve(map)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
