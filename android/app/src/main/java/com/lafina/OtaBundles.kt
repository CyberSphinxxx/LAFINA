package com.lafina

import android.content.Context
import android.os.StatFs
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.zip.ZipFile

/**
 * Over-the-air JavaScript updates: where they live, which one starts, and how
 * one arrives.
 *
 * A release carries the app's JavaScript bundle and images in a zip. Once the
 * JS side has checked the release's signed manifest, the zip is downloaded
 * here, checked against the signed size and SHA-256, and unpacked into
 * `files/ota/`. It is only *staged* then: [resolveBundlePath] picks it up the
 * next time the app starts, before React Native loads any JavaScript.
 *
 * A bundle has one launch to prove itself. JS confirms it with
 * [markLaunchSuccessful] once startup has finished; a bundle that is about to
 * start a second time unconfirmed is assumed to crash, is rolled back to the
 * one before it, and is never offered again. A new APK brings its own bundle,
 * so every downloaded one is dropped as soon as the installed APK changes.
 */
object OtaBundles {
  private const val TAG = "LafinaOta"
  private const val ROOT = "ota"
  private const val STATE_FILE = "state.json"
  private const val DOWNLOAD_FILE = "download.part"
  const val BUNDLE_FILE = "index.android.bundle"
  /** Downloaded APKs for a newer native build, kept until installed or superseded. */
  private const val APK_DIR = "apk"
  /** GitHub's limit for one release asset; the app APK is well under it. */
  private const val MAX_APK_BYTES = 2L * 1024 * 1024 * 1024

  /** Far above a real bundle, low enough that a hostile archive cannot fill the phone. */
  private const val MAX_EXTRACTED_BYTES = 300L * 1024 * 1024
  private const val MAX_ENTRIES = 2_000
  private const val CONNECT_TIMEOUT_MS = 20_000
  /** A download that has not received a byte for this long is treated as dropped. */
  private const val READ_TIMEOUT_MS = 60_000
  private const val MAX_REJECTED = 20

  /** The OTA version this process started with, or null for the APK's own bundle. */
  @Volatile
  var runningVersion: String? = null
    private set

  class OtaException(val code: String, message: String) : Exception(message)

  private data class Bundle(
    val version: String,
    val dir: String,
    val nativeVersionCode: Int,
    val apkUpdateTime: Long,
    var confirmed: Boolean,
    var launches: Int,
  ) {
    fun toJson(): JSONObject = JSONObject()
      .put("version", version)
      .put("dir", dir)
      .put("nativeVersionCode", nativeVersionCode)
      .put("apkUpdateTime", apkUpdateTime)
      .put("confirmed", confirmed)
      .put("launches", launches)

    companion object {
      fun fromJson(json: JSONObject?): Bundle? {
        if (json == null) return null
        return try {
          Bundle(
            version = json.getString("version"),
            dir = json.getString("dir"),
            nativeVersionCode = json.getInt("nativeVersionCode"),
            apkUpdateTime = json.getLong("apkUpdateTime"),
            confirmed = json.optBoolean("confirmed", false),
            launches = json.optInt("launches", 0),
          )
        } catch (error: Exception) {
          null
        }
      }
    }
  }

  private class State(
    var current: Bundle? = null,
    var previous: Bundle? = null,
    var pending: Bundle? = null,
    val rejected: MutableList<String> = mutableListOf(),
  )

  private val lock = Any()

  private fun root(context: Context): File = File(context.filesDir, ROOT)

  private fun dirOf(context: Context, bundle: Bundle): File = File(root(context), bundle.dir)

  private fun apkUpdateTime(context: Context): Long =
    context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime

  private fun readState(context: Context): State {
    val file = File(root(context), STATE_FILE)
    if (!file.isFile) return State()
    return try {
      val json = JSONObject(file.readText())
      val rejected = json.optJSONArray("rejected")
      State(
        current = Bundle.fromJson(json.optJSONObject("current")),
        previous = Bundle.fromJson(json.optJSONObject("previous")),
        pending = Bundle.fromJson(json.optJSONObject("pending")),
        rejected = MutableList(rejected?.length() ?: 0) { index -> rejected!!.getString(index) },
      )
    } catch (error: Exception) {
      Log.w(TAG, "Unreadable update state; starting from the APK's bundle", error)
      State()
    }
  }

