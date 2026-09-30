package com.lafina

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * End-of-phase alerts for app timers such as the Pomodoro.
 *
 * Unlike reminder alarms, these never open the incoming-call screen: when a
 * phase ends while LAFINA is in the background, a plain high-priority
 * notification with the alarm sound is posted. While the app is in front its
 * own timer rings instead, so the receiver stays quiet.
 */
object LafinaTimerAlarms {
  const val ACTION_TIMER_ALARM = "com.lafina.ACTION_TIMER_ALARM"
  private const val EXTRA_ID = "timerId"
  private const val EXTRA_TITLE = "title"
  private const val EXTRA_BODY = "body"
  private const val CHANNEL_ID = "lafina_timers"
  private const val REQUEST_OFFSET = 0x71ae

  /** Set from the React host's lifecycle; true while the app is in front. */
  @Volatile var isHostResumed: Boolean = false

  fun schedule(context: Context, timerId: String, triggerAtMs: Long, title: String, body: String) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pendingIntent = alarmIntent(context, timerId, title, body, PendingIntent.FLAG_UPDATE_CURRENT)
        ?: return
    val canScheduleExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
    if (canScheduleExact) {
      alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
    } else {
      alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
    }
  }

  fun cancel(context: Context, timerId: String) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarmIntent(context, timerId, "", "", PendingIntent.FLAG_NO_CREATE)?.let {
      alarmManager.cancel(it)
      it.cancel()
    }
    NotificationManagerCompat.from(context).cancel(notificationId(timerId))
  }

  fun handle(context: Context, intent: Intent) {
    if (isHostResumed) return
    val timerId = intent.getStringExtra(EXTRA_ID) ?: return
    createChannel(context)
    val openApp = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      PendingIntent.getActivity(
          context,
          notificationId(timerId),
          it,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
        .setContentTitle(intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "Timer finished" })
        .setContentText(intent.getStringExtra(EXTRA_BODY).orEmpty())
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
        .setVibrate(longArrayOf(0, 600, 400, 600))
        .setAutoCancel(true)
        .apply { openApp?.let { setContentIntent(it) } }
        .build()
    try {
      NotificationManagerCompat.from(context).notify(notificationId(timerId), notification)
    } catch (_: SecurityException) {
      // Notifications are off; the timer still shows what was missed on return.
    }
  }

  private fun alarmIntent(
      context: Context,
      timerId: String,
      title: String,
      body: String,
      flag: Int
  ): PendingIntent? {
    val intent = Intent(context, LafinaTimerAlarmReceiver::class.java).apply {
      action = ACTION_TIMER_ALARM
      putExtra(EXTRA_ID, timerId)
      putExtra(EXTRA_TITLE, title)
      putExtra(EXTRA_BODY, body)
    }
    return PendingIntent.getBroadcast(
        context,
        notificationId(timerId),
        intent,
        flag or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun createChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val audioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    val channel = NotificationChannel(CHANNEL_ID, "LAFINA timers", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Pomodoro phases that finish while LAFINA is in the background"
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 600, 400, 600)
      setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), audioAttributes)
    }
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .createNotificationChannel(channel)
  }

  private fun notificationId(timerId: String): Int = timerId.hashCode() + REQUEST_OFFSET
}

class LafinaTimerAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == LafinaTimerAlarms.ACTION_TIMER_ALARM) {
      LafinaTimerAlarms.handle(context, intent)
    }
  }
}
