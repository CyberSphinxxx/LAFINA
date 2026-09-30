package com.lafina

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(LafinaVoicePackage())
        },
      // A downloaded update, when there is one that fits this APK; otherwise
      // the bundle inside the APK. See OtaBundles.
      jsBundleFilePath = OtaBundles.resolveBundlePath(applicationContext),
    )
  }

  override fun onCreate() {
    super.onCreate()
    // The restart helper's process only relaunches the app; it never runs React Native.
    if (getProcessName().endsWith(LafinaRestartActivity.PROCESS_SUFFIX)) return
    loadReactNative(this)
  }
}
