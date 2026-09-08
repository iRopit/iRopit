package com.IRopit

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.io.FileOutputStream

@ReactModule(name = FilePickerModule.NAME)
class FilePickerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val NAME = "FilePickerModule"
        private const val PICK_FILE_REQUEST = 9001
        private const val PICK_IMAGE_REQUEST = 9002
        private const val TAG = "FilePickerModule"
    }

    private var pickerPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = NAME

    /**
     * Copy content:// URI to a local cache file and return file:// URI
     */
    private fun copyToCache(uri: Uri, fileName: String): String {
        val cacheDir = File(reactContext.cacheDir, "file_picker")
        if (!cacheDir.exists()) cacheDir.mkdirs()

        val destFile = File(cacheDir, "${System.currentTimeMillis()}_$fileName")

        reactContext.contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(destFile).use { output ->
                input.copyTo(output)
            }
        } ?: throw Exception("Could not open input stream for URI")

        return "file://${destFile.absolutePath}"
    }

    /**
     * Public method to copy any content:// URI to a local file:// URI
     * Used by JS when other pickers return content:// URIs
     */
    @ReactMethod
    fun copyToLocal(contentUri: String, fileName: String, promise: Promise) {
        try {
            val uri = Uri.parse(contentUri)
            val localUri = copyToCache(uri, fileName)
            promise.resolve(localUri)
        } catch (e: Exception) {
            Log.e(TAG, "copyToLocal failed", e)
            promise.reject("COPY_ERROR", "Failed to copy file: ${e.message}")
        }
    }

    @ReactMethod
    fun pickFile(promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            Log.w(TAG, "currentActivity is null")
            promise.reject("ACTIVITY_NULL", "No current activity available. Please try again.")
            return
        }

        pickerPromise = promise

        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivityForResult(intent, PICK_FILE_REQUEST)
        } catch (e: Exception) {
            pickerPromise = null
            promise.reject("PICKER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun pickImage(promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            Log.w(TAG, "currentActivity is null for image picker")
            promise.reject("ACTIVITY_NULL", "No current activity available. Please try again.")
            return
        }

        pickerPromise = promise

        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivityForResult(intent, PICK_IMAGE_REQUEST)
        } catch (e: Exception) {
            pickerPromise = null
            promise.reject("PICKER_ERROR", e.message)
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != PICK_FILE_REQUEST && requestCode != PICK_IMAGE_REQUEST) return

        val promise = pickerPromise ?: return
        pickerPromise = null

        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            promise.reject("CANCELLED", "User cancelled picker")
            return
        }

        val uri = data.data ?: run {
            promise.reject("PICKER_ERROR", "No URI returned from picker")
            return
        }

        try {
            val result = Arguments.createMap()

            // Get file name and size first
            var fileName = "document"
            val cursor: Cursor? = reactApplicationContext.contentResolver.query(uri, null, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val nameIndex = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIndex = it.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIndex >= 0) {
                        fileName = it.getString(nameIndex) ?: "document"
                        result.putString("name", fileName)
                    }
                    if (sizeIndex >= 0 && !it.isNull(sizeIndex)) {
                        result.putDouble("size", it.getLong(sizeIndex).toDouble())
                    }
                }
            }

            // Copy file to cache dir and return file:// URI
            val localUri = copyToCache(uri, fileName)
            result.putString("uri", localUri)

            // Get MIME type
            val mimeType = reactApplicationContext.contentResolver.getType(uri)
            result.putString("type", mimeType ?: "application/octet-stream")

            if (requestCode == PICK_IMAGE_REQUEST) {
                result.putString("fileType", "image")
            } else {
                result.putString("fileType", "file")
            }

            Log.d(TAG, "File picked: $fileName -> $localUri")
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error processing picked file", e)
            promise.reject("PROCESS_ERROR", "Failed to process file: ${e.message}")
        }
    }

    override fun onNewIntent(intent: Intent) {
        // Not needed
    }
}
