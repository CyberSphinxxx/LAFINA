package com.lafina

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class LafinaReminderService : Service() {

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action != ACTION_START_ACTIVE_CALL) {
      stopSelf()
      return START_NOT_STICKY
    }

    val task = intent.getStringExtra(EXTRA_TASK).orEmpty()
    val notification = createNotification(task)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    acquireWakeLock()
    return START_NOT_STICKY
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val serviceChannel = NotificationChannel(
        CHANNEL_ID,
        "LAFINA active reminder calls",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Keeps an answered offline reminder call active"
        setSound(null, null)
        enableVibration(false)
      }
      val manager = getSystemService(NotificationManager::class.java)
      manager?.createNotificationChannel(serviceChannel)
    }
  }

  private fun createNotification(task: String): Notification {
    val resumeIntent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val resumePendingIntent = PendingIntent.getActivity(
      this,
      ACTIVE_CALL_REQUEST_CODE,
      resumeIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("LAFINA reminder call active")
      .setContentText(task.ifBlank { "Listening for your offline response" })
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(Notification.CATEGORY_CALL)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setContentIntent(resumePendingIntent)
      .build()
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "lafina:active-reminder-call"
    ).apply {
      setReferenceCounted(false)
      acquire(MAX_WAKE_LOCK_MS)
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { lock ->
      if (lock.isHeld) lock.release()
    }
    wakeLock = null
  }

  override fun onDestroy() {
    releaseWakeLock()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    const val ACTION_START_ACTIVE_CALL = "com.lafina.START_ACTIVE_REMINDER_CALL"
    const val EXTRA_TASK = "task"
    private const val CHANNEL_ID = "lafina_active_call_channel"
    private const val NOTIFICATION_ID = 1002
    private const val ACTIVE_CALL_REQUEST_CODE = 1002
    private const val MAX_WAKE_LOCK_MS = 10 * 60 * 1000L
  }
}
