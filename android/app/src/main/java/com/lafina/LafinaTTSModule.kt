package com.lafina

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.util.zip.ZipFile

/**
 * On-device Kokoro-82M (v0.19) TTS via ONNX Runtime.
 *
 * Tokenization must use the official Kokoro phoneme vocabulary — sequential
 * char indexing produces wrong token IDs and unintelligible / empty-sounding audio.
 */
class LafinaTTSModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private var activeMediaPlayer: MediaPlayer? = null
  private var activePlaybackPromise: Promise? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var ortEnv: OrtEnvironment? = null
  private var ortSession: OrtSession? = null
  private var styleMatrix: Array<FloatArray>? = null
  private val vocabMap = mutableMapOf<Char, Int>()
  private val cmuDict = mutableMapOf<String, String>()

  override fun getName(): String = "LafinaTTS"

  /**
   * Tells JavaScript that another app (typically a real incoming phone call) has
   * taken over audio, so the simulated reminder call can yield immediately.
   */
  private fun emitExternalAudioInterruption(focusChange: Int) {
    try {
      if (!reactContext.hasActiveReactInstance()) return
      val payload = Arguments.createMap().apply {
        putString("reason", "audio_focus_loss")
        putInt("focusChange", focusChange)
      }
      reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_EXTERNAL_AUDIO_INTERRUPTED, payload)
    } catch (e: Exception) {
      Log.w("LafinaTTS", "Could not emit external audio interruption", e)
    }
  }

  private fun handleFocusChange(focusChange: Int) {
    if (focusChange == AudioManager.AUDIOFOCUS_LOSS ||
      focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
    ) {
      emitExternalAudioInterruption(focusChange)
    }
  }

  init {
    initializeVocab()
  }

  /**
   * Official Kokoro phoneme vocabulary (hexgrad Kokoro-82M / tokenizer.json).
   * Pad token `$` / id 0 is applied explicitly at sequence boundaries.
   */
  private fun initializeVocab() {
    val entries = mapOf(
      ';' to 1, ':' to 2, ',' to 3, '.' to 4, '!' to 5, '?' to 6,
      '—' to 9, '…' to 10, '"' to 11, '(' to 12, ')' to 13,
      '“' to 14, '”' to 15, ' ' to 16,
      'A' to 24, 'I' to 25, 'O' to 31, 'Q' to 33, 'S' to 35, 'T' to 36,
      'W' to 39, 'Y' to 41,
      'a' to 43, 'b' to 44, 'c' to 45, 'd' to 46, 'e' to 47, 'f' to 48,
      'h' to 50, 'i' to 51, 'j' to 52, 'k' to 53, 'l' to 54, 'm' to 55,
      'n' to 56, 'o' to 57, 'p' to 58, 'q' to 59, 'r' to 60, 's' to 61,
      't' to 62, 'u' to 63, 'v' to 64, 'w' to 65, 'x' to 66, 'y' to 67,
      'z' to 68,
      'ɑ' to 69, 'ɐ' to 70, 'ɒ' to 71, 'æ' to 72, 'β' to 75, 'ɔ' to 76,
      'ɕ' to 77, 'ç' to 78, 'ɖ' to 80, 'ð' to 81, 'ʤ' to 82, 'ə' to 83,
      'ɚ' to 85, 'ɛ' to 86, 'ɜ' to 87, 'ɟ' to 90, 'ɡ' to 92, 'ɥ' to 99,
      'ɨ' to 101, 'ɪ' to 102, 'ʝ' to 103, 'ɯ' to 110, 'ɰ' to 111,
      'ŋ' to 112, 'ɳ' to 113, 'ɲ' to 114, 'ɴ' to 115, 'ø' to 116,
      'ɸ' to 118, 'θ' to 119, 'œ' to 120, 'ɹ' to 123, 'ɾ' to 125,
      'ɻ' to 126, 'ʁ' to 128, 'ɽ' to 129, 'ʂ' to 130, 'ʃ' to 131,
      'ʈ' to 132, 'ʧ' to 133, 'ʊ' to 135, 'ʋ' to 136, 'ʌ' to 138,
      'ɣ' to 139, 'ɤ' to 140, 'χ' to 142, 'ʎ' to 143, 'ʒ' to 147,
      'ʔ' to 148, 'ˈ' to 156, 'ˌ' to 157, 'ː' to 158, 'ʰ' to 162,
      'ʲ' to 164, '↓' to 169, '→' to 171, '↗' to 172, '↘' to 173,
      'ᵻ' to 177,
    )
    vocabMap.clear()
    vocabMap.putAll(entries)
  }

  private var initError: Exception? = null
  private var initErrorTimestamp: Long = 0L
  private val INIT_RETRY_COOLDOWN_MS = 5000L

  private fun loadResourcesIfNeeded() {
    if (ortSession != null && styleMatrix != null) return

    synchronized(this) {
      if (ortSession != null && styleMatrix != null) return

      initError?.let { previousError ->
        val elapsed = System.currentTimeMillis() - initErrorTimestamp
        if (elapsed < INIT_RETRY_COOLDOWN_MS) {
          throw previousError
        }
        Log.w("LafinaTTS", "Retrying init after previous failure (${elapsed}ms ago)")
        initError = null
      }

      try {
        ortEnv = OrtEnvironment.getEnvironment()

        val cacheDir = reactContext.cacheDir
        val modelFile = File(cacheDir, "kokoro-v0_19.onnx")
        val styleFile = File(cacheDir, "af_bella.bin")
        val dictFile = File(cacheDir, "cmudict.txt")

        copyAssetToFile("models/kokoro-v0_19.onnx", modelFile)
        copyAssetToFile("models/af_bella.bin", styleFile)
        copyAssetToFile("models/cmudict.txt", dictFile)

        Log.d("LafinaTTS", "Loading ONNX session from ${modelFile.absolutePath} (${modelFile.length()} bytes)")
        val sessionOptions = OrtSession.SessionOptions()
        // Cap intra-op threads to keep UI responsive on mid-range Android devices
        sessionOptions.setIntraOpNumThreads(2)
        ortSession = ortEnv?.createSession(modelFile.absolutePath, sessionOptions)
        Log.d("LafinaTTS", "ONNX session loaded successfully")

        styleMatrix = loadStyleMatrix(styleFile)
        Log.d("LafinaTTS", "Style matrix loaded: ${styleMatrix?.size} entries x 256")

        loadCmuDict(dictFile)
        Log.d("LafinaTTS", "CMU dictionary loaded: ${cmuDict.size} entries")
      } catch (e: Exception) {
        ortSession = null
        styleMatrix = null
        initError = e
        initErrorTimestamp = System.currentTimeMillis()
        Log.e("LafinaTTS", "Initialization failed (will retry after ${INIT_RETRY_COOLDOWN_MS}ms)", e)
        throw e
      }
    }
  }

  @ReactMethod
  fun resetInitError(promise: Promise) {
    synchronized(this) {
      initError = null
      initErrorTimestamp = 0L
      try {
        ortSession?.close()
      } catch (_: Exception) {
        // ignore
      }
      ortSession = null
      styleMatrix = null
    }
    promise.resolve(true)
  }

  /**
   * Copies an APK asset into the app cache, re-copying if the existing file
   * is missing or shorter than the asset (partial extract recovery).
   */
  private fun copyAssetToFile(assetPath: String, outFile: File) {
    val expectedSize = try {
      reactContext.assets.openFd(assetPath).use { it.length }
    } catch (_: Exception) {
      // Compressed assets may not support openFd — fall back to streaming size.
      reactContext.assets.open(assetPath).use { input ->
        var total = 0L
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          total += read
        }
        total
      }
    }

    if (outFile.exists() && outFile.length() == expectedSize && expectedSize > 0L) {
      return
    }
    if (outFile.exists()) {
      Log.w(
        "LafinaTTS",
        "Re-copying $assetPath (had ${outFile.length()} bytes, expected $expectedSize)"
      )
      outFile.delete()
    }

    reactContext.assets.open(assetPath).use { input ->
      FileOutputStream(outFile).use { output ->
        input.copyTo(output, 64 * 1024)
      }
    }

    if (expectedSize > 0L && outFile.length() != expectedSize) {
      throw Exception(
        "Asset copy size mismatch for $assetPath: wrote ${outFile.length()}, expected $expectedSize"
      )
    }
    Log.d("LafinaTTS", "Copied asset $assetPath -> ${outFile.absolutePath} (${outFile.length()} bytes)")
  }

  /**
   * Loads the style matrix from af_bella.bin (PyTorch ZIP containing .npy voice packs).
   * Shape is (511, 1, 256) which flattens to 511 x 256 style vectors.
   */
  private fun loadStyleMatrix(file: File): Array<FloatArray> {
    val zipFile = ZipFile(file)
    try {
      val entryName = "af_bella.npy"
      var entry = zipFile.getEntry(entryName)
      if (entry == null) {
        entry = zipFile.entries().asSequence().firstOrNull { it.name.endsWith(".npy") }
          ?: throw Exception("No .npy voice entry found in style file: ${file.name}")
        Log.w("LafinaTTS", "af_bella.npy not found, using fallback: ${entry.name}")
      }

      Log.d("LafinaTTS", "Extracting voice style from: ${entry.name} (${entry.size} bytes)")
      val rawBytes = zipFile.getInputStream(entry).use { it.readBytes() }

      if (rawBytes.size < 10 || rawBytes[0] != 0x93.toByte() ||
          rawBytes[1] != 'N'.code.toByte() || rawBytes[2] != 'U'.code.toByte()) {
        throw Exception("Invalid numpy file header in ${entry.name}")
      }

      val majorVersion = rawBytes[6].toInt() and 0xFF
      val headerLen: Int
      val dataOffset: Int
      if (majorVersion >= 2) {
        headerLen = (rawBytes[8].toInt() and 0xFF) or
                    ((rawBytes[9].toInt() and 0xFF) shl 8) or
                    ((rawBytes[10].toInt() and 0xFF) shl 16) or
                    ((rawBytes[11].toInt() and 0xFF) shl 24)
        dataOffset = 12 + headerLen
      } else {
        headerLen = (rawBytes[8].toInt() and 0xFF) or
                    ((rawBytes[9].toInt() and 0xFF) shl 8)
        dataOffset = 10 + headerLen
      }

      Log.d("LafinaTTS", "Numpy header: v$majorVersion, headerLen=$headerLen, dataOffset=$dataOffset")

      val dataBytes = rawBytes.size - dataOffset
      val totalFloats = dataBytes / 4
      val numEntries = totalFloats / 256

      if (numEntries == 0) {
        throw Exception("Style data too small: $totalFloats floats from ${entry.name}")
      }
      if (totalFloats % 256 != 0) {
        Log.w(
          "LafinaTTS",
          "Style data has $totalFloats floats (not evenly divisible by 256). Using $numEntries full entries."
        )
      }

      Log.d("LafinaTTS", "Loading style matrix: $numEntries entries x 256 floats ($dataBytes data bytes)")
      val floatBuf = ByteBuffer.wrap(rawBytes, dataOffset, dataBytes)
                       .order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()

      val matrix = Array(numEntries) { FloatArray(256) }
      for (i in 0 until numEntries) {
        floatBuf.get(matrix[i])
      }
      return matrix
    } finally {
      zipFile.close()
    }
  }

  /**
   * Selects the 256-dim style vector by phoneme length (excluding pad tokens).
   * Kokoro voice packs are indexed by non-pad token count.
   */
  private fun selectStyleForTokenCount(numTokensIncludingPads: Int): FloatArray {
    val matrix = styleMatrix ?: throw Exception("Style matrix not loaded")
    val phonemeCount = (numTokensIncludingPads - 2).coerceAtLeast(0)
    val index = phonemeCount.coerceIn(0, matrix.size - 1)
    return matrix[index]
  }

  private fun loadCmuDict(file: File) {
    cmuDict.clear()
    file.inputStream().bufferedReader().useLines { lines ->
      lines.forEach { line ->
        val trimmed = line.trim()
        if (!trimmed.startsWith(";;;") && trimmed.isNotEmpty()) {
          val firstSpace = trimmed.indexOf(' ')
          if (firstSpace > 0) {
            // Strip CMU variant markers like WORD(2)
            var word = trimmed.substring(0, firstSpace).trim().lowercase()
            val paren = word.indexOf('(')
            if (paren > 0) {
              word = word.substring(0, paren)
            }
            val phonemes = trimmed.substring(firstSpace + 1).trim()
            if (word.isNotEmpty() && phonemes.isNotEmpty() && !cmuDict.containsKey(word)) {
              cmuDict[word] = phonemes
            }
          }
        }
      }
    }
  }

  private fun textToPhonemes(text: String): String {
    val words = text.lowercase()
      .replace(Regex("[^a-z\\s']"), " ")
      .split(Regex("\\s+"))
    val phonemeBuilder = StringBuilder()

    for (word in words) {
      if (word.isEmpty()) continue
      val cleanedWord = word.trim('\'')
      if (cleanedWord.isEmpty()) continue

      val cmuPhones = cmuDict[cleanedWord]
      if (cmuPhones != null) {
        phonemeBuilder.append(mapCmuToIpa(cmuPhones)).append(' ')
      } else {
        // Grapheme fallback — letters exist in Kokoro vocab and still produce audio
        phonemeBuilder.append(cleanedWord).append(' ')
      }
    }
    return phonemeBuilder.toString().trim()
  }

  /**
   * Maps CMU ARPAbet phones to single-character IPA symbols present in Kokoro vocab.
   * Multi-char digraphs like "tʃ" are wrong — Kokoro expects ʧ / ʤ as single tokens.
   */
  private fun mapCmuToIpa(cmu: String): String {
    return cmu.split(" ")
      .map { phone ->
        val cleanPhone = phone.replace(Regex("\\d"), "")
        when (cleanPhone) {
          "AA" -> "ɑ"
          "AE" -> "æ"
          "AH" -> "ʌ"
          "AO" -> "ɔ"
          "AW" -> "aʊ"
          "AY" -> "aɪ"
          "EH" -> "ɛ"
          "ER" -> "ɚ"
          "EY" -> "eɪ"
          "IH" -> "ɪ"
          "IY" -> "i"
          "OW" -> "oʊ"
          "OY" -> "ɔɪ"
          "UH" -> "ʊ"
          "UW" -> "u"
          "B" -> "b"
          "CH" -> "ʧ"
          "D" -> "d"
          "DH" -> "ð"
          "F" -> "f"
          "G" -> "ɡ"
          "HH" -> "h"
          "JH" -> "ʤ"
          "K" -> "k"
          "L" -> "l"
          "M" -> "m"
          "N" -> "n"
          "NG" -> "ŋ"
          "P" -> "p"
          "R" -> "ɹ"
          "S" -> "s"
          "SH" -> "ʃ"
          "T" -> "t"
          "TH" -> "θ"
          "V" -> "v"
          "W" -> "w"
          "Y" -> "j"
          "Z" -> "z"
          "ZH" -> "ʒ"
          else -> ""
        }
      }
      .joinToString("")
  }

  private fun textToTokens(text: String): LongArray {
    val phonemes = textPhonemize(text)
    val tokens = mutableListOf<Long>()

    // Mandatory pad tokens at start and end (Kokoro contract)
    tokens.add(0L)

    for (char in phonemes) {
      val token = vocabMap[char]
      if (token != null) {
        tokens.add(token.toLong())
      }
    }

    tokens.add(0L)
    return tokens.toLongArray()
  }

  private fun textPhonemize(text: String): String {
    val rawPhonemes = textToPhonemes(text)
    val cleaned = StringBuilder()
    for (char in rawPhonemes) {
      if (vocabMap.containsKey(char)) {
        cleaned.append(char)
      } else if (char.isWhitespace()) {
        cleaned.append(' ')
      }
      // Drop unknown symbols rather than replacing with space (avoids long silent runs)
    }
    // Collapse repeated spaces
    return cleaned.toString().replace(Regex("\\s+"), " ").trim()
  }

  @ReactMethod
  fun synthesize(text: String, outputPath: String, promise: Promise) {
    Thread {
      try {
        if (text.isBlank()) {
          promise.reject("TTS_SYNTH_ERROR", "Cannot synthesize empty text")
          return@Thread
        }

        loadResourcesIfNeeded()

        val env = ortEnv ?: throw Exception("ONNX Runtime Environment not initialized.")
        val session = ortSession ?: throw Exception("ONNX Session not initialized.")
        if (styleMatrix == null) throw Exception("Style matrix not loaded.")

        val tokens = textToTokens(text)
        if (tokens.size <= 2) {
          Log.w("LafinaTTS", "No phoneme tokens produced from text: \"$text\"")
          promise.reject("TTS_SYNTH_ERROR", "No phoneme tokens produced from text")
          return@Thread
        }

        Log.d(
          "LafinaTTS",
          "Synthesizing ${tokens.size} tokens (incl pads) for: \"${text.take(60)}\""
        )

        val selectedStyle = selectStyleForTokenCount(tokens.size)
        val reshapedStyle = Array(1) { FloatArray(256) }
        System.arraycopy(selectedStyle, 0, reshapedStyle[0], 0, 256)

        val reshapedTokens = Array(1) { LongArray(tokens.size) }
        System.arraycopy(tokens, 0, reshapedTokens[0], 0, tokens.size)

        val tokenTensor = OnnxTensor.createTensor(env, reshapedTokens)
        val styleTensor = OnnxTensor.createTensor(env, reshapedStyle)
        val speedTensor = OnnxTensor.createTensor(env, floatArrayOf(1.0f))

        val inputs = mutableMapOf<String, OnnxTensor>()
        try {
          for ((name, nodeInfo) in session.inputInfo) {
            Log.d("LafinaTTS", "Configuring input: $name")
            when (name) {
              "input_ids", "tokens" -> inputs[name] = tokenTensor
              "style" -> inputs[name] = styleTensor
              "speed" -> {
                val valueInfo = nodeInfo.info
                if (valueInfo is ai.onnxruntime.TensorInfo) {
                  inputs[name] = when (valueInfo.type) {
                    ai.onnxruntime.OnnxJavaType.INT32 ->
                      OnnxTensor.createTensor(env, intArrayOf(1))
                    ai.onnxruntime.OnnxJavaType.INT64 ->
                      OnnxTensor.createTensor(env, longArrayOf(1L))
                    else -> speedTensor
                  }
                } else {
                  inputs[name] = speedTensor
                }
              }
            }
          }

          if (!inputs.containsKey("tokens") && !inputs.containsKey("input_ids")) {
            throw Exception("ONNX model is missing tokens/input_ids input")
          }
          if (!inputs.containsKey("style")) {
            throw Exception("ONNX model is missing style input")
          }
          if (!inputs.containsKey("speed")) {
            inputs["speed"] = speedTensor
          }

          session.run(inputs).use { results ->
            val outputTensor = results[0] as OnnxTensor
            val outputBuffer = outputTensor.floatBuffer
            val outputLength = outputBuffer.remaining()

            if (outputLength == 0) {
              Log.e("LafinaTTS", "ONNX model returned empty audio output")
              promise.reject("TTS_SYNTH_ERROR", "ONNX model returned empty audio")
              return@use
            }

            Log.d(
              "LafinaTTS",
              "ONNX output: $outputLength samples (shape: ${outputTensor.info.shape.toList()})"
            )

            val audioData = FloatArray(outputLength)
            outputBuffer.get(audioData)

            var peak = 0f
            var sumAbs = 0.0
            for (sample in audioData) {
              val a = kotlin.math.abs(sample)
              sumAbs += a
              if (a > peak) peak = a
            }
            val meanAbs = sumAbs / audioData.size
            Log.d("LafinaTTS", "Audio stats: peak=$peak meanAbs=$meanAbs")

            if (peak < 1e-4f) {
              promise.reject("TTS_SYNTH_ERROR", "Synthesized audio is silent (peak≈0)")
              return@use
            }

            // Soft gain so quiet model output is still audible on device speakers
            val gain = if (peak in 0.01f..0.35f) (0.7f / peak).coerceAtMost(4.0f) else 1.0f
            if (gain != 1.0f) {
              for (i in audioData.indices) {
                audioData[i] = (audioData[i] * gain).coerceIn(-1.0f, 1.0f)
              }
              Log.d("LafinaTTS", "Applied playback gain=$gain")
            }

            writeWavFile(audioData, outputPath)
            val written = File(outputPath)
            if (!written.exists() || written.length() <= 44L) {
              promise.reject("TTS_SYNTH_ERROR", "WAV file was not written correctly: $outputPath")
              return@use
            }

            Log.d("LafinaTTS", "WAV file written to $outputPath (${written.length()} bytes)")
            promise.resolve(true)
          }
        } finally {
          try {
            tokenTensor.close()
          } catch (_: Exception) {
          }
          try {
            styleTensor.close()
          } catch (_: Exception) {
          }
          // speedTensor may be shared as inputs["speed"] — close only if still open
          try {
            speedTensor.close()
          } catch (_: Exception) {
          }
        }
      } catch (e: Exception) {
        Log.e("LafinaTTS", "Synthesis failed for text: \"${text.take(80)}\"", e)
        promise.reject("TTS_SYNTH_ERROR", e.message, e)
      }
    }.start()
  }

  @ReactMethod
  fun playAudio(filePath: String, promise: Promise) {
    reactContext.runOnUiQueueThread {
      try {
        val audioFile = File(filePath)
        if (!audioFile.exists() || audioFile.length() <= 44L) {
          Log.e("LafinaTTS", "Audio file missing or empty: $filePath (exists=${audioFile.exists()}, len=${if (audioFile.exists()) audioFile.length() else -1})")
          promise.reject("PLAY_ERROR", "Audio file missing or empty: $filePath")
          return@runOnUiQueueThread
        }

        Log.d("LafinaTTS", "Playing audio: $filePath (${audioFile.length()} bytes)")

        // Settle any previous bridge call before starting the new playback owner.
        interruptActivePlayback()

        val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        requestPlaybackFocus(audioManager)

        val mp = MediaPlayer()
        activeMediaPlayer = mp
        activePlaybackPromise = promise

        val attrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        mp.setAudioAttributes(attrs)
        mp.setVolume(1.0f, 1.0f)
        mp.setDataSource(filePath)
        mp.setOnPreparedListener { player ->
          try {
            // Prefer loudspeaker for reminder / test playback (not earpiece)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
              audioManager.mode = AudioManager.MODE_NORMAL
            }
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = true
            player.start()
            Log.d("LafinaTTS", "MediaPlayer started, duration=${player.duration}ms")
            if (player.duration <= 0) {
              Log.w("LafinaTTS", "MediaPlayer reports zero duration for $filePath")
            }
          } catch (e: Exception) {
            Log.e("LafinaTTS", "MediaPlayer start failed", e)
            releasePlayer(player)
            val failedPromise = if (activeMediaPlayer == player) activePlaybackPromise else null
            if (activeMediaPlayer == player) {
              activeMediaPlayer = null
              activePlaybackPromise = null
            }
            abandonPlaybackFocus(audioManager)
            failedPromise?.reject("PLAY_ERROR", e.message, e)
          }
        }
        mp.setOnCompletionListener { player ->
          Log.d("LafinaTTS", "Audio playback completed: $filePath")
          releasePlayer(player)
          val completion = if (activeMediaPlayer == player) activePlaybackPromise else null
          if (activeMediaPlayer == player) {
            activeMediaPlayer = null
            activePlaybackPromise = null
          }
          abandonPlaybackFocus(audioManager)
          completion?.resolve(true)
        }
        mp.setOnErrorListener { player, what, extra ->
          Log.e("LafinaTTS", "MediaPlayer error: what=$what, extra=$extra, file=$filePath")
          releasePlayer(player)
          val failedPromise = if (activeMediaPlayer == player) activePlaybackPromise else null
          if (activeMediaPlayer == player) {
            activeMediaPlayer = null
            activePlaybackPromise = null
          }
          abandonPlaybackFocus(audioManager)
          failedPromise?.reject("PLAY_ERROR", "MediaPlayer error: what=$what, extra=$extra")
          true
        }
        mp.prepareAsync()
      } catch (e: Exception) {
        Log.e("LafinaTTS", "playAudio failed for $filePath", e)
        val failedPromise = activePlaybackPromise
        releasePlayer(activeMediaPlayer)
        activeMediaPlayer = null
        activePlaybackPromise = null
        if (failedPromise != null) {
          failedPromise.reject("PLAY_ERROR", e.message, e)
        } else {
          promise.reject("PLAY_ERROR", e.message, e)
        }
      }
    }
  }

  @ReactMethod
  fun stopAudio(promise: Promise) {
    reactContext.runOnUiQueueThread {
      interruptActivePlayback()
      promise.resolve(true)
    }
  }

  private fun interruptActivePlayback() {
    val interruptedPromise = activePlaybackPromise
    releasePlayer(activeMediaPlayer)
    activeMediaPlayer = null
    activePlaybackPromise = null
    val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    abandonPlaybackFocus(audioManager)
    interruptedPromise?.resolve(false)
  }

  private fun releasePlayer(player: MediaPlayer?) {
    player?.let {
      try {
        if (it.isPlaying) it.stop()
      } catch (_: Exception) {
      }
      try {
        it.release()
      } catch (_: Exception) {
      }
    }
  }

  /**
   * Requests exclusive transient audio focus for a simulated phone call.
   *
   * DUCK was wrong here: Spotify or YouTube kept playing at reduced volume during
   * the reminder call, so the student heard music under LAFINA's prompt and the
   * bleed could reach the microphone and corrupt the Whisper transcript. Exclusive
   * focus pauses the other app for the duration of the call, like a real call.
   */
  private fun requestPlaybackFocus(audioManager: AudioManager) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val attrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
          .setAudioAttributes(attrs)
          .setOnAudioFocusChangeListener { focusChange -> handleFocusChange(focusChange) }
          .build()
        audioFocusRequest = request
        audioManager.requestAudioFocus(request)
      } else {
        @Suppress("DEPRECATION")
        audioManager.requestAudioFocus(
          { focusChange -> handleFocusChange(focusChange) },
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
        )
      }
    } catch (e: Exception) {
      Log.w("LafinaTTS", "Audio focus request failed (continuing anyway)", e)
    }
  }

  private fun abandonPlaybackFocus(audioManager: AudioManager) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        audioFocusRequest = null
      } else {
        @Suppress("DEPRECATION")
        audioManager.abandonAudioFocus(null)
      }
    } catch (e: Exception) {
      Log.w("LafinaTTS", "Abandon audio focus failed", e)
    }
  }

  private fun writeWavFile(audioData: FloatArray, path: String) {
    val file = File(path)
    if (file.exists()) file.delete()
    file.parentFile?.mkdirs()

    val sampleRate = 24000
    val channels = 1
    val bitsPerSample = 16

    val pcmData = ShortArray(audioData.size)
    for (i in audioData.indices) {
      val clamped = Math.max(-1.0f, Math.min(1.0f, audioData[i]))
      pcmData[i] = (clamped * Short.MAX_VALUE).toInt().toShort()
    }

    FileOutputStream(file).use { out ->
      val header = ByteArray(44)
      val totalDataLen = pcmData.size * 2
      val totalAudioLen = totalDataLen + 36

      header[0] = 'R'.code.toByte()
      header[1] = 'I'.code.toByte()
      header[2] = 'F'.code.toByte()
      header[3] = 'F'.code.toByte()
      header[4] = (totalAudioLen and 0xff).toByte()
      header[5] = ((totalAudioLen shr 8) and 0xff).toByte()
      header[6] = ((totalAudioLen shr 16) and 0xff).toByte()
      header[7] = ((totalAudioLen shr 24) and 0xff).toByte()
      header[8] = 'W'.code.toByte()
      header[9] = 'A'.code.toByte()
      header[10] = 'V'.code.toByte()
      header[11] = 'E'.code.toByte()
      header[12] = 'f'.code.toByte()
      header[13] = 'm'.code.toByte()
      header[14] = 't'.code.toByte()
      header[15] = ' '.code.toByte()
      header[16] = 16
      header[17] = 0
      header[18] = 0
      header[19] = 0
      header[20] = 1
      header[21] = 0
      header[22] = channels.toByte()
      header[23] = 0
      header[24] = (sampleRate and 0xff).toByte()
      header[25] = ((sampleRate shr 8) and 0xff).toByte()
      header[26] = ((sampleRate shr 16) and 0xff).toByte()
      header[27] = ((sampleRate shr 24) and 0xff).toByte()
      header[28] = ((sampleRate * channels * 2) and 0xff).toByte()
      header[29] = (((sampleRate * channels * 2) shr 8) and 0xff).toByte()
      header[30] = (((sampleRate * channels * 2) shr 16) and 0xff).toByte()
      header[31] = (((sampleRate * channels * 2) shr 24) and 0xff).toByte()
      header[32] = (channels * 2).toByte()
      header[33] = 0
      header[34] = bitsPerSample.toByte()
      header[35] = 0
      header[36] = 'd'.code.toByte()
      header[37] = 'a'.code.toByte()
      header[38] = 't'.code.toByte()
      header[39] = 'a'.code.toByte()
      header[40] = (totalDataLen and 0xff).toByte()
      header[41] = ((totalDataLen shr 8) and 0xff).toByte()
      header[42] = ((totalDataLen shr 16) and 0xff).toByte()
      header[43] = ((totalDataLen shr 24) and 0xff).toByte()

      out.write(header)

      val byteBuffer = ByteBuffer.allocate(totalDataLen).order(ByteOrder.LITTLE_ENDIAN)
      for (sample in pcmData) {
        byteBuffer.putShort(sample)
      }
      out.write(byteBuffer.array())
    }
  }

  companion object {
    /**
     * Must stay in sync with EXTERNAL_AUDIO_INTERRUPTION_EVENT in
     * src/scheduler/reminderAlarm.ts.
     */
    private const val EVENT_EXTERNAL_AUDIO_INTERRUPTED = "LAFINA_EXTERNAL_AUDIO_INTERRUPTED"
  }
}
