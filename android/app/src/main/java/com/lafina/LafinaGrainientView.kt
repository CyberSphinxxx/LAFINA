package com.lafina

import android.content.Context
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES30
import android.os.SystemClock
import android.util.Log
import android.view.TextureView
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Grainient — the animated, grainy gradient behind the desktop app's sign-in
 * screens, drawn with the same fragment shader (React Bits' Grainient) so both
 * apps look alike.
 *
 * A TextureView rather than a GLSurfaceView, so it fades, clips and stacks like
 * any other view. It draws on its own thread at [FRAME_INTERVAL_MS], at a
 * reduced resolution (the gradient is soft and the grain reads as film grain
 * either way), and stops whenever it is off screen or the app is in the
 * background.
 */
class LafinaGrainientView(context: Context) : TextureView(context), TextureView.SurfaceTextureListener {

  /** Shader settings, as the JS component passes them. Defaults match the desktop component's. */
  data class Params(
    val timeSpeed: Float = 0.25f,
    val colorBalance: Float = 0f,
    val warpStrength: Float = 1f,
    val warpFrequency: Float = 5f,
    val warpSpeed: Float = 2f,
    val warpAmplitude: Float = 50f,
    val blendAngle: Float = 0f,
    val blendSoftness: Float = 0.05f,
    val rotationAmount: Float = 500f,
    val noiseScale: Float = 2f,
    val grainAmount: Float = 0.1f,
    val grainScale: Float = 2f,
    val grainAnimated: Boolean = false,
    val contrast: Float = 1.5f,
    val gamma: Float = 1f,
    val saturation: Float = 1f,
    val centerX: Float = 0f,
    val centerY: Float = 0f,
    val zoom: Float = 0.9f,
    val color1: Int = Color.parseColor("#FF9FFC"),
    val color2: Int = Color.parseColor("#5227FF"),
    val color3: Int = Color.parseColor("#B497CF"),
    val lightMode: Boolean = false,
  )

  /** Written by the view manager during a prop update, handed to the renderer by [commit]. */
  var params = Params()
  /** False draws still frames only, for the system's remove-animations setting. */
  var animating = true

  private var renderer: Renderer? = null

  init {
    // Transparent until the first frame, so whatever is behind shows instead of black.
    isOpaque = false
    surfaceTextureListener = this
  }

  /** Applies the props from one update; called once per batch by the view manager. */
  fun commit() {
    renderer?.update(params, animating)
  }

  private fun scaledSize(width: Int, height: Int): Pair<Int, Int> {
    // About 1.5 pixels per dp: fine grain without paying for every physical pixel.
    val scale = (1.5f / resources.displayMetrics.density).coerceIn(0.35f, 1f)
    return Pair((width * scale).toInt().coerceAtLeast(1), (height * scale).toInt().coerceAtLeast(1))
  }

  override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
    val (w, h) = scaledSize(width, height)
    surface.setDefaultBufferSize(w, h)
    renderer = Renderer(surface, params, animating).also {
      it.setPaused(!isShown)
      it.start()
    }
  }

  override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
    val (w, h) = scaledSize(width, height)
    surface.setDefaultBufferSize(w, h)
    renderer?.requestFrame()
  }

  override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
    // The render thread releases the surface once its EGL context is gone.
    renderer?.finish()
    renderer = null
    return false
  }

  override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit

  override fun onVisibilityAggregated(isVisible: Boolean) {
    super.onVisibilityAggregated(isVisible)
    renderer?.setPaused(!isVisible)
  }

  private class Renderer(
    private val surfaceTexture: SurfaceTexture,
    private var params: Params,
    private var animate: Boolean,
  ) : Thread("LafinaGrainient") {
    private val lock = Object()
    private var running = true
    private var paused = false
    private var dirty = true

    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var surface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var program = 0
    private var vertexBuffer = 0
    private val uniforms = HashMap<String, Int>()

    fun update(next: Params, nextAnimate: Boolean) = synchronized(lock) {
      params = next
      animate = nextAnimate
      dirty = true
      lock.notifyAll()
    }

    fun setPaused(value: Boolean) = synchronized(lock) {
      paused = value
      dirty = true
      lock.notifyAll()
    }

    fun requestFrame() = synchronized(lock) {
      dirty = true
      lock.notifyAll()
    }

    fun finish() = synchronized(lock) {
      running = false
      lock.notifyAll()
    }

    override fun run() {
      try {
        if (!setUp()) return
        // Animated time only moves while frames are drawn, so a pause resumes where it left off.
        var shaderTime = 0f
        var lastFrame = SystemClock.uptimeMillis()
        while (true) {
          val frameParams: Params
          val frameAnimated: Boolean
          synchronized(lock) {
            while (running && (paused || (!animate && !dirty))) lock.wait()
            if (!running) return
            frameParams = params
            frameAnimated = animate
            dirty = false
          }
          val now = SystemClock.uptimeMillis()
          if (frameAnimated) shaderTime += ((now - lastFrame).coerceAtMost(100L)) / 1000f
          lastFrame = now

          draw(frameParams, shaderTime)
          if (!EGL14.eglSwapBuffers(display, surface)) {
            Log.w(TAG, "eglSwapBuffers failed: 0x${Integer.toHexString(EGL14.eglGetError())}")
            return
          }

          if (frameAnimated) {
            val wait = FRAME_INTERVAL_MS - (SystemClock.uptimeMillis() - now)
            if (wait > 0) synchronized(lock) { if (running) lock.wait(wait) }
          }
        }
      } catch (error: InterruptedException) {
        // Finishing.
      } catch (error: Exception) {
        Log.e(TAG, "Grainient stopped drawing", error)
      } finally {
        tearDown()
      }
    }

    private fun setUp(): Boolean {
      display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
      val version = IntArray(2)
      if (display == EGL14.EGL_NO_DISPLAY || !EGL14.eglInitialize(display, version, 0, version, 1)) {
        Log.w(TAG, "No EGL display")
        return false
      }
      val configAttributes = intArrayOf(
        EGL14.EGL_RED_SIZE, 8,
        EGL14.EGL_GREEN_SIZE, 8,
        EGL14.EGL_BLUE_SIZE, 8,
        EGL14.EGL_ALPHA_SIZE, 8,
        EGL14.EGL_RENDERABLE_TYPE, EGLExt.EGL_OPENGL_ES3_BIT_KHR,
        EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT,
        EGL14.EGL_NONE,
      )
      val configs = arrayOfNulls<EGLConfig>(1)
      val count = IntArray(1)
      if (!EGL14.eglChooseConfig(display, configAttributes, 0, configs, 0, 1, count, 0) || count[0] == 0) {
        Log.w(TAG, "No OpenGL ES 3 config")
        return false
      }
      val config = configs[0]
      context = EGL14.eglCreateContext(
        display, config, EGL14.EGL_NO_CONTEXT,
        intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0,
      )
      if (context == EGL14.EGL_NO_CONTEXT) return false
      surface = EGL14.eglCreateWindowSurface(display, config, surfaceTexture, intArrayOf(EGL14.EGL_NONE), 0)
      if (surface == EGL14.EGL_NO_SURFACE) return false
      if (!EGL14.eglMakeCurrent(display, surface, surface, context)) return false

      program = buildProgram() ?: return false
      GLES30.glUseProgram(program)
      UNIFORM_NAMES.forEach { name -> uniforms[name] = GLES30.glGetUniformLocation(program, name) }

      // One triangle that covers the whole viewport, as ogl's Triangle does, kept on the GPU.
      val vertices = floatArrayOf(-1f, -1f, 3f, -1f, -1f, 3f)
      val data = ByteBuffer.allocateDirect(vertices.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
      data.put(vertices).position(0)
      val handles = IntArray(1)
      GLES30.glGenBuffers(1, handles, 0)
      vertexBuffer = handles[0]
      GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vertexBuffer)
      GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, vertices.size * 4, data, GLES30.GL_STATIC_DRAW)
      val position = GLES30.glGetAttribLocation(program, "position")
      GLES30.glEnableVertexAttribArray(position)
      GLES30.glVertexAttribPointer(position, 2, GLES30.GL_FLOAT, false, 0, 0)
      return true
    }

    private fun buildProgram(): Int? {
      val vertex = compile(GLES30.GL_VERTEX_SHADER, VERTEX_SHADER) ?: return null
      val fragment = compile(GLES30.GL_FRAGMENT_SHADER, FRAGMENT_SHADER) ?: return null
      val linked = GLES30.glCreateProgram()
      GLES30.glAttachShader(linked, vertex)
      GLES30.glAttachShader(linked, fragment)
      GLES30.glLinkProgram(linked)
      val status = IntArray(1)
      GLES30.glGetProgramiv(linked, GLES30.GL_LINK_STATUS, status, 0)
      if (status[0] == 0) {
        Log.e(TAG, "Link failed: ${GLES30.glGetProgramInfoLog(linked)}")
        return null
      }
      return linked
    }

    private fun compile(type: Int, source: String): Int? {
      val shader = GLES30.glCreateShader(type)
      GLES30.glShaderSource(shader, source)
      GLES30.glCompileShader(shader)
      val status = IntArray(1)
      GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, status, 0)
      if (status[0] == 0) {
        Log.e(TAG, "Shader compile failed: ${GLES30.glGetShaderInfoLog(shader)}")
        return null
      }
      return shader
    }

    private fun draw(p: Params, time: Float) {
      val size = IntArray(2)
      EGL14.eglQuerySurface(display, surface, EGL14.EGL_WIDTH, size, 0)
      EGL14.eglQuerySurface(display, surface, EGL14.EGL_HEIGHT, size, 1)
      GLES30.glViewport(0, 0, size[0], size[1])

      fun set(name: String, value: Float) = GLES30.glUniform1f(uniforms.getValue(name), value)
      fun setColor(name: String, color: Int) = GLES30.glUniform3f(
        uniforms.getValue(name),
        Color.red(color) / 255f,
        Color.green(color) / 255f,
        Color.blue(color) / 255f,
      )

      GLES30.glUniform2f(uniforms.getValue("iResolution"), size[0].toFloat(), size[1].toFloat())
      set("iTime", time)
      set("uTimeSpeed", p.timeSpeed)
      set("uColorBalance", p.colorBalance)
      set("uWarpStrength", p.warpStrength)
      set("uWarpFrequency", p.warpFrequency)
      set("uWarpSpeed", p.warpSpeed)
      set("uWarpAmplitude", p.warpAmplitude)
      set("uBlendAngle", p.blendAngle)
      set("uBlendSoftness", p.blendSoftness)
      set("uRotationAmount", p.rotationAmount)
      set("uNoiseScale", p.noiseScale)
      set("uGrainAmount", p.grainAmount)
      set("uGrainScale", p.grainScale)
      set("uGrainAnimated", if (p.grainAnimated) 1f else 0f)
      set("uContrast", p.contrast)
      set("uGamma", p.gamma)
      set("uSaturation", p.saturation)
      GLES30.glUniform2f(uniforms.getValue("uCenterOffset"), p.centerX, p.centerY)
      set("uZoom", p.zoom)
      setColor("uColor1", p.color1)
      setColor("uColor2", p.color2)
      setColor("uColor3", p.color3)
      set("uLightMode", if (p.lightMode) 1f else 0f)

      GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, 3)
    }

    private fun tearDown() {
      if (display != EGL14.EGL_NO_DISPLAY) {
        EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        if (vertexBuffer != 0) GLES30.glDeleteBuffers(1, intArrayOf(vertexBuffer), 0)
        if (program != 0) GLES30.glDeleteProgram(program)
        if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, surface)
        if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
        EGL14.eglReleaseThread()
      }
      surfaceTexture.release()
    }
  }

  companion object {
    private const val TAG = "LafinaGrainient"
    /** About 30 frames a second: the gradient moves slowly, and it saves battery. */
    private const val FRAME_INTERVAL_MS = 33L

    private val UNIFORM_NAMES = listOf(
      "iResolution", "iTime", "uTimeSpeed", "uColorBalance", "uWarpStrength", "uWarpFrequency",
      "uWarpSpeed", "uWarpAmplitude", "uBlendAngle", "uBlendSoftness", "uRotationAmount",
      "uNoiseScale", "uGrainAmount", "uGrainScale", "uGrainAnimated", "uContrast", "uGamma",
      "uSaturation", "uCenterOffset", "uZoom", "uColor1", "uColor2", "uColor3", "uLightMode",
    )

    private const val VERTEX_SHADER = """#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
"""

    /** The desktop component's fragment shader, unchanged. */
    private const val FRAGMENT_SHADER = """#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uLightMode;
out vec4 fragColor;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void mainImage(out vec4 o, vec2 C){
  float t=iTime*uTimeSpeed;
  vec2 uv=C/iResolution.xy;
  float ratio=iResolution.x/iResolution.y;
  vec2 tuv=uv-0.5+uCenterOffset;
  tuv/=max(uZoom,0.001);

  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);
  tuv.y*=1.0/ratio;
  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));
  tuv.y*=ratio;

  float frequency=uWarpFrequency;
  float ws=max(uWarpStrength,0.001);
  float amplitude=uWarpAmplitude/ws;
  float warpTime=t*uWarpSpeed;
  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;
  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);

  vec3 colLav=uColor1;
  vec3 colOrg=uColor2;
  vec3 colDark=uColor3;
  float b=uColorBalance;
  float s=max(uBlendSoftness,0.0);
  mat2 blendRot=Rot(radians(uBlendAngle));
  float blendX=(tuv*blendRot).x;
  float edge0=-0.3-b-s;
  float edge1=0.2-b+s;
  float v0=0.5-b+s;
  float v1=-0.3-b-s;
  vec3 layer1=mix(colDark,colOrg,S(edge0,edge1,blendX));
  vec3 layer2=mix(colOrg,colLav,S(edge0,edge1,blendX));
  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));

  vec2 grainUv=uv*max(uGrainScale,0.001);
  if(uGrainAnimated>0.5){grainUv+=vec2(iTime*0.05);}
  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);
  col+=(grain-0.5)*uGrainAmount;

  col=(col-0.5)*uContrast+0.5;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(vec3(luma),col,uSaturation);
  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));
  col=clamp(col,0.0,1.0);
  if(uLightMode>0.5){
    float energy=max(max(col.r,col.g),col.b);
    vec3 hue=col/max(energy,0.001);
    float chroma=length(col-vec3(dot(col,vec3(0.333333))));
    float coverage=clamp(0.12+chroma*1.15+energy*0.18,0.0,0.88);
    col=mix(vec3(1.0),clamp(hue*0.58+col*0.18,0.0,1.0),coverage);
  }

  o=vec4(col,1.0);
}
void main(){
  vec4 o=vec4(0.0);
  mainImage(o,gl_FragCoord.xy);
  fragColor=o;
}
"""
  }
}
