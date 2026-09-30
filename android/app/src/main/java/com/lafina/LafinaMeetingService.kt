package com.lafina

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.StatFs
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject

class LafinaMeetingService : Service() {

  companion object {
    const val TAG = "LafinaMeetingService"
    const val NOTIFICATION_ID = 4001
    const val CHANNEL_ID = "lafina_meeting_recording_channel"
    const val ACTION_START_RECORDING = "com.lafina.action.START_MEETING_RECORDING"
    const val ACTION_PAUSE_RECORDING = "com.lafina.action.PAUSE_MEETING_RECORDING"
    const val ACTION_RESUME_RECORDING = "com.lafina.action.RESUME_MEETING_RECORDING"
    const val ACTION_STOP_RECORDING = "com.lafina.action.STOP_MEETING_RECORDING"

    const val EXTRA_MEETING_ID = "extra_meeting_id"
    const val EXTRA_MEETING_TITLE = "extra_meeting_title"

    const val SAMPLE_RATE = 16000
    const val CHUNK_DURATION_SEC = 30
    const val SAMPLES_PER_CHUNK = SAMPLE_RATE * CHUNK_DURATION_SEC
    const val BYTES_PER_SAMPLE = 2
    const val BYTES_PER_CHUNK = SAMPLES_PER_CHUNK * BYTES_PER_SAMPLE
    const val WAV_HEADER_BYTES = 44
    const val MIN_STORAGE_BYTES = 50L * 1024L * 1024L // 50 MB

    private const val RECOVERY_FILE = "meeting_recovery.json"

    /**
     * Open from the moment a recording is requested until its last chunk is on
     * disk. A stop waits on it, so the chunk list it reads is the final one.
     */
    @Volatile private var sessionEnd: CountDownLatch? = null

    /** Called before the start intent is sent, so a stop racing the start still waits for it. */
    fun beginSession() {
      sessionEnd = CountDownLatch(1)
    }

    fun isSessionActive(): Boolean = (sessionEnd?.count ?: 0L) > 0L

    /** True once the session has written its final state, or if none was running. */
    fun awaitSessionEnd(timeoutMs: Long): Boolean =
      sessionEnd?.await(timeoutMs, TimeUnit.MILLISECONDS) ?: true

    private fun endSession() {
      sessionEnd?.countDown()
    }

    /**
     * Where a meeting's audio lives. Files, not cache: the audio is kept for
     * transcribing again until the user deletes it, and Android clears caches
     * on its own when storage runs low.
     */
    fun meetingDir(context: Context, meetingId: String): File =
      File(context.filesDir, "meetings/$meetingId")

    fun recoveryFile(context: Context): File = File(context.filesDir, RECOVERY_FILE)
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var audioRecord: AudioRecord? = null
  private val isRecording = AtomicBoolean(false)
  private val isPaused = AtomicBoolean(false)
  private val totalElapsedSeconds = AtomicLong(0)

  private var meetingId: String = ""
  private var meetingTitle: String = "Meeting"
  private val chunkFiles = mutableListOf<String>()

  // Resolved once per session: the recording thread may still be writing
  // after the service itself has been destroyed.
  private var sessionDir: File? = null
  private var stateFile: File? = null

  private val recordingExecutor = Executors.newSingleThreadExecutor()
  private var tickerExecutor: ScheduledExecutorService? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START_RECORDING -> {
        meetingId = intent.getStringExtra(EXTRA_MEETING_ID) ?: System.currentTimeMillis().toString()
        meetingTitle = intent.getStringExtra(EXTRA_MEETING_TITLE) ?: "Meeting"
        startMeetingSession()
      }
      ACTION_PAUSE_RECORDING -> {
        isPaused.set(true)
        updateNotification("Paused • ${formatElapsed(totalElapsedSeconds.get())}")
      }
      ACTION_RESUME_RECORDING -> {
        isPaused.set(false)
        updateNotification("Recording • ${formatElapsed(totalElapsedSeconds.get())}")
      }
      ACTION_STOP_RECORDING -> {
        stopMeetingSession()
        stopSelf()
      }
      else -> {
        // A sticky restart after the process died: the recording is gone,
        // and the recovery file left behind lets the app pick it up.
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  private fun startMeetingSession() {
    if (isRecording.get()) return

    // A service started in the foreground has to say so promptly, even when
    // it is about to give up.
    val notification = createNotification("Recording • 00:00")
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // Android 14 refuses a microphone service without the permission.
      Log.e(TAG, "Could not start the meeting recording in the foreground: ${e.message}", e)
      endSession()
      stopSelf()
      return
    }

    if (getAvailableStorageBytes() < MIN_STORAGE_BYTES) {
      Log.e(TAG, "Insufficient disk space for meeting recording.")
      endSession()
      stopSelf()
      return
    }

    acquireWakeLock()
    isRecording.set(true)
    isPaused.set(false)
    totalElapsedSeconds.set(0)
    synchronized(chunkFiles) { chunkFiles.clear() }
    sessionDir = meetingDir(this, meetingId).apply { mkdirs() }
    stateFile = recoveryFile(this)
    saveRecoveryState()

    // Ticker for the notification's elapsed time
    tickerExecutor = Executors.newSingleThreadScheduledExecutor().apply {
      scheduleAtFixedRate({
        if (isRecording.get() && !isPaused.get()) {
          val elapsed = totalElapsedSeconds.incrementAndGet()
          updateNotification("Recording • ${formatElapsed(elapsed)}")

          if (getAvailableStorageBytes() < MIN_STORAGE_BYTES) {
            Log.w(TAG, "Low disk storage detected during recording. Stopping.")
            stopMeetingSession()
            stopSelf()
          }

          if (elapsed % 10 == 0L) {
            saveRecoveryState()
          }
        }
      }, 1, 1, TimeUnit.SECONDS)
    }

    recordingExecutor.execute {
      recordAudioChunks()
    }
  }

  private fun recordAudioChunks() {
    val bufferSize = maxOf(
      AudioRecord.getMinBufferSize(
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT
      ),
      SAMPLE_RATE * 2
    )
    val meetingDir = sessionDir ?: meetingDir(this, meetingId).apply { mkdirs() }

    try {
      audioRecord = AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufferSize
      )

      if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
        Log.e(TAG, "Failed to initialize AudioRecord for meeting.")
        return
      }

      var chunkIndex = nextChunkIndex(meetingDir)
      val readBuffer = ShortArray(1024)
      var capturing = false

      while (isRecording.get()) {
        if (isPaused.get()) {
          // Stop capturing while paused, so nothing said during the pause
          // is waiting in the buffer when recording resumes.
          if (capturing) {
            audioRecord?.stop()
            capturing = false
          }
          Thread.sleep(100)
          continue
        }
        if (!capturing) {
          audioRecord?.startRecording()
          capturing = true
        }

        val pcmFile = File(meetingDir, "chunk_${chunkIndex}.pcm")
        var bytesWritten = 0
        FileOutputStream(pcmFile).use { pcmOut ->
          while (isRecording.get() && !isPaused.get() && bytesWritten < BYTES_PER_CHUNK) {
            val read = audioRecord?.read(readBuffer, 0, readBuffer.size) ?: -1
            if (read > 0) {
              val byteBuffer = ByteBuffer.allocate(read * 2).order(ByteOrder.LITTLE_ENDIAN)
              for (i in 0 until read) {
                byteBuffer.putShort(readBuffer[i])
              }
              pcmOut.write(byteBuffer.array())
              bytesWritten += read * 2
            } else if (read < 0) {
              throw IllegalStateException("AudioRecord.read failed: $read")
            }
          }
        }

        if (pcmFile.length() > 0) {
          val chunkFile = File(meetingDir, "chunk_${chunkIndex}.wav")
          convertPcmToWav(pcmFile, chunkFile, SAMPLE_RATE, 1, 16)
          synchronized(chunkFiles) {
            chunkFiles.add(chunkFile.absolutePath)
          }
          saveRecoveryState()
          chunkIndex++
        }
        pcmFile.delete()
      }
    } catch (e: Exception) {
      Log.e(TAG, "Audio recording loop error: ${e.message}", e)
    } finally {
      try {
        audioRecord?.stop()
      } catch (_: Exception) {}
      try {
        audioRecord?.release()
      } catch (_: Exception) {}
      audioRecord = null

      // Whether the user stopped or the microphone failed, the recording is
      // over: record the final chunk list, then let a waiting stop read it.
      val stoppedByUser = !isRecording.getAndSet(false)
      saveRecoveryState(completed = true)
      endSession()
      if (!stoppedByUser) {
        stopMeetingSession()
        stopSelf()
      }
    }
  }

  /** Chunks continue after any already on disk, so nothing is overwritten. */
  private fun nextChunkIndex(dir: File): Int {
    val existing = dir.listFiles()
      ?.mapNotNull { Regex("""chunk_(\d+)\.wav""").matchEntire(it.name)?.groupValues?.get(1)?.toIntOrNull() }
      ?: emptyList()
    return (existing.maxOrNull() ?: -1) + 1
  }

  /**
   * Asks the recording thread to finish. It writes the last partial chunk
   * and the final state itself; see [awaitSessionEnd].
   */
  private fun stopMeetingSession() {
    isRecording.set(false)
    isPaused.set(false)
    tickerExecutor?.shutdownNow()
    tickerExecutor = null
    releaseWakeLock()
  }

  private fun saveRecoveryState(completed: Boolean = false) {
    val file = stateFile ?: return
    try {
      val json = JSONObject().apply {
        put("meetingId", meetingId)
        put("title", meetingTitle)
        put("durationSeconds", totalElapsedSeconds.get())
        put("status", if (completed) "stopped" else "recording")
        val arr = JSONArray()
        synchronized(chunkFiles) {
          chunkFiles.forEach { arr.put(it) }
        }
        put("chunkFiles", arr)
      }
      val temp = File(file.parentFile, "${file.name}.tmp")
      temp.writeText(json.toString())
      if (!temp.renameTo(file)) {
        file.writeText(json.toString())
        temp.delete()
      }
    } catch (e: Exception) {
      Log.w(TAG, "Failed to write meeting recovery state: ${e.message}")
    }
  }

  private fun getAvailableStorageBytes(): Long {
    val stat = StatFs(filesDir.absolutePath)
    return stat.availableBlocksLong * stat.blockSizeLong
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Meeting Recording",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Ongoing audio recording for meeting transcription"
        setSound(null, null)
        enableVibration(false)
      }
      val manager = getSystemService(NotificationManager::class.java)
      manager?.createNotificationChannel(channel)
    }
  }

  private fun createNotification(statusText: String): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val openPendingIntent = PendingIntent.getActivity(
      this,
      4002,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(meetingTitle)
      .setContentText(statusText)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(openPendingIntent)
      .build()
  }

  private fun updateNotification(statusText: String) {
    if (!isRecording.get()) return
    val manager = getSystemService(NotificationManager::class.java)
    manager?.notify(NOTIFICATION_ID, createNotification(statusText))
  }

  private fun formatElapsed(seconds: Long): String {
    val mins = seconds / 60
    val secs = seconds % 60
    return String.format("%02d:%02d", mins, secs)
  }

  private fun convertPcmToWav(pcmFile: File, wavFile: File, sampleRate: Int, channels: Int, bitsPerSample: Int) {
    val pcmSize = pcmFile.length()
    val totalDataLen = pcmSize + 36
    val byteRate = sampleRate * channels * bitsPerSample / 8

    RandomAccessFile(wavFile, "rw").use { wav ->
      wav.setLength(0)
      // RIFF header
      wav.writeBytes("RIFF")
      wav.writeInt(Integer.reverseBytes(totalDataLen.toInt()))
      wav.writeBytes("WAVE")
      // fmt subchunk
      wav.writeBytes("fmt ")
      wav.writeInt(Integer.reverseBytes(16))
      wav.writeShort(java.lang.Short.reverseBytes(1.toShort()).toInt()) // AudioFormat PCM = 1
      wav.writeShort(java.lang.Short.reverseBytes(channels.toShort()).toInt())
      wav.writeInt(Integer.reverseBytes(sampleRate))
      wav.writeInt(Integer.reverseBytes(byteRate))
      wav.writeShort(java.lang.Short.reverseBytes((channels * bitsPerSample / 8).toShort()).toInt())
      wav.writeShort(java.lang.Short.reverseBytes(bitsPerSample.toShort()).toInt())
      // data subchunk
      wav.writeBytes("data")
      wav.writeInt(Integer.reverseBytes(pcmSize.toInt()))
      // PCM payload
      pcmFile.inputStream().use { input ->
        val buffer = ByteArray(4096)
        var read: Int
        while (input.read(buffer).also { read = it } != -1) {
          wav.write(buffer, 0, read)
        }
      }
    }
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "lafina:meeting-recording"
    ).apply {
      setReferenceCounted(false)
      // Past the app's 3-hour limit on a recording, so it never expires mid-meeting.
      acquire(185 * 60 * 1000L)
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  override fun onDestroy() {
    stopMeetingSession()
    // Lets the recording thread finish writing its last chunk.
    recordingExecutor.shutdown()
    super.onDestroy()
  }
}