  private fun writeState(context: Context, state: State) {
    val dir = root(context)
    dir.mkdirs()
    val json = JSONObject()
      .put("current", state.current?.toJson() ?: JSONObject.NULL)
      .put("previous", state.previous?.toJson() ?: JSONObject.NULL)
      .put("pending", state.pending?.toJson() ?: JSONObject.NULL)
      .put("rejected", JSONArray(state.rejected.takeLast(MAX_REJECTED)))
    // Written beside the real file and renamed over it, so a crash mid-write
    // never leaves a half-written state to start from.
    val temp = File(dir, "$STATE_FILE.tmp")
    temp.writeText(json.toString())
    if (!temp.renameTo(File(dir, STATE_FILE))) {
      File(dir, STATE_FILE).delete()
      temp.renameTo(File(dir, STATE_FILE))
    }
  }

  /**
   * The bundle this launch should run, or null for the one inside the APK.
   * Called once per process, when React Native is created. Never throws: any
   * trouble falls back to the APK's own bundle.
   */
  fun resolveBundlePath(context: Context): String? {
    // Development builds load JavaScript from Metro.
    if (BuildConfig.DEBUG) return null
    return try {
      synchronized(lock) { resolve(context) }
    } catch (error: Exception) {
      Log.e(TAG, "Could not choose an update bundle; using the APK's", error)
      null
    }
  }

  private fun resolve(context: Context): String? {
    val state = readState(context)
    val apkTime = apkUpdateTime(context)
    val fits = { bundle: Bundle ->
      bundle.nativeVersionCode == BuildConfig.VERSION_CODE &&
        bundle.apkUpdateTime == apkTime &&
        File(dirOf(context, bundle), BUNDLE_FILE).isFile
    }

    // A download finished since the last start: it becomes the current bundle.
    state.pending?.let { staged ->
      state.pending = null
      if (fits(staged)) {
        state.previous = state.current?.takeIf { it.confirmed }
        state.current = staged.copy(confirmed = false, launches = 0)
      }
    }

    // A new APK brings its own bundle; ones built for the old APK no longer fit.
    if (state.current?.let(fits) == false) state.current = null
    if (state.previous?.let(fits) == false) state.previous = null

    // A bundle that never confirmed its last launch is assumed to crash on start.
    val trial = state.current
    if (trial != null && !trial.confirmed && trial.launches >= 1) {
      Log.w(TAG, "Update ${trial.version} did not finish starting last time; rolling back")
      if (!state.rejected.contains(trial.version)) state.rejected.add(trial.version)
      state.current = state.previous
      state.previous = null
    }

    state.current?.let { active -> if (!active.confirmed) active.launches += 1 }
    writeState(context, state)
    removeUnused(context, state)

    val active = state.current ?: return null
    runningVersion = active.version
    return File(dirOf(context, active), BUNDLE_FILE).absolutePath
  }

  /** Deletes bundle folders and partial downloads nothing refers to any more. */
  private fun removeUnused(context: Context, state: State) {
    val keep = listOfNotNull(state.current, state.previous, state.pending).map { it.dir }.toSet() + APK_DIR
    root(context).listFiles()?.forEach { file ->
      if (file.isDirectory && file.name !in keep) file.deleteRecursively()
      if (file.isFile && file.name == DOWNLOAD_FILE) file.delete()
    }
    pruneApks(context)
  }

  // ── APKs for a newer native build ─────────────────────────────────────────

  private fun apkDir(context: Context): File = File(root(context), APK_DIR)

  private fun apkFile(context: Context, versionCode: Int): File =
    File(apkDir(context), "lafina-$versionCode.apk")

  private fun apkVersionOf(file: File): Int? =
    Regex("""^lafina-(\d+)\.apk$""").find(file.name)?.groupValues?.get(1)?.toIntOrNull()

  /** Drops APKs already installed (or older), and any download that did not finish. */
  private fun pruneApks(context: Context) {
    apkDir(context).listFiles()?.forEach { file ->
      val versionCode = apkVersionOf(file)
      if (versionCode == null || versionCode <= BuildConfig.VERSION_CODE) file.delete()
    }
  }

  /** The newest fully downloaded APK for a build above this one, or null. */
  fun readyApkVersionCode(context: Context): Int? =
    apkDir(context).listFiles()
      ?.mapNotNull { apkVersionOf(it) }
      ?.filter { it > BuildConfig.VERSION_CODE }
      ?.maxOrNull()

  private fun checkedUrl(url: String): URL {
    val parsed = try {
      URL(url)
    } catch (error: Exception) {
      throw OtaException("E_VERIFY", "The update has an invalid address.")
    }
    if (parsed.protocol != "https" || parsed.host != "github.com") {
      throw OtaException("E_VERIFY", "Updates are only downloaded from GitHub over HTTPS.")
    }
    return parsed
  }

