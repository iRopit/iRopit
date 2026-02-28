package com.IRopit

import android.content.Context
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

