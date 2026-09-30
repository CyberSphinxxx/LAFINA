package com.lafina

import android.app.ActivityManager
import android.content.Context
import android.graphics.Color
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/** `<LafinaGrainientView>` for JS; see `src/ui/components/auth/Grainient.tsx`. */
class LafinaGrainientViewManager : SimpleViewManager<LafinaGrainientView>() {

  override fun getName(): String = "LafinaGrainientView"

  override fun createViewInstance(context: ThemedReactContext): LafinaGrainientView = LafinaGrainientView(context)

  /** Every prop of an update is in by now; the renderer gets them together. */
  override fun onAfterUpdateTransaction(view: LafinaGrainientView) {
    super.onAfterUpdateTransaction(view)
    view.commit()
  }

  private fun LafinaGrainientView.edit(change: (LafinaGrainientView.Params) -> LafinaGrainientView.Params) {
    params = change(params)
  }

  private fun parse(color: String?, fallback: Int): Int =
    try {
      if (color.isNullOrBlank()) fallback else Color.parseColor(color)
    } catch (error: IllegalArgumentException) {
      fallback
    }

  @ReactProp(name = "color1")
  fun setColor1(view: LafinaGrainientView, value: String?) = view.edit { it.copy(color1 = parse(value, it.color1)) }

  @ReactProp(name = "color2")
  fun setColor2(view: LafinaGrainientView, value: String?) = view.edit { it.copy(color2 = parse(value, it.color2)) }

  @ReactProp(name = "color3")
  fun setColor3(view: LafinaGrainientView, value: String?) = view.edit { it.copy(color3 = parse(value, it.color3)) }

  @ReactProp(name = "timeSpeed", defaultFloat = 0.25f)
  fun setTimeSpeed(view: LafinaGrainientView, value: Float) = view.edit { it.copy(timeSpeed = value) }

  @ReactProp(name = "colorBalance", defaultFloat = 0f)
  fun setColorBalance(view: LafinaGrainientView, value: Float) = view.edit { it.copy(colorBalance = value) }

  @ReactProp(name = "warpStrength", defaultFloat = 1f)
  fun setWarpStrength(view: LafinaGrainientView, value: Float) = view.edit { it.copy(warpStrength = value) }

  @ReactProp(name = "warpFrequency", defaultFloat = 5f)
  fun setWarpFrequency(view: LafinaGrainientView, value: Float) = view.edit { it.copy(warpFrequency = value) }

  @ReactProp(name = "warpSpeed", defaultFloat = 2f)
  fun setWarpSpeed(view: LafinaGrainientView, value: Float) = view.edit { it.copy(warpSpeed = value) }

  @ReactProp(name = "warpAmplitude", defaultFloat = 50f)
  fun setWarpAmplitude(view: LafinaGrainientView, value: Float) = view.edit { it.copy(warpAmplitude = value) }

  @ReactProp(name = "blendAngle", defaultFloat = 0f)
  fun setBlendAngle(view: LafinaGrainientView, value: Float) = view.edit { it.copy(blendAngle = value) }

  @ReactProp(name = "blendSoftness", defaultFloat = 0.05f)
  fun setBlendSoftness(view: LafinaGrainientView, value: Float) = view.edit { it.copy(blendSoftness = value) }

  @ReactProp(name = "rotationAmount", defaultFloat = 500f)
  fun setRotationAmount(view: LafinaGrainientView, value: Float) = view.edit { it.copy(rotationAmount = value) }

  @ReactProp(name = "noiseScale", defaultFloat = 2f)
  fun setNoiseScale(view: LafinaGrainientView, value: Float) = view.edit { it.copy(noiseScale = value) }

  @ReactProp(name = "grainAmount", defaultFloat = 0.1f)
  fun setGrainAmount(view: LafinaGrainientView, value: Float) = view.edit { it.copy(grainAmount = value) }

  @ReactProp(name = "grainScale", defaultFloat = 2f)
  fun setGrainScale(view: LafinaGrainientView, value: Float) = view.edit { it.copy(grainScale = value) }

  @ReactProp(name = "grainAnimated", defaultBoolean = false)
  fun setGrainAnimated(view: LafinaGrainientView, value: Boolean) = view.edit { it.copy(grainAnimated = value) }

  @ReactProp(name = "contrast", defaultFloat = 1.5f)
  fun setContrast(view: LafinaGrainientView, value: Float) = view.edit { it.copy(contrast = value) }

  @ReactProp(name = "gamma", defaultFloat = 1f)
  fun setGamma(view: LafinaGrainientView, value: Float) = view.edit { it.copy(gamma = value) }

  @ReactProp(name = "saturation", defaultFloat = 1f)
  fun setSaturation(view: LafinaGrainientView, value: Float) = view.edit { it.copy(saturation = value) }

  @ReactProp(name = "centerX", defaultFloat = 0f)
  fun setCenterX(view: LafinaGrainientView, value: Float) = view.edit { it.copy(centerX = value) }

  @ReactProp(name = "centerY", defaultFloat = 0f)
  fun setCenterY(view: LafinaGrainientView, value: Float) = view.edit { it.copy(centerY = value) }

  @ReactProp(name = "zoom", defaultFloat = 0.9f)
  fun setZoom(view: LafinaGrainientView, value: Float) = view.edit { it.copy(zoom = value) }

  @ReactProp(name = "lightMode", defaultBoolean = false)
  fun setLightMode(view: LafinaGrainientView, value: Boolean) = view.edit { it.copy(lightMode = value) }

  @ReactProp(name = "animate", defaultBoolean = true)
  fun setAnimate(view: LafinaGrainientView, value: Boolean) {
    view.animating = value
  }
}

/**
 * Tells JS whether `<LafinaGrainientView>` can be used. An APK without it, or
 * a phone without OpenGL ES 3, gets a still gradient instead.
 */
class LafinaGrainientModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "LafinaGrainient"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun isSupported(): Boolean {
    val manager = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    return (manager?.deviceConfigurationInfo?.reqGlEsVersion ?: 0) >= 0x30000
  }
}