  private fun sha256Of(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(1024 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  /**
   * Downloads the APK of a newer native build, checked against the signed
   * size and SHA-256 before it is kept. Installing it is a separate step
   * (`LafinaUpdaterModule.installApk`), because Android asks the person first.
   */
  fun downloadApk(
    context: Context,
    url: String,
    versionCode: Int,
    size: Long,
    sha256: String,
    isCancelled: () -> Boolean,
    onProgress: (received: Long, total: Long) -> Unit,
  ) {
    if (versionCode <= BuildConfig.VERSION_CODE) {
      throw OtaException("E_INCOMPATIBLE", "This phone already has this version of the app or a newer one.")
    }
    if (size <= 0 || size > MAX_APK_BYTES) {
      throw OtaException("E_VERIFY", "The update has an invalid size, so it was not downloaded.")
    }
    val parsed = checkedUrl(url)
    val dir = apkDir(context)
    dir.mkdirs()
    // The download, plus the copy Android's installer makes of it.
    val needed = size * 2 + 100L * 1024 * 1024
    if (StatFs(dir.absolutePath).availableBytes < needed) {
      throw OtaException(
        "E_STORAGE",
        "The update needs about ${needed / 1024 / 1024} MB free, and this phone does not have enough space.",
      )
    }
    val target = apkFile(context, versionCode)
    if (target.isFile && target.length() == size && sha256Of(target) == sha256) {
      onProgress(size, size)
      return
    }
    val partial = File(dir, "${target.name}.part")
    partial.delete()
    try {
      fetch(parsed, partial, size, sha256, isCancelled, onProgress)
      target.delete()
      if (!partial.renameTo(target)) {
        throw OtaException("E_DOWNLOAD", "The update could not be saved. Try again.")
      }
      // Only the newest download is worth keeping.
      dir.listFiles()?.forEach { if (it != target) it.delete() }
    } finally {
      partial.delete()
    }
  }

  /**
   * The downloaded APK, checked again right before it is handed to the
   * installer, in case it changed on disk since. Null when it is gone or no
   * longer matches.
   */
  fun verifiedApk(context: Context, versionCode: Int, sha256: String): File? {
    val file = apkFile(context, versionCode)
    if (!file.isFile) return null
    return if (sha256Of(file) == sha256) file else null
  }

  /** Startup finished on the current bundle; it is kept from now on. */
  fun markLaunchSuccessful(context: Context): Boolean = synchronized(lock) {
    val state = readState(context)
    val current = state.current ?: return@synchronized false
    if (current.version != runningVersion) return@synchronized false
    if (!current.confirmed) {
      current.confirmed = true
      current.launches = 0
      writeState(context, state)
    }
    true
  }

  data class Info(val pendingVersion: String?, val rejected: List<String>)

  fun info(context: Context): Info = synchronized(lock) {
    val state = readState(context)
    Info(state.pending?.version, state.rejected.toList())
  }

  /**
   * Downloads the release zip, checks it against the signed size and SHA-256,
   * and unpacks it as the pending bundle. Everything is checked before the
   * bundle is staged; any failure leaves the current bundle untouched.
   */
  fun download(
    context: Context,
    url: String,
    version: String,
    nativeVersionCode: Int,
    size: Long,
    sha256: String,
    isCancelled: () -> Boolean,
    onProgress: (received: Long, total: Long) -> Unit,
  ) {
    if (nativeVersionCode != BuildConfig.VERSION_CODE) {
      throw OtaException("E_INCOMPATIBLE", "This update was built for a different version of the app.")
    }
    if (size <= 0 || size > MAX_EXTRACTED_BYTES) {
      throw OtaException("E_VERIFY", "The update has an invalid size, so it was not downloaded.")
    }
    val parsed = checkedUrl(url)

    val dir = root(context)
    dir.mkdirs()
    // Room for the zip and everything in it at once.
    val free = StatFs(dir.absolutePath).availableBytes
    if (free < size * 4 + 20L * 1024 * 1024) {
      throw OtaException(
        "E_STORAGE",
        "The update needs about ${(size * 4) / 1024 / 1024} MB free, and this phone does not have enough space.",
      )
    }

    val partial = File(dir, DOWNLOAD_FILE)
    partial.delete()
    try {
      fetch(parsed, partial, size, sha256, isCancelled, onProgress)
      val staged = unpack(context, partial, version)
      synchronized(lock) {
        val state = readState(context)
        state.pending?.let { old -> File(dir, old.dir).deleteRecursively() }
        state.pending = Bundle(
          version = version,
          dir = staged.name,
          nativeVersionCode = nativeVersionCode,
          apkUpdateTime = apkUpdateTime(context),
          confirmed = false,
          launches = 0,
        )
        writeState(context, state)
      }
    } finally {
      partial.delete()
    }
  }

  private fun fetch(
    url: URL,
    destination: File,
    size: Long,
    sha256: String,
    isCancelled: () -> Boolean,
    onProgress: (received: Long, total: Long) -> Unit,
  ) {
    // GitHub answers with a redirect to its storage host; both are HTTPS, so it is followed.
    val connection = try {
      (url.openConnection() as HttpURLConnection).apply {
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        instanceFollowRedirects = true
        setRequestProperty("Accept", "application/octet-stream")
        setRequestProperty("User-Agent", "LAFINA-Android")
      }
    } catch (error: Exception) {
      throw OtaException("E_NETWORK", "Could not reach GitHub. Check the connection and try again.")
    }

    try {
      val status = try {
        connection.responseCode
      } catch (error: Exception) {
        throw OtaException("E_NETWORK", "Could not reach GitHub. Check the connection and try again.")
      }
      if (status != HttpURLConnection.HTTP_OK) {
        throw OtaException("E_NETWORK", "GitHub answered $status for the download. Try again later.")
      }
      if (connection.url.protocol != "https") {
        throw OtaException("E_VERIFY", "The download was redirected away from HTTPS, so it was stopped.")
      }

      val digest = MessageDigest.getInstance("SHA-256")
      var received = 0L
      var lastReport = 0L
      try {
        connection.inputStream.use { input ->
          FileOutputStream(destination).use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              if (isCancelled()) throw OtaException("E_CANCELLED", "The update was cancelled.")
              val read = input.read(buffer)
              if (read < 0) break
              received += read
              if (received > size) {
                throw OtaException("E_VERIFY", "The update was larger than its signed size, so it was discarded.")
              }
              digest.update(buffer, 0, read)
              output.write(buffer, 0, read)
              val now = System.currentTimeMillis()
              if (now - lastReport > 200) {
                lastReport = now
                onProgress(received, size)
              }
            }
          }
        }
      } catch (error: OtaException) {
        throw error
      } catch (error: Exception) {
        if (isCancelled()) throw OtaException("E_CANCELLED", "The update was cancelled.")
        throw OtaException("E_NETWORK", "The download stopped. Check the connection and try again.")
      }

      if (received != size) {
        throw OtaException("E_NETWORK", "The download ended early. Try again.")
      }
      val actual = digest.digest().joinToString("") { "%02x".format(it) }
      if (actual != sha256) {
        throw OtaException("E_VERIFY", "The update did not match its signed checksum, so it was discarded.")
      }
      onProgress(received, size)
    } finally {
      connection.disconnect()
    }
  }

