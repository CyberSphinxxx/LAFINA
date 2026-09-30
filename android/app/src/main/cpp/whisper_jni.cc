#include <jni.h>
#include <android/asset_manager.h>
#include <android/asset_manager_jni.h>
#include <android/log.h>
#include <algorithm>
#include <string>
#include <thread>
#include "whisper.h"

namespace {
constexpr const char *kTag = "LafinaWhisper";
constexpr const char *kAcademicPrompt =
    "Set a schedule. Set a schedule at 4:15 PM today. Acknowledge. Acknowledged. Snooze. "
    "Snooze for ten minutes. Academic scheduling words include reminder, assignment, class, "
    "exam, quiz, project, study, meeting, today, tomorrow, morning, afternoon, evening, AM, "
    "and PM.";
constexpr const char *kCallCommandPrompt =
    "Acknowledged. Snoozed. Acknowledge. Snooze.";

constexpr float kDisabledNoSpeechThreshold = 1.0f;
constexpr int kCallCommandAudioContext = 128;
constexpr int kCallCommandMaxTokens = 8;

size_t assetRead(void *context, void *output, size_t size) {
  return static_cast<size_t>(AAsset_read(static_cast<AAsset *>(context), output, size));
}

bool assetEof(void *context) {
  return AAsset_getRemainingLength64(static_cast<AAsset *>(context)) <= 0;
}

void assetClose(void *context) {
  AAsset_close(static_cast<AAsset *>(context));
}

std::string trim(const std::string &value) {
  const auto first = value.find_first_not_of(" \n\r\t");
  if (first == std::string::npos) return "";
  const auto last = value.find_last_not_of(" \n\r\t");
  return value.substr(first, last - first + 1);
}

std::string escapeJson(const std::string &value) {
  std::string escaped;
  escaped.reserve(value.size());
  for (char c : value) {
    if (c == '"') {
      escaped += "\\\"";
    } else if (c == '\\') {
      escaped += "\\\\";
    } else if (c == '\b') {
      escaped += "\\b";
    } else if (c == '\f') {
      escaped += "\\f";
    } else if (c == '\n') {
      escaped += "\\n";
    } else if (c == '\r') {
      escaped += "\\r";
    } else if (c == '\t') {
      escaped += "\\t";
    } else if (static_cast<unsigned char>(c) >= 0x20) {
      escaped += c;
    }
  }
  return escaped;
}
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_lafina_LafinaWhisperBridge_initContext(
    JNIEnv *env, jobject, jobject assetManager, jstring assetPath) {
  const char *path = env->GetStringUTFChars(assetPath, nullptr);
  AAssetManager *manager = AAssetManager_fromJava(env, assetManager);
  AAsset *asset = AAssetManager_open(manager, path, AASSET_MODE_STREAMING);
  env->ReleaseStringUTFChars(assetPath, path);
  if (asset == nullptr) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "Unable to open Whisper model asset");
    return 0;
  }
  whisper_model_loader loader{};
  loader.context = asset;
  loader.read = assetRead;
  loader.eof = assetEof;
  loader.close = assetClose;
  whisper_context_params contextParams = whisper_context_default_params();
  contextParams.use_gpu = false;
  whisper_context *context = whisper_init_with_params(&loader, contextParams);
  return reinterpret_cast<jlong>(context);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_lafina_LafinaWhisperBridge_transcribe(
    JNIEnv *env,
    jobject,
    jlong contextPointer,
    jfloatArray samples,
    jint requestedThreads,
    jboolean commandMode) {
  auto *context = reinterpret_cast<whisper_context *>(contextPointer);
  if (context == nullptr) return env->NewStringUTF("");
  const jsize sampleCount = env->GetArrayLength(samples);
  if (sampleCount <= 0) return env->NewStringUTF("");
  jfloat *audio = env->GetFloatArrayElements(samples, nullptr);
  if (audio == nullptr) return env->NewStringUTF("");
  whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  params.language = "en";
  params.translate = false;
  params.no_context = true;
  params.no_timestamps = true;
  params.single_segment = true;
  params.print_progress = false;
  params.print_realtime = false;
  params.print_timestamps = false;
  params.suppress_blank = true;
  params.suppress_nst = true;
  params.temperature = 0.0f;
  const bool isCommandMode = commandMode == JNI_TRUE;
  params.max_tokens = isCommandMode ? kCallCommandMaxTokens : 96;
  params.audio_ctx = isCommandMode ? kCallCommandAudioContext : 0;
  params.initial_prompt = isCommandMode ? kCallCommandPrompt : kAcademicPrompt;
  params.greedy.best_of = 1;
  // Silero VAD has already gated and trimmed this audio. Whisper.cpp suppresses a
  // segment only when no_speech_prob is strictly greater than this threshold and
  // its average log probability is low, so 1.0 disables the redundant gate.
  params.no_speech_thold = kDisabledNoSpeechThreshold;
  params.n_threads = std::clamp(static_cast<int>(requestedThreads), 1, 4);
  std::string transcript;
  __android_log_print(
      ANDROID_LOG_INFO,
      kTag,
      "Transcribing %d samples with %d threads (commandMode=%d, audioCtx=%d)",
      static_cast<int>(sampleCount),
      params.n_threads,
      isCommandMode ? 1 : 0,
      params.audio_ctx);
  const int result = whisper_full(context, params, audio, sampleCount);
  env->ReleaseFloatArrayElements(samples, audio, JNI_ABORT);
  if (result == 0) {
    const int segmentCount = whisper_full_n_segments(context);
    for (int index = 0; index < segmentCount; ++index) {
      const std::string segment = trim(whisper_full_get_segment_text(context, index));
      if (segment.empty()) continue;
      if (!transcript.empty()) transcript += " ";
      transcript += segment;
    }
    __android_log_print(
        ANDROID_LOG_INFO,
        kTag,
        "Transcription completed with %d segments and %zu characters",
        segmentCount,
        transcript.size());
  } else {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "whisper_full failed: %d", result);
  }
  transcript = trim(transcript);
  return env->NewStringUTF(transcript.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_lafina_LafinaWhisperBridge_transcribeWithTimestamps(
    JNIEnv *env,
    jobject,
    jlong contextPointer,
    jfloatArray samples,
    jint requestedThreads) {
  auto *context = reinterpret_cast<whisper_context *>(contextPointer);
  if (context == nullptr) return env->NewStringUTF("[]");
  const jsize sampleCount = env->GetArrayLength(samples);
  if (sampleCount <= 0) return env->NewStringUTF("[]");
  jfloat *audio = env->GetFloatArrayElements(samples, nullptr);
  if (audio == nullptr) return env->NewStringUTF("[]");

  whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  params.language = "en";
  params.translate = false;
  params.no_context = true;
  params.no_timestamps = false;
  params.single_segment = false;
  params.print_progress = false;
  params.print_realtime = false;
  params.print_timestamps = false;
  params.suppress_blank = true;
  params.suppress_nst = true;
  params.temperature = 0.0f;
  params.max_tokens = 256;
  params.audio_ctx = 0;
  params.initial_prompt = kAcademicPrompt;
  params.greedy.best_of = 1;
  params.no_speech_thold = kDisabledNoSpeechThreshold;
  params.n_threads = std::clamp(static_cast<int>(requestedThreads), 1, 4);

  const int result = whisper_full(context, params, audio, sampleCount);
  env->ReleaseFloatArrayElements(samples, audio, JNI_ABORT);

  std::string json = "[";
  if (result == 0) {
    const int segmentCount = whisper_full_n_segments(context);
    bool first = true;
    for (int index = 0; index < segmentCount; ++index) {
      const std::string segmentText = trim(whisper_full_get_segment_text(context, index));
      if (segmentText.empty()) continue;
      const int64_t t0 = static_cast<int64_t>(whisper_full_get_segment_t0(context, index)) * 10;
      const int64_t t1 = static_cast<int64_t>(whisper_full_get_segment_t1(context, index)) * 10;
      if (!first) json += ",";
      first = false;
      json += "{\"start_ms\":" + std::to_string(t0) + ",\"end_ms\":" + std::to_string(t1) +
              ",\"text\":\"" + escapeJson(segmentText) + "\"}";
    }
  } else {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "whisper_full with timestamps failed: %d", result);
  }
  json += "]";
  return env->NewStringUTF(json.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_lafina_LafinaWhisperBridge_freeContext(JNIEnv *, jobject, jlong contextPointer) {
  auto *context = reinterpret_cast<whisper_context *>(contextPointer);
  if (context != nullptr) whisper_free(context);
}
