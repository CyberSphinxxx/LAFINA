package com.lafina

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

class LafinaReminderModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener, LifecycleEventListener {

  private var activeRingtone: Ringtone? = null

  init {
    reactContext.addActivityEventListener(this)
    reactContext.addLifecycleEventListener(this)
  }

  // Timer alarms stay quiet while the app is in front; its own timer rings.
  override fun onHostResume() {
    LafinaTimerAlarms.isHostResumed = true
  }

  override fun onHostPause() {
    LafinaTimerAlarms.isHostResumed = false
  }

  override fun onHostDestroy() {
    LafinaTimerAlarms.isHostResumed = false
  }

  /** Schedules an end-of-phase notification for an app timer such as the Pomodoro. */
  @ReactMethod
  fun scheduleTimerAlarm(options: ReadableMap, promise: Promise) {
    try {
      val timerId = options.getString("id")?.trim().orEmpty()
      val triggerAtMs = options.getDouble("triggerAtMs").toLong()
      require(timerId.isNotEmpty()) { "id is required" }
      require(triggerAtMs > System.currentTimeMillis()) { "triggerAtMs must be in the future" }
      LafinaTimerAlarms.schedule(
          reactContext,
          timerId,
          triggerAtMs,
          options.getString("title") ?: "",
          options.getString("body") ?: ""
      )
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("TIMER_ALARM_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun cancelTimerAlarm(timerId: String, promise: Promise) {
    try {
      LafinaTimerAlarms.cancel(reactContext, timerId)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("TIMER_ALARM_ERROR", e.message, e)
    }
  }

  override fun getName(): String = "LafinaReminder"

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit

  @ReactMethod
  fun scheduleExactAlarm(options: ReadableMap, promise: Promise) {
    try {
      val reminderId = options.getString("reminderId")?.trim().orEmpty()
      val task = options.getString("task")?.trim().orEmpty()
      val triggerAtMs = options.getDouble("triggerAtMs").toLong()
      require(reminderId.isNotEmpty()) { "reminderId is required" }
      require(triggerAtMs > System.currentTimeMillis()) { "triggerAtMs must be in the future" }
      scheduleAlarm(reactContext, reminderId, task, triggerAtMs, persist = true)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ALARM_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun cancelAlarm(reminderId: String, promise: Promise) {
    try {
      cancelScheduledAlarm(reactContext, reminderId, removePersisted = true)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ALARM_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun consumePendingCall(promise: Promise) {
    try {
      val preferences = reactContext.getSharedPreferences(PENDING_CALL_PREFS, Context.MODE_PRIVATE)
      val reminderId = preferences.getString(KEY_PENDING_REMINDER_ID, null)
      if (reminderId.isNullOrBlank()) {
        promise.resolve(null)
        return
      }
      val payload = Arguments.createMap().apply {
        putString("reminderId", reminderId)
        putString("task", preferences.getString(KEY_PENDING_TASK, "") ?: "")
        putString("action", preferences.getString(KEY_PENDING_ACTION, ACTION_CALL) ?: ACTION_CALL)
      }
      preferences.edit().clear().apply()
      promise.resolve(payload)
    } catch (e: Exception) {
      promise.reject("PENDING_CALL_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun finishIncomingCall(reminderId: String, promise: Promise) {
    try {
      NotificationManagerCompat.from(reactContext).cancel(notificationId(reminderId))
      stopRingtoneInternal()
      reactContext.getSharedPreferences(PENDING_CALL_PREFS, Context.MODE_PRIVATE).edit().clear().apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("CALL_FINISH_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun startActiveCall(task: String, promise: Promise) {
    try {
      val intent = Intent(reactContext, LafinaReminderService::class.java).apply {
        action = LafinaReminderService.ACTION_START_ACTIVE_CALL
        putExtra(LafinaReminderService.EXTRA_TASK, task)
      }
      ContextCompat.startForegroundService(reactContext, intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ACTIVE_CALL_SERVICE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun stopActiveCall(promise: Promise) {
    try {
      reactContext.stopService(Intent(reactContext, LafinaReminderService::class.java))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ACTIVE_CALL_SERVICE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun getPermissionStatus(promise: Promise) {
    try {
      val alarmManager = reactContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
      val fullScreen = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
          (reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
              .canUseFullScreenIntent()
      promise.resolve(Arguments.createMap().apply {
        putBoolean("canScheduleExactAlarms", exact)
        putBoolean("canUseFullScreenIntent", fullScreen)
        putBoolean("notificationsEnabled", NotificationManagerCompat.from(reactContext).areNotificationsEnabled())
      })
    } catch (e: Exception) {
      promise.reject("PERMISSION_STATUS_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun openExactAlarmSettings(promise: Promise) {
    openSettingsIntent(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
      data = Uri.parse("package:${reactContext.packageName}")
    }, promise)
  }

  @ReactMethod
  fun openFullScreenIntentSettings(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      promise.resolve(false)
      return
    }
    openSettingsIntent(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
      data = Uri.parse("package:${reactContext.packageName}")
    }, promise)
  }

  private fun openSettingsIntent(intent: Intent, promise: Promise) {
    try {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SETTINGS_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun startRingtone(promise: Promise) {
    try {
      synchronized(this) {
        if (activeRingtone == null) {
          val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
          activeRingtone = RingtoneManager.getRingtone(reactContext, uri)
        }
        activeRingtone?.let { if (!it.isPlaying) it.play() }
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("RINGTONE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun stopRingtone(promise: Promise) {
    try {
      stopRingtoneInternal()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("RINGTONE_ERROR", e.message, e)
    }
  }

  private fun stopRingtoneInternal() {
    synchronized(this) {
      activeRingtone?.let { if (it.isPlaying) it.stop() }
      activeRingtone = null
    }
  }

  override fun onNewIntent(intent: Intent) {
    val payload = payloadFromIntent(intent) ?: return
    persistPendingCall(
        reactContext,
        payload.getString("reminderId") ?: return,
        payload.getString("task") ?: "",
        payload.getString("action") ?: ACTION_CALL
    )
    if (reactContext.hasActiveReactInstance()) {
      reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(EVENT_CALL_TRIGGER, payload)
    }
  }

  override fun onActivityResult(
      activity: android.app.Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?
  ) = Unit

  companion object {
    const val ACTION_TRIGGER_REMINDER = "com.lafina.ACTION_TRIGGER_REMINDER"
    const val ACTION_CALL = "call"
    const val ACTION_ANSWER = "answer"
    const val ACTION_DECLINE = "decline"
    const val EVENT_CALL_TRIGGER = "LAFINA_NATIVE_CALL_TRIGGER"

    private const val ALARM_PREFS = "lafina_alarm_registry"
    private const val PENDING_CALL_PREFS = "lafina_pending_call"
    private const val KEY_PENDING_REMINDER_ID = "reminder_id"
    private const val KEY_PENDING_TASK = "task"
    private const val KEY_PENDING_ACTION = "action"
    private const val CALL_CHANNEL_ID = "lafina_incoming_calls_v2"

    fun scheduleAlarm(
        context: Context,
        reminderId: String,
        task: String,
        triggerAtMs: Long,
        persist: Boolean
    ) {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val canScheduleExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
      if (canScheduleExact) {
        alarmManager.setExactAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            triggerAtMs,
            triggerPendingIntent(context, reminderId, task)
        )
      } else {
        alarmManager.setAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            triggerAtMs,
            triggerPendingIntent(context, reminderId, task)
        )
      }
      if (persist) {
        val record = JSONObject()
            .put("reminderId", reminderId)
            .put("task", task)
            .put("triggerAtMs", triggerAtMs)
        context.getSharedPreferences(ALARM_PREFS, Context.MODE_PRIVATE)
            .edit().putString(reminderId, record.toString()).apply()
      }
    }

    fun cancelScheduledAlarm(context: Context, reminderId: String, removePersisted: Boolean) {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val intent = Intent(context, LafinaReminderReceiver::class.java).apply {
        action = ACTION_TRIGGER_REMINDER
      }
      val pendingIntent = PendingIntent.getBroadcast(
          context,
          reminderId.hashCode(),
          intent,
          PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
      )
      if (pendingIntent != null) {
        alarmManager.cancel(pendingIntent)
        pendingIntent.cancel()
      }
      if (removePersisted) {
        context.getSharedPreferences(ALARM_PREFS, Context.MODE_PRIVATE)
            .edit().remove(reminderId).apply()
      }
    }

    fun restoreScheduledAlarms(context: Context) {
      val preferences = context.getSharedPreferences(ALARM_PREFS, Context.MODE_PRIVATE)
      val now = System.currentTimeMillis()
      preferences.all.forEach { (key, rawValue) ->
        try {
          val record = JSONObject(rawValue as String)
          val reminderId = record.optString("reminderId", key)
          val task = record.optString("task", "")
          val triggerAtMs = record.getLong("triggerAtMs")
          if (triggerAtMs > now) {
            scheduleAlarm(context, reminderId, task, triggerAtMs, persist = false)
          } else {
            preferences.edit().remove(key).apply()
            showIncomingCall(context, reminderId, task)
          }
        } catch (_: Exception) {
          preferences.edit().remove(key).apply()
        }
      }
    }

    fun handleAlarmTrigger(context: Context, reminderId: String, task: String) {
      context.getSharedPreferences(ALARM_PREFS, Context.MODE_PRIVATE)
          .edit().remove(reminderId).apply()
      showIncomingCall(context, reminderId, task)
    }

    fun showIncomingCall(context: Context, reminderId: String, task: String) {
      createCallChannel(context)
      persistPendingCall(context, reminderId, task, ACTION_CALL)
      val fullScreenIntent = callActivityPendingIntent(context, reminderId, task, ACTION_CALL, 0)
      val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      val notification = NotificationCompat.Builder(context, CALL_CHANNEL_ID)
          .setSmallIcon(android.R.drawable.sym_call_incoming)
          .setContentTitle("LAFINA Reminder")
          .setContentText(task.ifBlank { "Scheduled academic reminder" })
          .setCategory(NotificationCompat.CATEGORY_CALL)
          .setPriority(NotificationCompat.PRIORITY_MAX)
          .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
          .setOngoing(true)
          .setAutoCancel(false)
          .setSound(ringtoneUri)
          .setVibrate(longArrayOf(0, 1000, 1000, 1000, 1000))
          .setContentIntent(fullScreenIntent)
          .setFullScreenIntent(fullScreenIntent, true)
          .build()
      notification.flags = notification.flags or Notification.FLAG_INSISTENT
      try {
        NotificationManagerCompat.from(context).notify(notificationId(reminderId), notification)
      } catch (_: SecurityException) {
        // The JS permission preflight provides recovery UI.
      }
    }

    fun captureActivityIntent(context: Context, intent: Intent?) {
      val reminderId = intent?.getStringExtra("reminderId")?.takeIf { it.isNotBlank() } ?: return
      persistPendingCall(
          context,
          reminderId,
          intent.getStringExtra("task") ?: "",
          intent.getStringExtra("action") ?: ACTION_CALL
      )
    }

    fun payloadFromIntent(intent: Intent?): WritableMap? {
      val reminderId = intent?.getStringExtra("reminderId")?.takeIf { it.isNotBlank() } ?: return null
      return Arguments.createMap().apply {
        putString("reminderId", reminderId)
        putString("task", intent.getStringExtra("task") ?: "")
        putString("action", intent.getStringExtra("action") ?: ACTION_CALL)
      }
    }

    private fun persistPendingCall(context: Context, reminderId: String, task: String, action: String) {
      context.getSharedPreferences(PENDING_CALL_PREFS, Context.MODE_PRIVATE)
          .edit()
          .putString(KEY_PENDING_REMINDER_ID, reminderId)
          .putString(KEY_PENDING_TASK, task)
          .putString(KEY_PENDING_ACTION, action)
          .apply()
    }

    private fun triggerPendingIntent(context: Context, reminderId: String, task: String): PendingIntent {
      val intent = Intent(context, LafinaReminderReceiver::class.java).apply {
        action = ACTION_TRIGGER_REMINDER
        putExtra("reminderId", reminderId)
        putExtra("task", task)
      }
      return PendingIntent.getBroadcast(
          context,
          reminderId.hashCode(),
          intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    private fun callActivityPendingIntent(
        context: Context,
        reminderId: String,
        task: String,
        action: String,
        requestOffset: Int
    ): PendingIntent {
      val intent = Intent(context, MainActivity::class.java).apply {
        putExtra("reminderId", reminderId)
        putExtra("task", task)
        putExtra("action", action)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
      return PendingIntent.getActivity(
          context,
          reminderId.hashCode() + requestOffset,
          intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    private fun createCallChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      val audioAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      val channel = NotificationChannel(
          CALL_CHANNEL_ID,
          "LAFINA reminder calls",
          NotificationManager.IMPORTANCE_HIGH
      ).apply {
        description = "Incoming offline academic reminder calls"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 1000, 1000, 1000, 1000)
        setSound(ringtoneUri, audioAttributes)
      }
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
          .createNotificationChannel(channel)
    }

    private fun notificationId(reminderId: String): Int = reminderId.hashCode()
  }
}
