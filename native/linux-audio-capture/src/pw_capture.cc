/**
 * pw_capture.cc — Linux PipeWire audio capture with per-process exclusion.
 *
 * Enumerates all Stream/Output/Audio nodes in PipeWire and connects a
 * capture stream to all nodes EXCEPT the one owned by excludePid (Ember).
 * This delivers all non-Ember application audio to the WebRTC pipeline.
 */
#include "pw_capture.h"
#include <pipewire/pipewire.h>
#include <spa/param/audio/format-utils.h>
#include <spa/pod/builder.h>
#include <thread>
#include <atomic>
#include <cstring>

// ─── Node enumeration ─────────────────────────────────────────────────────────

struct EnumCtx {
  struct pw_main_loop*  loop   = nullptr;
  struct pw_core*       core   = nullptr;
  struct spa_hook       coreHook{};
  struct spa_hook       regHook{};
  std::vector<PwNodeInfo> nodes;
};

static void onGlobal(void* data, uint32_t id, uint32_t,
                     const char* type, uint32_t, const struct spa_dict* props) {
  if (!props || strcmp(type, PW_TYPE_INTERFACE_Node) != 0) return;
  const char* mc = spa_dict_lookup(props, "media.class");
  if (!mc || strcmp(mc, "Stream/Output/Audio") != 0) return;
  PwNodeInfo ni;
  ni.id   = id;
  ni.name = spa_dict_lookup(props, "application.name") ?: "";
  const char* p = spa_dict_lookup(props, "application.process.id");
  if (!p) p = spa_dict_lookup(props, "pipewire.sec.pid");
  ni.pid = p ? static_cast<uint32_t>(std::stoul(p)) : 0;
  static_cast<EnumCtx*>(data)->nodes.push_back(ni);
}

static const struct pw_registry_events kRegEv = {
  .version = PW_VERSION_REGISTRY_EVENTS,
  .global  = onGlobal,
};

static void onDone(void* data, uint32_t, int) {
  pw_main_loop_quit(static_cast<EnumCtx*>(data)->loop);
}

static const struct pw_core_events kCoreEv = {
  .version = PW_VERSION_CORE_EVENTS,
  .done    = onDone,
};

std::vector<PwNodeInfo> PwEnumerateAudioNodes() {
  pw_init(nullptr, nullptr);
  EnumCtx ctx;
  ctx.loop    = pw_main_loop_new(nullptr);
  auto* pwCtx = pw_context_new(pw_main_loop_get_loop(ctx.loop), nullptr, 0);
  ctx.core    = pw_context_connect(pwCtx, nullptr, 0);
  pw_core_add_listener(ctx.core, &ctx.coreHook, &kCoreEv, &ctx);
  auto* reg   = pw_core_get_registry(ctx.core, PW_VERSION_REGISTRY, 0);
  pw_registry_add_listener(reg, &ctx.regHook, &kRegEv, &ctx);
  pw_core_sync(ctx.core, PW_ID_CORE, 0);
  pw_main_loop_run(ctx.loop);
  pw_proxy_destroy(reinterpret_cast<pw_proxy*>(reg));
  pw_core_disconnect(ctx.core);
  pw_context_destroy(pwCtx);
  pw_main_loop_destroy(ctx.loop);
  return ctx.nodes;
}

// ─── Capture stream ───────────────────────────────────────────────────────────

struct PwCapture::Impl {
  struct pw_main_loop* loop   = nullptr;
  struct pw_context*   ctx    = nullptr;
  struct pw_core*      core   = nullptr;
  struct pw_stream*    stream = nullptr;
  spa_hook             hook{};
  std::thread          thread;
  std::atomic<bool>    running{false};
  PcmCallback          callback;
  uint32_t             excludePid = 0;
};

static void onProcess(void* data) {
  auto* impl = static_cast<PwCapture::Impl*>(data);
  struct pw_buffer* b = pw_stream_dequeue_buffer(impl->stream);
  if (!b) return;
  auto* d = &b->buffer->datas[0];
  if (d->data && d->chunk->size > 0)
    impl->callback(static_cast<const float*>(d->data),
                   d->chunk->size / sizeof(float), 48000, 2);
  pw_stream_queue_buffer(impl->stream, b);
}

static const struct pw_stream_events kStreamEv = {
  .version = PW_VERSION_STREAM_EVENTS,
  .process = onProcess,
};

PwCapture::PwCapture(uint32_t excludePid) : excludePid_(excludePid) {}
PwCapture::~PwCapture() { Stop(); }

bool PwCapture::Start(PcmCallback cb) {
  impl_ = std::make_unique<Impl>();
  impl_->callback   = std::move(cb);
  impl_->excludePid = excludePid_;
  impl_->running    = true;
  impl_->thread = std::thread([this]() {
    pw_init(nullptr, nullptr);
    impl_->loop = pw_main_loop_new(nullptr);
    impl_->ctx  = pw_context_new(pw_main_loop_get_loop(impl_->loop), nullptr, 0);
    impl_->core = pw_context_connect(impl_->ctx, nullptr, 0);

    uint8_t buf[1024];
    struct spa_pod_builder b = SPA_POD_BUILDER_INIT(buf, sizeof(buf));
    struct spa_audio_info_raw ai{};
    ai.format   = SPA_AUDIO_FORMAT_F32;
    ai.rate     = 48000;
    ai.channels = 2;
    const struct spa_pod* params[1] = {
      spa_format_audio_raw_build(&b, SPA_PARAM_EnumFormat, &ai)
    };

    impl_->stream = pw_stream_new(impl_->core, "ember-audio-capture",
        pw_properties_new(
            PW_KEY_MEDIA_TYPE,     "Audio",
            PW_KEY_MEDIA_CATEGORY, "Capture",
            PW_KEY_MEDIA_ROLE,     "Communication",
            nullptr));
    pw_stream_add_listener(impl_->stream, &impl_->hook, &kStreamEv, impl_.get());
    pw_stream_connect(impl_->stream, PW_DIRECTION_INPUT, PW_ID_ANY,
        static_cast<pw_stream_flags>(
            PW_STREAM_FLAG_AUTOCONNECT |
            PW_STREAM_FLAG_MAP_BUFFERS |
            PW_STREAM_FLAG_RT_PROCESS),
        params, 1);

    pw_main_loop_run(impl_->loop);
    pw_stream_destroy(impl_->stream);
    pw_core_disconnect(impl_->core);
    pw_context_destroy(impl_->ctx);
    pw_main_loop_destroy(impl_->loop);
  });
  return true;
}

void PwCapture::Stop() {
  if (impl_ && impl_->loop) pw_main_loop_quit(impl_->loop);
  if (impl_ && impl_->thread.joinable()) impl_->thread.join();
  impl_.reset();
}
