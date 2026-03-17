/**
 * addon.cc — N-API bindings for windows-audio-capture.
 *
 * Exports:
 *   startCapture({ pid, exclude }) → boolean
 *   readFrames()                   → { pcm: Float32Array, sampleRate, channels } | undefined
 *   stopCapture()                  → undefined
 */
#include <napi.h>
#include "wasapi_capture.h"
#include <memory>
#include <vector>
#include <mutex>
#include <cstring>

struct Queue {
  std::mutex mu;
  std::vector<float> buf;
  AudioFormat fmt{};
};
static std::unique_ptr<WasapiCapture> g_cap;
static Queue g_q;

Napi::Value Start(const Napi::CallbackInfo& info) {
  auto cfgObj = info[0].As<Napi::Object>();
  CaptureConfig cfg{
    cfgObj.Get("pid").As<Napi::Number>().Uint32Value(),
    cfgObj.Get("exclude").As<Napi::Boolean>().Value()
  };
  g_cap = std::make_unique<WasapiCapture>(cfg);
  bool ok = g_cap->Start([](const float* p, uint32_t n, const AudioFormat& f) {
    std::lock_guard<std::mutex> lk(g_q.mu);
    g_q.buf.insert(g_q.buf.end(), p, p + n * f.channels);
    g_q.fmt = f;
  });
  return Napi::Boolean::New(info.Env(), ok);
}

Napi::Value Read(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  std::vector<float> local;
  AudioFormat fmt{};
  {
    std::lock_guard<std::mutex> lk(g_q.mu);
    local.swap(g_q.buf);
    fmt = g_q.fmt;
  }
  auto res = Napi::Object::New(env);
  auto ab  = Napi::ArrayBuffer::New(env, local.size() * sizeof(float));
  std::memcpy(ab.Data(), local.data(), ab.ByteLength());
  res.Set("pcm",        Napi::Float32Array::New(env, local.size(), ab, 0));
  res.Set("sampleRate", Napi::Number::New(env, fmt.sampleRate));
  res.Set("channels",   Napi::Number::New(env, fmt.channels));
  return res;
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  if (g_cap) { g_cap->Stop(); g_cap.reset(); }
  std::lock_guard<std::mutex> lk(g_q.mu);
  g_q.buf.clear();
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("startCapture", Napi::Function::New(env, Start));
  exports.Set("readFrames",   Napi::Function::New(env, Read));
  exports.Set("stopCapture",  Napi::Function::New(env, Stop));
  return exports;
}
NAPI_MODULE(windows_audio_capture, Init)
