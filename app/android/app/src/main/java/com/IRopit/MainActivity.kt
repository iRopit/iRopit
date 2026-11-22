package com.IRopit

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.BroadcastReceiver
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import androidx.activity.enableEdgeToEdge

class MainActivity : ReactActivity() {

  private val smsReceiver = SmsReceiver()
  private val callReceiver = CallReceiver()

  override fun onCreate(savedInstanceState: Bundle?) {
    // IMPORTANT: process the share intent BEFORE super.onCreate(...) so the
    // static pending fields (and SharedPreferences backup) are populated
    // before React Native bootstraps.  Some RN setups recycle / clear the
    // activity intent during super.onCreate, which previously caused the
    // SEND intent to be lost on cold launch.
    val launchIntent = intent
    if (launchIntent != null) {
      val act = launchIntent.action
      Log.d("MainActivity", "onCreate: action=$act, type=${launchIntent.type}")
      if (Intent.ACTION_SEND == act || Intent.ACTION_SEND_MULTIPLE == act) {
        ShareModule.processIntent(this, launchIntent)
      }
    }

    super.onCreate(savedInstanceState)
    
    enableEdgeToEdge() // Android 15 edge-to-edge compliance
    
    // Register receivers dynamically.
    // Use explicit flags on Android 13+ to avoid startup crashes on newer devices.
    val smsFilter = IntentFilter().apply {
      addAction("android.provider.Telephony.SMS_RECEIVED")
    }
    registerRuntimeReceiver(smsReceiver, smsFilter, "SMS")

    val callFilter = IntentFilter().apply {
      addAction("android.intent.action.PHONE_STATE")
      addAction("android.intent.action.NEW_OUTGOING_CALL")
    }
    registerRuntimeReceiver(callReceiver, callFilter, "Call")

    // Note: cold-start share intent is now handled BEFORE super.onCreate above.
  }

  override fun onDestroy() {
    super.onDestroy()
    try {
      unregisterReceiver(smsReceiver)
      unregisterReceiver(callReceiver)
      Log.d("MainActivity", "Receivers unregistered")
    } catch (e: Exception) {
      Log.e("MainActivity", "Error unregistering receivers", e)
    }
  }

  private fun registerRuntimeReceiver(
    receiver: BroadcastReceiver,
    filter: IntentFilter,
    receiverName: String
  ) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        registerReceiver(receiver, filter)
      }
      Log.d("MainActivity", "$receiverName receiver registered dynamically")
    } catch (e: Exception) {
      Log.e("MainActivity", "Failed to register $receiverName receiver", e)
    }
  }

  /** Handle new share intents while the app is already running (singleTask mode). */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    val act = intent.action
    Log.d("MainActivity", "onNewIntent: action=$act, type=${intent.type}")
    if (Intent.ACTION_SEND == act || Intent.ACTION_SEND_MULTIPLE == act) {
      ShareModule.processIntent(this, intent)
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "iRopit"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}

