package com.lafina

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.animation.PathInterpolator
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlin.math.hypot
import kotlin.math.max

/**
 * The circular reveal for theme changes, as on the desktop app.
 *
 * [capture] copies what is on screen and lays it over the whole window, so
 * the switch of theme underneath is hidden. [reveal] then opens a circle in
 * that copy from where the person tapped, growing until the new theme covers
 * the window, and removes the copy. A copy that is never told to reveal
 * clears itself after [SAFETY_MS], so the app can never be left covered.
 */
class LafinaThemeRevealModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val main = Handler(Looper.getMainLooper())
  private var overlay: RevealOverlay? = null

  override fun getName(): String = "LafinaThemeReveal"

  /**
   * [x] and [y] are where the reveal starts, in dp from the top left of the
   * React root view (a touch's pageX and pageY); negative means the middle.
   */
  @ReactMethod
  fun capture(x: Double, y: Double, promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    main.post {
      try {
        val window = activity.window
        val decor = window.decorView as? ViewGroup
        if (decor == null || decor.width <= 0 || decor.height <= 0) {
          promise.resolve(false)
          return@post
        }
        val density = decor.resources.displayMetrics.density
        val content = IntArray(2)
        activity.findViewById<View>(android.R.id.content)?.getLocationInWindow(content)
        val cx = if (x >= 0) content[0] + (x * density).toFloat() else decor.width / 2f
        val cy = if (y >= 0) content[1] + (y * density).toFloat() else decor.height / 2f

        val snapshot = Bitmap.createBitmap(decor.width, decor.height, Bitmap.Config.ARGB_8888)
        // PixelCopy reads what the window actually shows, including views drawn
        // on their own surfaces, which drawing the view tree into a canvas misses.
        PixelCopy.request(window, snapshot, { result ->
          if (result != PixelCopy.SUCCESS || !decor.isAttachedToWindow) {
            promise.resolve(false)
            return@request
          }
          val previous = overlay
          val next = RevealOverlay(activity, snapshot, cx, cy)
          decor.addView(next, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
          // A toggle during a reveal: the new copy already shows it mid-way.
          previous?.remove()
          overlay = next
          next.postDelayed({ next.reveal { if (overlay === next) overlay = null } }, SAFETY_MS)
          promise.resolve(true)
        }, main)
      } catch (error: Exception) {
        promise.resolve(false)
      }
    }
  }

  /** The new theme is in place underneath: open the circle. */
  @ReactMethod
  fun reveal(promise: Promise) {
    main.post {
      val current = overlay
      if (current == null) {
        promise.resolve(false)
        return@post
      }
      current.reveal { if (overlay === current) overlay = null }
      promise.resolve(true)
    }
  }

  @SuppressLint("ViewConstructor")
  private class RevealOverlay(
    context: Context,
    private val snapshot: Bitmap,
    private val cx: Float,
    private val cy: Float,
  ) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = BitmapShader(snapshot, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    }
    private val path = Path()
    private var radius = 0f
    private var started = false
    private var animator: ValueAnimator? = null

    init {
      // Swallows taps for the half second it is up, so nothing is pressed through the old picture.
      isClickable = true
      importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }

    override fun onDraw(canvas: Canvas) {
      if (radius <= 0f) {
        canvas.drawBitmap(snapshot, 0f, 0f, null)
        return
      }
      // The old picture everywhere except inside the circle; anti-aliased, unlike a clip.
      path.rewind()
      path.fillType = Path.FillType.EVEN_ODD
      path.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
      path.addCircle(cx, cy, radius, Path.Direction.CW)
      canvas.drawPath(path, paint)
    }

    fun reveal(onDone: () -> Unit) {
      if (started) return
      started = true
      // Two frames first, so the new theme has been laid out and drawn underneath.
      postOnAnimation {
        postOnAnimation {
          if (!isAttachedToWindow) {
            onDone()
            return@postOnAnimation
          }
          val maxRadius = hypot(max(cx, width - cx), max(cy, height - cy))
          animator = ValueAnimator.ofFloat(0f, maxRadius).apply {
            duration = DURATION_MS
            interpolator = PathInterpolator(0.4f, 0f, 0.2f, 1f)
            addUpdateListener {
              radius = it.animatedValue as Float
              invalidate()
            }
            addListener(object : AnimatorListenerAdapter() {
              override fun onAnimationEnd(animation: Animator) {
                remove()
                onDone()
              }
            })
            start()
          }
        }
      }
    }

    fun remove() {
      animator?.removeAllListeners()
      animator?.cancel()
      (parent as? ViewGroup)?.removeView(this)
    }
  }

  companion object {
    /** As on the desktop (`THEME_SWEEP_MS`). The system's animation scale applies, so "Remove animations" skips it. */
    private const val DURATION_MS = 500L
    private const val SAFETY_MS = 1500L
  }
}
