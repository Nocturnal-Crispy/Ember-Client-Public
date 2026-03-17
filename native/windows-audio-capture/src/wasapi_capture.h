#pragma once
#include <cstdint>
#include <functional>
#include <atomic>
#include <thread>

struct CaptureConfig {
  uint32_t targetProcessId;  // Ember main process PID
  bool     excludeMode;      // true = EXCLUDE_TARGET_PROCESS_TREE
};

struct AudioFormat {
  uint32_t sampleRate;
  uint16_t channels;
  uint16_t bitsPerSample;
};

using FrameCallback = std::function<void(const float*, uint32_t, const AudioFormat&)>;

class WasapiCapture {
 public:
  explicit WasapiCapture(CaptureConfig cfg);
  ~WasapiCapture();
  bool Start(FrameCallback cb);
  void Stop();

 private:
  CaptureConfig     config_;
  AudioFormat       format_{};
  FrameCallback     callback_;
  std::thread       captureThread_;
  std::atomic<bool> running_{false};
  void CaptureLoopImpl(struct _IAudioClient* client);
};
