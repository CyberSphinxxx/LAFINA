package com.lafina

import android.content.Intent
import android.os.Build
import android.os.StatFs
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class LafinaMeetingRecorderModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "LafinaMeetingRecorder"

    /** Long enough for the recording thread to write a full 30 s chunk. */
    private const val STOP_TIMEOUT_MS = 8_000L

    /** The model stays loaded between chunks, and is freed once a meeting's chunks are done. */
    private const val WHISPER_IDLE_RELEASE_SEC = 45L
  }

  // Transcription is slow and the model is not thread-safe: one worker owns
  // the Whisper context, and keeps it off the thread other modules share.
  private val whisperWorker = Executors.newSingleThreadScheduledExecutor()
  private var whisperContext = 0L
  private var whisperRelease: ScheduledFuture<*>? = null

  override fun getName(): String = "LafinaMeetingRecorder"

  private fun serviceIntent(action: String) =
    Intent(reactContext, LafinaMeetingService::class.java).apply { this.action = action }

  @ReactMethod
  fun startMeetingRecording(options: ReadableMap, promise: Promise) {
    try {
      if (LafinaMeetingService.isSessionActive()) {
        promise.reject("ALREADY_RECORDING", "A meeting is already being recorded.")
        return
      }
      val meetingId = options.getString("meetingId") ?: System.currentTimeMillis().toString()
      val title = options.getString("title") ?: "Meeting"

      val intent = serviceIntent(LafinaMeetingService.ACTION_START_RECORDING).apply {
        putExtra(LafinaMeetingService.EXTRA_MEETING_ID, meetingId)
        putExtra(LafinaMeetingService.EXTRA_MEETING_TITLE, title)
      }

      LafinaMeetingService.beginSession()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactContext.startForegroundService(intent)
      } else {
        reactContext.startService(intent)
      }

      val result = Arguments.createMap().apply {
        putBoolean("success", true)
        putString("meetingId", meetingId)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("START_RECORDING_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun pauseMeetingRecording(promise: Promise) {
    try {
      reactContext.startService(serviceIntent(LafinaMeetingService.ACTION_PAUSE_RECORDING))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("PAUSE_RECORDING_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun resumeMeetingRecording(promise: Promise) {
    try {
      reactContext.startService(serviceIntent(LafinaMeetingService.ACTION_RESUME_RECORDING))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("RESUME_RECORDING_ERROR", e.message, e)
    }
  }

  /** Whether the recording service is still capturing; it stops on its own when storage runs out. */
  @ReactMethod
  fun isMeetingRecording(promise: Promise) {
    promise.resolve(LafinaMeetingService.isSessionActive())
  }

  /**
   * Stops the recording and resolves with its final chunk list.
   *
   * The last chunk is written by the recording thread after it sees the
   * stop, so this waits for it rather than reading the state file at once
   * and losing up to 30 seconds of the end of the meeting.
   */
  @ReactMethod
  fun stopMeetingRecording(promise: Promise) {
    Thread {
      try {
        if (LafinaMeetingService.isSessionActive()) {
          reactContext.startService(serviceIntent(LafinaMeetingService.ACTION_STOP_RECORDING))
        }
        val finalized = LafinaMeetingService.awaitSessionEnd(STOP_TIMEOUT_MS)
        if (!finalized) Log.w(TAG, "The recording did not finish writing in time; using what is on disk.")

        val stateFile = LafinaMeetingService.recoveryFile(reactContext)
        val map = if (stateFile.exists()) readSession(JSONObject(stateFile.readText())) else emptySession()
        map.putBoolean("finalized", finalized)
        // The meeting's row and its audio folder now carry everything the
        // recovery file held.
        if (finalized) stateFile.delete()
        promise.resolve(map)
      } catch (e: Exception) {
        promise.reject("STOP_RECORDING_ERROR", e.message, e)
      }
    }.start()
  }

  private fun emptySession(): WritableMap = Arguments.createMap().apply {
    putArray("chunkFiles", Arguments.createArray())
    putDouble("durationSeconds", 0.0)
  }

  private fun readSession(json: JSONObject): WritableMap = Arguments.createMap().apply {
    putString("meetingId", json.optString("meetingId"))
    putString("title", json.optString("title"))
    putDouble("durationSeconds", json.optDouble("durationSeconds", 0.0))
    putString("status", json.optString("status"))
    val chunkArr = Arguments.createArray()
    val jsonArr = json.optJSONArray("chunkFiles")
    if (jsonArr != null) {
      for (i in 0 until jsonArr.length()) {
        chunkArr.pushString(jsonArr.getString(i))
      }
    }
    putArray("chunkFiles", chunkArr)
  }

  @ReactMethod
  fun getAvailableStorageMB(promise: Promise) {
    try {
      val stat = StatFs(reactContext.filesDir.absolutePath)
      val availableBytes = stat.availableBlocksLong * stat.blockSizeLong
      val availableMB = availableBytes / (1024 * 1024)
      promise.resolve(availableMB.toDouble())
    } catch (e: Exception) {
      promise.reject("STORAGE_CHECK_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun getRecoverableMeeting(promise: Promise) {
    try {
      val stateFile = LafinaMeetingService.recoveryFile(reactContext)
      // A session still running is not something to recover.
      if (!stateFile.exists() || LafinaMeetingService.isSessionActive()) {
        promise.resolve(null)
        return
      }
      promise.resolve(readSession(JSONObject(stateFile.readText())))
    } catch (e: Exception) {
      promise.reject("RECOVERY_CHECK_ERROR", e.message, e)
    }
  }

  /** Forgets the recovery file and deletes the chunks it lists. */
  @ReactMethod
  fun discardRecoverableMeeting(promise: Promise) {
    try {
      val stateFile = LafinaMeetingService.recoveryFile(reactContext)
      if (stateFile.exists()) {
        val json = JSONObject(stateFile.readText())
        val jsonArr = json.optJSONArray("chunkFiles")
        if (jsonArr != null) {
          for (i in 0 until jsonArr.length()) {
            File(jsonArr.getString(i)).delete()
          }
        }
        stateFile.delete()
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("DISCARD_RECOVERY_ERROR", e.message, e)
    }
  }

  /** Clears the recovery file without touching audio the app has already taken over. */
  @ReactMethod
  fun clearRecoveryState(promise: Promise) {
    try {
      if (!LafinaMeetingService.isSessionActive()) {
        LafinaMeetingService.recoveryFile(reactContext).delete()
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("CLEAR_RECOVERY_ERROR", e.message, e)
    }
  }

  /**
   * A meeting's audio chunks in recording order, with how long each one is.
   * Chunks are not all 30 s long: a pause or a stop ends one early.
   */
  @ReactMethod
  fun listMeetingAudio(meetingId: String, promise: Promise) {
    try {
      val dir = LafinaMeetingService.meetingDir(reactContext, meetingId)
      val chunks = (dir.listFiles() ?: emptyArray())
        .mapNotNull { file ->
          Regex("""chunk_(\d+)\.wav""").matchEntire(file.name)?.groupValues?.get(1)?.toIntOrNull()?.let { it to file }
        }
        .sortedBy { it.first }
        .map { it.second }

      val list = Arguments.createArray()
      var totalBytes = 0L
      chunks.forEach { file ->
        val bytes = file.length()
        totalBytes += bytes
        val pcmBytes = maxOf(0L, bytes - LafinaMeetingService.WAV_HEADER_BYTES)
        val durationMs = pcmBytes * 1000L /
          (LafinaMeetingService.SAMPLE_RATE * LafinaMeetingService.BYTES_PER_SAMPLE)
        list.pushMap(Arguments.createMap().apply {
          putString("path", file.absolutePath)
          putDouble("durationMs", durationMs.toDouble())
          putDouble("bytes", bytes.toDouble())
        })
      }
      promise.resolve(Arguments.createMap().apply {
        putArray("chunks", list)
        putDouble("totalBytes", totalBytes.toDouble())
      })
    } catch (e: Exception) {
      promise.reject("LIST_AUDIO_ERROR", e.message, e)
    }
  }

  /** Deletes all of a meeting's audio. */
  @ReactMethod
  fun deleteMeetingAudio(meetingId: String, promise: Promise) {
    try {
      if (meetingId.isBlank() || meetingId.contains('/') || meetingId.contains("..")) {
        promise.reject("DELETE_AUDIO_ERROR", "Invalid meeting id.")
        return
      }
      LafinaMeetingService.meetingDir(reactContext, meetingId).deleteRecursively()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("DELETE_AUDIO_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun transcribeChunkWithTimestamps(filePath: String, promise: Promise) {
    whisperWorker.execute {
      try {
        val file = File(filePath)
        if (!file.exists()) {
          promise.reject("FILE_NOT_FOUND", "Audio chunk file not found: $filePath")
          return@execute
        }

        // Read WAV audio samples (skip the 44-byte header)
        val audioBytes = file.readBytes()
        if (audioBytes.size <= LafinaMeetingService.WAV_HEADER_BYTES) {
          promise.resolve("[]")
          return@execute
        }

        val pcmBytes = audioBytes.copyOfRange(LafinaMeetingService.WAV_HEADER_BYTES, audioBytes.size)
        val sampleCount = pcmBytes.size / 2
        val floatSamples = FloatArray(sampleCount)
        val byteBuffer = ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN)

        for (i in 0 until sampleCount) {
          floatSamples[i] = byteBuffer.short / 32768.0f
        }

        val context = obtainWhisperContext()
        if (context == 0L) {
          promise.reject("WHISPER_INIT_ERROR", "Failed to initialize Whisper model context")
          return@execute
        }
        try {
          promise.resolve(LafinaWhisperBridge.transcribeWithTimestamps(context, floatSamples, 4))
        } finally {
          scheduleWhisperRelease()
        }
      } catch (e: Throwable) {
        promise.reject("TRANSCRIBE_CHUNK_ERROR", e.message, e)
      }
    }
  }

  /** Runs on [whisperWorker]. */
  private fun obtainWhisperContext(): Long {
    whisperRelease?.cancel(false)
    whisperRelease = null
    if (whisperContext == 0L) {
      whisperContext = LafinaWhisperBridge.initContext(reactContext.assets, LafinaWhisperBridge.MODEL_ASSET)
    }
    return whisperContext
  }

  /** Runs on [whisperWorker]. */
  private fun scheduleWhisperRelease() {
    whisperRelease?.cancel(false)
    whisperRelease = whisperWorker.schedule({ freeWhisperContext() }, WHISPER_IDLE_RELEASE_SEC, TimeUnit.SECONDS)
  }

  private fun freeWhisperContext() {
    if (whisperContext != 0L) {
      LafinaWhisperBridge.freeContext(whisperContext)
      whisperContext = 0L
    }
  }

  @ReactMethod
  fun deleteAudioFile(filePath: String, promise: Promise) {
    try {
      val file = File(filePath)
      if (file.exists()) {
        file.delete()
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("DELETE_AUDIO_ERROR", e.message, e)
    }
  }

  override fun invalidate() {
    whisperWorker.execute { freeWhisperContext() }
    whisperWorker.shutdown()
    super.invalidate()
  }
}
