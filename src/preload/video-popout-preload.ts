import { contextBridge, ipcRenderer } from "electron";

/**
 * Minimal preload for the video pop-out window.
 * Exposes only getVoiceContext() — one-time delivery of auth token and channel name.
 */

contextBridge.exposeInMainWorld("popoutAPI", {
  getVoiceContext: (): Promise<{ channelName: string; token: string } | null> =>
    ipcRenderer.invoke("get-popout-voice-context"),
});
