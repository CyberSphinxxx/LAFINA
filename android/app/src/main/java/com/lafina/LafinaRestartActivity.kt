package com.lafina

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Process

/**
 * Runs in its own `:restart` process (see AndroidManifest.xml). It ends the
 * app's main process, opens LAFINA again — which starts a downloaded update —
 * and then ends itself. Nothing is drawn.
 */
class LafinaRestartActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val mainPid = intent.getIntExtra(EXTRA_PID, -1)
    if (mainPid > 0 && mainPid != Process.myPid()) Process.killProcess(mainPid)

    packageManager.getLaunchIntentForPackage(packageName)?.component?.let { component ->
      startActivity(Intent.makeRestartActivityTask(component))
    }
    finish()
    Runtime.getRuntime().exit(0)
  }

  companion object {
    const val EXTRA_PID = "com.lafina.restart.PID"
    const val PROCESS_SUFFIX = ":restart"
  }
}
