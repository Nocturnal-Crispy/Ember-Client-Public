/**
 * wasapi_capture.cc — Windows WASAPI process-loopback audio capture.
 *
 * Uses AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK with
 * PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE to capture all
 * system audio EXCEPT the Ember process (so the sharer hears their own
 * voice normally while the share recipient hears other app audio).
 *
 * Requires Windows 10 version 2004 (build 19041) or later.
 */
#include "wasapi_capture.h"
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <wrl/implements.h>
#include <wrl/event.h>
#include <cstring>

using namespace Microsoft::WRL;

class ActivationCallback :
    public RuntimeClass<RuntimeClassFlags<ClassicCom>,
                        IActivateAudioInterfaceCompletionHandler> {
 public:
  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT hr = S_OK;
    ComPtr<IUnknown> iface;
    op->GetActivateResult(&hr, &iface);
    if (SUCCEEDED(hr)) iface.As(&client_);
    result_ = hr;
    SetEvent(event_);
    return S_OK;
  }
  HRESULT Wait(DWORD ms = 5000) { WaitForSingleObject(event_, ms); return result_; }
  ComPtr<IAudioClient> Client() { return client_; }
  ActivationCallback()  { event_ = CreateEventW(nullptr, TRUE, FALSE, nullptr); }
  ~ActivationCallback() { CloseHandle(event_); }

 private:
  HANDLE event_;
  HRESULT result_ = S_OK;
  ComPtr<IAudioClient> client_;
};

WasapiCapture::WasapiCapture(CaptureConfig cfg) : config_(cfg) {}

WasapiCapture::~WasapiCapture() { Stop(); }

bool WasapiCapture::Start(FrameCallback cb) {
  callback_ = std::move(cb);

  AUDIOCLIENT_ACTIVATION_PARAMS ap{};
  ap.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  ap.ProcessLoopbackParams.TargetProcessId   = config_.targetProcessId;
  ap.ProcessLoopbackParams.ProcessLoopbackMode =
      config_.excludeMode
          ? PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
          : PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT pv;
  PropVariantInit(&pv);
  pv.vt             = VT_BLOB;
  pv.blob.cbSize    = sizeof(ap);
  pv.blob.pBlobData = reinterpret_cast<BYTE*>(&ap);

  auto cb2 = Make<ActivationCallback>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> op;
  HRESULT hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
      __uuidof(IAudioClient), &pv, cb2.Get(), &op);
  if (FAILED(hr) || FAILED(cb2->Wait())) return false;

  auto client = cb2->Client();
  WAVEFORMATEX* wfx = nullptr;
  client->GetMixFormat(&wfx);
  format_ = { wfx->nSamplesPerSec, wfx->nChannels, wfx->wBitsPerSample };

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
      10000000, 0, wfx, nullptr);
  CoTaskMemFree(wfx);
  if (FAILED(hr)) return false;

  running_ = true;
  captureThread_ = std::thread([this, c = std::move(client)]() mutable {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    CaptureLoopImpl(c.Get());
    CoUninitialize();
  });
  return true;
}

void WasapiCapture::CaptureLoopImpl(_IAudioClient* client) {
  ComPtr<IAudioCaptureClient> capture;
  client->GetService(__uuidof(IAudioCaptureClient),
                     reinterpret_cast<void**>(capture.GetAddressOf()));
  client->Start();
  while (running_) {
    UINT32 sz = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&sz)) && sz > 0) {
      BYTE* data = nullptr; UINT32 frames = 0; DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
      if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && frames > 0)
        callback_(reinterpret_cast<const float*>(data), frames, format_);
      capture->ReleaseBuffer(frames);
    }
    Sleep(10);
  }
  client->Stop();
}

void WasapiCapture::Stop() {
  running_ = false;
  if (captureThread_.joinable()) captureThread_.join();
}
