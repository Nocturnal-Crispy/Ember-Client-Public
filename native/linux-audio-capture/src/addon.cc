/**
 * addon.cc — N-API bindings for linux-audio-capture.
 *
 * Exports:
 *   startCapture({ pid, exclude }) → boolean
 *   readFrames()                   → { pcm: Float32Array, sampleRate, channels } | undefined
 *   stopCapture()                  → undefined
 */
#include <napi.h>
#include "pw_capture.h"
#include <memory>
#include <vector>
#include <mutex>
#include <cstring>

struct Queue {
  std::mutex mu;
  std::vector<float> buf;
  uint32_t sampleRate = 48000;
  uint16_t channels   = 2;
};
static std::unique_ptr<PwCapture> g_cap;
static Queue g_q;

Napi::Value Start(const Napi::CallbackInfo& info) {
  auto cfgObj = info[0].As<Napi::Object>();
  uint32_t pid = cfgObj.Get("pid").As<Napi::Number>().Uint32Value();
  g_cap = std::make_unique<PwCapture>(pid);
  bool ok = g_cap->Start([](const float* p, uint32_t n, uint32_t sr, uint16_t ch) {
    std::lock_guard<std::mutex> lk(g_q.mu);
    g_q.buf.insert(g_q.buf.end(), p, p + n);
    g_q.sampleRate = sr;
    g_q.channels   = ch;
  });
  return Napi::Boolean::New(info.Env(), ok);
}

Napi::Value Read(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  std::vector<float> local;
  uint32_t sr; uint16_t ch;
  {
    std::lock_guard<std::mutex> lk(g_q.mu);
    local.swap(g_q.buf);
    sr = g_q.sampleRate;
    ch = g_q.channels;
  }
  auto res = Napi::Object::New(env);
  auto ab  = Napi::ArrayBuffer::New(env, local.size() * sizeof(float));
  std::memcpy(ab.Data(), local.data(), ab.ByteLength());
  res.Set("pcm",        Napi::Float32Array::New(env, local.size(), ab, 0));
  res.Set("sampleRate", Napi::Number::New(env, sr));
  res.Set("channels",   Napi::Number::New(env, ch));
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
NAPI_MODULE(linux_audio_capture, Init)
