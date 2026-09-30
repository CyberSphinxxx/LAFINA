package com.lafina

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.FileInputStream
import java.lang.ref.WeakReference
import java.security.KeyFactory
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The native half of in-app updates: signature checks, the downloads, the
 * restart that puts a downloaded bundle into use, and — for a release that
 * changes native code — installing the new APK through Android's package
 * installer. Deciding *whether* to update lives in `src/updates/` on the JS
 * side; see [OtaBundles] for how downloads are kept.
 */
class LafinaUpdaterModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val worker = Executors.newSingleThreadExecutor()
  private val downloading = AtomicBoolean(false)
  private val cancelled = AtomicBoolean(false)

  init {
    active = WeakReference(this)
  }

  override fun getName(): String = "LafinaUpdater"

  @ReactMethod
  fun getInfo(promise: Promise) {
    try {
      val info = OtaBundles.info(reactContext)
      val map = Arguments.createMap().apply {
        putInt("nativeVersionCode", BuildConfig.VERSION_CODE)
        putString("nativeVersionName", BuildConfig.VERSION_NAME)
        putBoolean("isDebug", BuildConfig.DEBUG)
        putString("runningVersion", OtaBundles.runningVersion)
        putString("pendingVersion", info.pendingVersion)
        putArray("rejectedVersions", Arguments.fromList(info.rejected))
        OtaBundles.readyApkVersionCode(reactContext)?.let { putInt("readyApkVersionCode", it) }
      }
      promise.resolve(map)
    } catch (error: Exception) {
      promise.reject("E_INFO", error.message, error)
    }
  }

  /**
   * Checks an ECDSA P-256 / SHA-256 signature over the manifest's bytes with
   * the release public key, and returns those bytes as text only when it holds.
   */
  @ReactMethod
  fun verifyManifest(payloadBase64: String, signatureBase64: String, publicKeyBase64: String, promise: Promise) {
    try {
      val key = KeyFactory.getInstance("EC")
        .generatePublic(X509EncodedKeySpec(Base64.decode(publicKeyBase64, Base64.DEFAULT)))
      if (key !is ECPublicKey || key.params.curve.field.fieldSize != 256) {
        promise.reject("E_KEY", "The update signing key must be an ECDSA P-256 key.")
        return
      }
      val payload = Base64.decode(payloadBase64, Base64.DEFAULT)
      val verifier = Signature.getInstance("SHA256withECDSA")
      verifier.initVerify(key)
      verifier.update(payload)
      if (!verifier.verify(Base64.decode(signatureBase64, Base64.DEFAULT))) {
        promise.reject("E_SIGNATURE", "bad signature")
        return
      }
      promise.resolve(String(payload, Charsets.UTF_8))
    } catch (error: Exception) {
      // A malformed key, payload or signature is refused the same way as a wrong one.
      promise.reject("E_SIGNATURE", "bad signature")
    }
  }

  @ReactMethod
  fun downloadBundle(options: ReadableMap, promise: Promise) {
    if (!downloading.compareAndSet(false, true)) {
      promise.reject("E_BUSY", "An update is already downloading.")
      return
    }
    cancelled.set(false)
    val url = options.getString("url") ?: ""
    val version = options.getString("version") ?: ""
    val nativeVersionCode = options.getInt("nativeVersionCode")
    // JS numbers arrive as doubles; sizes are far below where that loses precision.
    val size = options.getDouble("size").toLong()
    val sha256 = options.getString("sha256") ?: ""

    worker.execute {
      try {
        OtaBundles.download(
          context = reactContext,
          url = url,
          version = version,
          nativeVersionCode = nativeVersionCode,
          size = size,
          sha256 = sha256,
          isCancelled = { cancelled.get() },
          onProgress = { received, total -> emitProgress(received, total) },
        )
        promise.resolve(true)
      } catch (error: OtaBundles.OtaException) {
        promise.reject(error.code, error.message, error)
      } catch (error: Exception) {
        promise.reject("E_DOWNLOAD", "The update could not be saved. Try again.", error)
      } finally {
        downloading.set(false)
      }
    }
  }

  /** Downloads the APK of a newer native build; see [OtaBundles.downloadApk]. */
  @ReactMethod
  fun downloadApk(options: ReadableMap, promise: Promise) {
    if (!downloading.compareAndSet(false, true)) {
      promise.reject("E_BUSY", "An update is already downloading.")
      return
    }
    cancelled.set(false)
    val url = options.getString("url") ?: ""
    val versionCode = options.getInt("versionCode")
    val size = options.getDouble("size").toLong()
    val sha256 = options.getString("sha256") ?: ""

    worker.execute {
      try {
        OtaBundles.downloadApk(
          context = reactContext,
          url = url,
          versionCode = versionCode,
          size = size,
          sha256 = sha256,
          isCancelled = { cancelled.get() },
          onProgress = { received, total -> emitProgress(received, total) },
        )
        promise.resolve(true)
      } catch (error: OtaBundles.OtaException) {
        promise.reject(error.code, error.message, error)
      } catch (error: Exception) {
        promise.reject("E_DOWNLOAD", "The update could not be saved. Try again.", error)
      } finally {
        downloading.set(false)
      }
    }
  }

  /**
   * Whether Android lets LAFINA install its own updates. It asks once, per app,
   * in its settings ("Install unknown apps"); nothing can grant it silently.
   */
  @ReactMethod
  fun canInstallApks(promise: Promise) {
    promise.resolve(reactContext.packageManager.canRequestPackageInstalls())
  }

  /** Opens LAFINA's "Install unknown apps" setting for the person to turn on. */
  @ReactMethod
  fun openInstallPermissionSettings(promise: Promise) {
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${reactContext.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      (reactContext.currentActivity ?: reactContext).startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_SETTINGS", "The install setting could not be opened.", error)
    }
  }

  /**
   * Hands the downloaded APK to Android's package installer, which shows its
   * own "update this app?" confirmation (and, once LAFINA has installed an
   * update itself, may not need to ask again). Android also refuses an APK not
   * signed with the same key as the installed app. The result arrives through
   * [LafinaApkInstallReceiver] as a `LafinaUpdaterInstallStatus` event.
   */
  @ReactMethod
  fun installApk(options: ReadableMap, promise: Promise) {
    val versionCode = options.getInt("versionCode")
    val sha256 = options.getString("sha256") ?: ""
    worker.execute {
      try {
        // Checked again right before it is installed, in case it changed on disk since.
        val apk = OtaBundles.verifiedApk(reactContext, versionCode, sha256)
        if (apk == null) {
          promise.reject("E_VERIFY", "The downloaded update is missing or changed on disk, so it was not installed. Check for updates again.")
          return@execute
        }
        if (!reactContext.packageManager.canRequestPackageInstalls()) {
          promise.reject("E_PERMISSION", "Allow LAFINA to install updates first.")
          return@execute
        }
        val installer = reactContext.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
          setAppPackageName(reactContext.packageName)
          setSize(apk.length())
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
          }
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
          session.openWrite("lafina.apk", 0, apk.length()).use { output ->
            FileInputStream(apk).use { input -> input.copyTo(output, 1024 * 1024) }
            session.fsync(output)
          }
          val status = PendingIntent.getBroadcast(
            reactContext,
            sessionId,
            Intent(reactContext, LafinaApkInstallReceiver::class.java).setPackage(reactContext.packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
          )
          session.commit(status.intentSender)
        }
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("E_INSTALL", "Android could not start installing the update: ${error.message}", error)
      }
    }
  }

  @ReactMethod
  fun cancelDownload() {
    cancelled.set(true)
  }

  @ReactMethod
  fun markLaunchSuccessful(promise: Promise) {
    try {
      promise.resolve(OtaBundles.markLaunchSuccessful(reactContext))
    } catch (error: Exception) {
      promise.reject("E_CONFIRM", error.message, error)
    }
  }

  /**
   * Restarts the app so the staged bundle starts. A small activity in its own
   * process ends this one and opens LAFINA again, the way ProcessPhoenix does:
   * a process cannot reliably relaunch itself on its way out.
   */
  @ReactMethod
  fun restart(promise: Promise) {
    try {
      val intent = Intent(reactContext, LafinaRestartActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        .putExtra(LafinaRestartActivity.EXTRA_PID, Process.myPid())
      val activity = reactContext.currentActivity
      if (activity != null) activity.startActivity(intent) else reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_RESTART", "LAFINA could not restart itself. Close and reopen the app to finish the update.", error)
    }
  }

  internal fun emitInstallStatus(status: String, message: String?) {
    if (!reactContext.hasActiveReactInstance()) return
    val payload = Arguments.createMap().apply {
      putString("status", status)
      putString("message", message)
    }
    reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_INSTALL_STATUS, payload)
  }

  private fun emitProgress(received: Long, total: Long) {
    if (!reactContext.hasActiveReactInstance()) return
    val payload = Arguments.createMap().apply {
      putDouble("received", received.toDouble())
      putDouble("total", total.toDouble())
    }
    reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_PROGRESS, payload)
  }

  override fun invalidate() {
    cancelled.set(true)
    worker.shutdown()
    super.invalidate()
  }

  companion object {
    const val EVENT_PROGRESS = "LafinaUpdaterProgress"
    const val EVENT_INSTALL_STATUS = "LafinaUpdaterInstallStatus"

    /** The live module, for the install receiver to report through. */
    private var active: WeakReference<LafinaUpdaterModule>? = null

    fun reportInstallStatus(status: String, message: String?) {
      active?.get()?.emitInstallStatus(status, message)
    }
  }
}
