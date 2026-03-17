#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <vector>
#include <memory>

using PcmCallback = std::function<void(const float*, uint32_t, uint32_t, uint16_t)>;

struct PwNodeInfo {
  uint32_t    id;
  uint32_t    pid;
  std::string name;
};

/** Enumerate all audio output stream nodes visible to PipeWire. */
std::vector<PwNodeInfo> PwEnumerateAudioNodes();

class PwCapture {
 public:
  explicit PwCapture(uint32_t excludePid);
  ~PwCapture();
  bool Start(PcmCallback cb);
  void Stop();
  struct Impl;

 private:
  uint32_t excludePid_;
  PcmCallback callback_;
  std::unique_ptr<Impl> impl_;
};
