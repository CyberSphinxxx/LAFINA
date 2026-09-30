package com.lafina

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log

/**
 * Where Android's package installer reports on an update LAFINA handed it
 * (`LafinaUpdaterModule.installApk`). When it needs the person to confirm, it
 * sends its confirmation screen here to be shown; anything else is passed on
 * to JS as a `LafinaUpdaterInstallStatus` event. On success Android replaces
 * the app, which ends this process.
 */
class LafinaApkInstallReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    when (status) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        val confirm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra(Intent.EXTRA_INTENT)
        }
        if (confirm == null) {
          LafinaUpdaterModule.reportInstallStatus("failure", "Android did not show its install confirmation. Try again.")
          return
        }
        try {
          context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          LafinaUpdaterModule.reportInstallStatus("confirming", null)
        } catch (error: Exception) {
          Log.w(TAG, "Could not show the install confirmation", error)
          LafinaUpdaterModule.reportInstallStatus("failure", "Android could not show its install confirmation. Try again.")
        }
      }
      PackageInstaller.STATUS_SUCCESS -> LafinaUpdaterModule.reportInstallStatus("success", null)
      else -> {
        val detail = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        Log.w(TAG, "Install failed: $status $detail")
        LafinaUpdaterModule.reportInstallStatus(if (status == PackageInstaller.STATUS_FAILURE_ABORTED) "cancelled" else "failure", describe(status))
      }
    }
  }

  private fun describe(status: Int): String = when (status) {
    PackageInstaller.STATUS_FAILURE_ABORTED -> "The update was not installed."
    PackageInstaller.STATUS_FAILURE_BLOCKED -> "Android blocked installing the update."
    PackageInstaller.STATUS_FAILURE_CONFLICT ->
      "The update is signed differently from the installed app, so Android refused it. Install it from the release page instead."
    PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "This update does not work on this phone."
    PackageInstaller.STATUS_FAILURE_INVALID -> "The update file is not a valid app, so it was not installed."
    PackageInstaller.STATUS_FAILURE_STORAGE -> "There is not enough free space to install the update."
    else -> "The update could not be installed. Try again."
  }

  companion object {
    private const val TAG = "LafinaApkInstall"
  }
}