  /** Unpacks into a fresh folder. Entries that would land outside it are refused. */
  private fun unpack(context: Context, zip: File, version: String): File {
    val safeVersion = version.replace(Regex("[^A-Za-z0-9.-]"), "_")
    val target = File(root(context), "b-$safeVersion-${System.currentTimeMillis()}")
    val targetPath = target.canonicalPath + File.separator
    target.mkdirs()
    try {
      ZipFile(zip).use { archive ->
        if (archive.size() > MAX_ENTRIES) throw OtaException("E_VERIFY", "The update has too many files.")
        var total = 0L
        for (entry in archive.entries()) {
          val out = File(target, entry.name)
          if (!out.canonicalPath.startsWith(targetPath)) {
            throw OtaException("E_VERIFY", "The update contains a file outside its folder, so it was discarded.")
          }
          if (entry.isDirectory) {
            out.mkdirs()
            continue
          }
          out.parentFile?.mkdirs()
          archive.getInputStream(entry).use { input ->
            FileOutputStream(out).use { output ->
              val buffer = ByteArray(64 * 1024)
              while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                if (total > MAX_EXTRACTED_BYTES) {
                  throw OtaException("E_VERIFY", "The update unpacks to more than it should, so it was discarded.")
                }
                output.write(buffer, 0, read)
              }
            }
          }
        }
      }
      if (!File(target, BUNDLE_FILE).isFile) {
        throw OtaException("E_VERIFY", "The update has no app bundle in it, so it was discarded.")
      }
      return target
    } catch (error: OtaException) {
      target.deleteRecursively()
      throw error
    } catch (error: Exception) {
      target.deleteRecursively()
      throw OtaException("E_VERIFY", "The update could not be unpacked, so it was discarded.")
    }
  }
}
