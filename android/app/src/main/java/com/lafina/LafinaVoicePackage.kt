package com.lafina

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LafinaVoicePackage : ReactPackage {

  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(
      LafinaSpeechToTextModule(reactContext),
      LafinaIntentExtractorModule(reactContext),
      LafinaTTSModule(reactContext),
      LafinaReminderModule(reactContext),
      LafinaMeetingRecorderModule(reactContext),
      AndroidKeystoreModule(reactContext),
      AndroidConnectivityModule(reactContext),
      LafinaUpdaterModule(reactContext),
      LafinaGrainientModule(reactContext),
      LafinaThemeRevealModule(reactContext)
    )
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return listOf(LafinaGrainientViewManager())
  }
}
