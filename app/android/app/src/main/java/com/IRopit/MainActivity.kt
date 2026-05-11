package com.IRopit

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

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
    
    // Register SMS receiver dynamically
    val smsFilter = IntentFilter()
    smsFilter.addAction("android.provider.Telephony.SMS_RECEIVED")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      registerReceiver(smsReceiver, smsFilter, Context.RECEIVER_EXPORTED)
    } else {
      registerReceiver(smsReceiver, smsFilter)
    }
    Log.d("MainActivity", "SMS Receiver registered dynamically")
    
    // Register Call receiver dynamically  
    val callFilter = IntentFilter()
    callFilter.addAction("android.intent.action.PHONE_STATE")
    callFilter.addAction("android.intent.action.NEW_OUTGOING_CALL")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      registerReceiver(callReceiver, callFilter, Context.RECEIVER_EXPORTED)
    } else {
      registerReceiver(callReceiver, callFilter)
    }
    Log.d("MainActivity", "Call Receiver registered dynamically")

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

