{
  "targets": [{
    "target_name": "linux_audio_capture",
    "sources": ["src/addon.cc", "src/pw_capture.cc"],
    "conditions": [["OS=='linux'", {
      "cflags": ["<!@(pkg-config --cflags libpipewire-0.3)"],
      "libraries": ["<!@(pkg-config --libs libpipewire-0.3)"]
    }]]
  }]
}
