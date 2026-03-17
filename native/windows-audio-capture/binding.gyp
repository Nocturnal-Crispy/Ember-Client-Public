{
  "targets": [{
    "target_name": "windows_audio_capture",
    "sources": ["src/addon.cc", "src/wasapi_capture.cc"],
    "conditions": [["OS=='win'", {
      "libraries": ["-lole32.lib", "-lksuser.lib", "-lmfplat.lib"],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1 }
      }
    }]]
  }]
}
