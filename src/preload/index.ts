import type { AuthData, DeviceIdentity, EmberCmd, EmberIpcResponse } from "../shared";
import { contextBridge, ipcRenderer } from "electron";
import * as emberCrypto from "../shared";
import * as emberServices from "../shared";
import * as nodeCrypto from "crypto";
import { refreshToken } from "./services/token-refresh-service";
import { getTokenExpiry, isTokenExpiringSoon } from "./utils/token-utils";
const { IPC_CHANNELS } = require("../shared/constants");

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Preload-side logger — sends directly via ipcRenderer (bypasses the contextBridge allowlist)
function preloadLog(
  level: string,
  message: string,
  data?: Record<string, unknown>
) {
  try {
    ipcRenderer.send(IPC_CHANNELS.LOG_TO_CONSOLE, {
      level: level.toUpperCase(),
      context: "Preload",
      message,
      data: data || null,
    });
  } catch (_) {
    /* ignore if IPC unavailable */
  }
}

preloadLog("info", "Preload script initializing");

// Apply the saved theme synchronously before the page renders to prevent a flash of
// default colors. Uses sendSync so the CSS variables are set before any stylesheet
// or renderer script runs.
try {
  const savedTheme = ipcRenderer.sendSync("get-theme-settings-sync") as {
    accentRgb: string;
    backgroundRgb: string;
    surfaceRgb: string;
    chatColor?: string;
  } | null;

  function isValidPreloadRgb(value: unknown): value is string {
    if (typeof value !== 'string' || value.trim() === '') return false;
    const parts = value.split(',');
    if (parts.length !== 3) return false;
    return parts.every(part => {
      const n = parseInt(part.trim(), 10);
      return !isNaN(n) && n >= 0 && n <= 255;
    });
  }

  // Enhanced validation with detailed logging
  if (savedTheme && document.documentElement) {
    const validationResults = {
      accentRgb: isValidPreloadRgb(savedTheme.accentRgb),
      backgroundRgb: isValidPreloadRgb(savedTheme.backgroundRgb),
      surfaceRgb: isValidPreloadRgb(savedTheme.surfaceRgb),
      hasChatColor: typeof savedTheme.chatColor === 'string'
    };
    
    preloadLog("debug", "Theme validation results", { 
      themeId: 'unknown',
      validationResults,
      accentRgb: savedTheme.accentRgb,
      backgroundRgb: savedTheme.backgroundRgb,
      surfaceRgb: savedTheme.surfaceRgb,
      hasChatColor: validationResults.hasChatColor
    });

    if (
      validationResults.accentRgb &&
      validationResults.backgroundRgb &&
      validationResults.surfaceRgb
    ) {
      const root = document.documentElement;
      root.style.setProperty("--rgb-highlight", savedTheme.accentRgb);
      root.style.setProperty("--rgb-background", savedTheme.backgroundRgb);
      root.style.setProperty("--rgb-surface", savedTheme.surfaceRgb);
      const hoverParts = savedTheme.surfaceRgb
        .split(",")
        .map((s: string) => Math.min(255, parseInt(s.trim(), 10) + 10));
      root.style.setProperty("--rgb-surface-hover", hoverParts.join(", "));
      if (savedTheme.chatColor) {
        root.style.setProperty("--chat-color", savedTheme.chatColor);
      }
      preloadLog("debug", "Theme applied synchronously in preload");
    } else {
      preloadLog("warn", "Theme settings failed validation in preload; skipping early application", {
        validationResults,
        accentRgb: savedTheme.accentRgb,
        backgroundRgb: savedTheme.backgroundRgb,
        surfaceRgb: savedTheme.surfaceRgb
      });
    }
  } else if (savedTheme) {
    // document.documentElement not yet available — defer theme application to DOMContentLoaded
    preloadLog("debug", "Theme deferred to DOMContentLoaded; document.documentElement not yet available");
    document.addEventListener("DOMContentLoaded", () => {
      const root = document.documentElement;
      if (!root) return;
      if (isValidPreloadRgb(savedTheme.accentRgb)) {
        root.style.setProperty("--rgb-highlight", savedTheme.accentRgb);
      }
      if (isValidPreloadRgb(savedTheme.backgroundRgb)) {
        root.style.setProperty("--rgb-background", savedTheme.backgroundRgb);
      }
      if (isValidPreloadRgb(savedTheme.surfaceRgb)) {
        root.style.setProperty("--rgb-surface", savedTheme.surfaceRgb);
        const hoverParts = savedTheme.surfaceRgb
          .split(",")
          .map((s: string) => Math.min(255, parseInt(s.trim(), 10) + 10));
        root.style.setProperty("--rgb-surface-hover", hoverParts.join(", "));
      }
      if (savedTheme.chatColor) {
        root.style.setProperty("--chat-color", savedTheme.chatColor);
      }
      preloadLog("debug", "Theme applied on DOMContentLoaded");
    }, { once: true });
  } else {
    preloadLog("debug", "No saved theme settings found in preload");
  }
} catch (e) {
  preloadLog("warn", "Failed to apply theme synchronously in preload", { error: String(e) });
}

// Store pending invite data to work around context bridge argument passing issues
let pendingInvite: { code: string; hostname: string | null } | null = null;

const ALLOWED_SEND: readonly string[] = [
  "window-minimize",
  "window-maximize",
  "window-close",
  "auth-success",
  "auth-logout",
  "log-to-console",
  "log-to-file",
];

const ALLOWED_INVOKE: readonly string[] = [
  "get-device-identity",
  "save-device-identity",
  "get-auth",
  "save-auth",
  "get-last-hostname",
  "get-voice-video-settings",
  "save-voice-video-settings",
  "get-theme-settings",
  "save-theme-settings",
  "check-for-update",
  "check-for-update-details",
  "open-external-url",
  "get-pending-invite",
  "get-klipy-api-key",
  "get-gif-favorites",
  "save-gif-favorites",
  "download-update",
  "cancel-download",
  "install-update",
  "schedule-install-on-exit",
  "skip-version",
  "get-skipped-version",
  "verify-pin",
  "set-pin",
  "has-pin",
  "clear-pin",
  "get-app-version",
  "get-screen-sources",
  "audio-capture-check-support",
  "audio-capture-setup",
  "audio-capture-frames",
  "audio-capture-teardown",
  "open-video-popout",
  "ember",  // Signal Protocol unified IPC channel
];

const ALLOWED_ON: readonly string[] = [
  "handle-invite-link",
  "update-download-progress",
  "update-download-complete",
  "update-download-error",
  "window-blur",
  "window-focus",
  "signal-db-unavailable",
];

preloadLog("debug", "Setting up contextBridge API");

// CRITICAL FIX: Initialize SafeStorage functions for ember-shared auth service
// This prevents "SafeStorage functions not initialized" error during registration
const { setSafeStorageFunctions } = emberServices;
setSafeStorageFunctions({
  async getSafeStorage(key: string): Promise<string | null> {
    const response = await ipcRenderer.invoke("get-safe-storage", { key });
    return response.success ? response.data.value : null;
  },
  async setSafeStorage(key: string, value: string): Promise<void> {
    await ipcRenderer.invoke("set-safe-storage", { key, value });
  },
  async deleteSafeStorage(key: string): Promise<void> {
    await ipcRenderer.invoke("delete-safe-storage", { key });
  }
});

preloadLog("debug", "SafeStorage functions initialized for ember-shared auth service");

contextBridge.exposeInMainWorld("electronAPI", {
  ipc: {
    send(channel: string, ...args: unknown[]) {
      if (ALLOWED_SEND.includes(channel)) {
        ipcRenderer.send(channel, ...args);
      } else {
        preloadLog("warn", `Blocked IPC send on unlisted channel: ${channel}`);
      }
    },
    invoke(channel: string, ...args: unknown[]) {
      if (ALLOWED_INVOKE.includes(channel)) {
        if (channel === "get-pending-invite") {
          const invite = pendingInvite;
          pendingInvite = null; // Clear after retrieving
          const hasCode =
            typeof invite?.code === "string" && invite.code.length > 0;
          preloadLog("debug", "Returning pending invite:", {
            has_code: hasCode,
            hostname: invite?.hostname ?? null,
          });
          return Promise.resolve(invite);
        }
        return ipcRenderer.invoke(channel, ...args);
      }
      preloadLog("warn", `Blocked IPC invoke on unlisted channel: ${channel}`);
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    },
    on(channel: string, listener: (...args: unknown[]) => void) {
      if (ALLOWED_ON.includes(channel)) {
        preloadLog("debug", `Setting up IPC listener for channel: ${channel}`);
        ipcRenderer.on(channel, (_event, ...args) => {
          if (channel === "handle-invite-link" && args.length > 0) {
            // Store the invite data to work around context bridge argument passing issues.
            // Never log invite codes (they are effectively authentication material).
            const inviteData = args[0] as { code?: string; hostname?: string | null };
            const hasCode = typeof inviteData.code === "string" && inviteData.code.length > 0;
            preloadLog("debug", "IPC received invite link", {
              has_code: hasCode,
              hostname: inviteData.hostname ?? null,
            });

            pendingInvite = args[0] as { code: string; hostname: string | null };
            // Just call the listener without arguments to trigger the invite processing.
            listener();
            return;
          }

          // Generic IPC logging: do not log raw args (they may contain tokens or codes).
          preloadLog("debug", `IPC received on channel ${channel}`, {
            args_length: args.length,
          });

          preloadLog("debug", `Calling listener with ${args.length} arguments`);
          try {
            listener(...args);
            preloadLog("debug", `Listener called successfully`);
          } catch (error) {
            preloadLog("error", `Error calling listener:`, { error: String(error) });
          }
        });
      } else {
        preloadLog(
          "warn",
          `Blocked IPC on-listener for unlisted channel: ${channel}`
        );
      }
    },
  },

  crypto: {
    generateRecoveryCode: (_length?: number): string => {
      throw new Error('NaCl crypto removed — use Signal Protocol recovery instead');
    },
    encryptPrivateKeyWithRecoveryCode: (
      _privateKey: Uint8Array,
      _recoveryCode: string
    ): Promise<{ encrypted: string; salt: string }> => {
      throw new Error('NaCl crypto removed — use Signal Protocol recovery instead');
    },
    decryptPrivateKeyWithRecoveryCode: (
      _encryptedBase64: string,
      _recoveryCode: string,
      _saltBase64: string
    ): Promise<Uint8Array | null> => {
      throw new Error('NaCl crypto removed — use Signal Protocol recovery instead');
    },
    encryptFileBytes: (fileBytes: Uint8Array, key: Uint8Array): string => {
      if (key.byteLength !== 32) {
        throw new Error(`encryptFileBytes: expected 32-byte key, got ${key.byteLength}`);
      }

      const iv = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv(
        "aes-256-gcm",
        Buffer.from(key),
        iv,
      );
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(fileBytes)), cipher.final()]);
      const tag = cipher.getAuthTag();

      const combined = Buffer.concat([iv, tag, ciphertext]);
      return bytesToBase64(new Uint8Array(combined));
    },
    decryptFileBytes: (encryptedBase64: string, key: Uint8Array): Uint8Array | null => {
      if (key.byteLength !== 32) return null;

      try {
        const combined = base64ToBytes(encryptedBase64);
        if (combined.byteLength < 12 + 16) return null;

        const iv = Buffer.from(combined.slice(0, 12));
        const tag = Buffer.from(combined.slice(12, 28));
        const ciphertext = Buffer.from(combined.slice(28));

        const decipher = nodeCrypto.createDecipheriv(
          "aes-256-gcm",
          Buffer.from(key),
          iv,
        );
        decipher.setAuthTag(tag);

        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return new Uint8Array(plaintext);
      } catch {
        return null;
      }
    },
  },

  authService: {
    generateDeviceIdentity: async () => {
      try {
        const result = await emberServices.generateDeviceIdentity();
        return result;
      } catch (error) {
        console.error('Preload: generateDeviceIdentity failed', error);
        throw error;
      }
    },
    login: (
      hostname: string,
      username: string,
      password: string,
      deviceId: string
    ) => emberServices.login(hostname, username, password, deviceId),
    register: (
      hostname: string,
      username: string,
      password: string,
      deviceId: string,
      publicKey: string,
      encryptedDeviceKey: string,
      salt: string
    ) =>
      emberServices.register(
        hostname,
        username,
        password,
        deviceId,
        publicKey,
        encryptedDeviceKey,
        salt
      ),
    registerWithSignalKeys: (
      hostname: string,
      username: string,
      password: string,
      signalIdentity: unknown,
      publicKey: string,
      encryptedDeviceKey: string,
      salt: string
    ) =>
      emberServices.registerWithSignalKeys(
        hostname,
        username,
        password,
        signalIdentity as DeviceIdentity,
        publicKey,
        encryptedDeviceKey,
        salt
      ),
    registerWithRecovery: (
      hostname: string,
      username: string,
      password: string,
      deviceIdentity: unknown
    ) =>
      emberServices.registerWithRecovery(
        hostname,
        username,
        password,
        deviceIdentity as DeviceIdentity
      ),
    validateLoginForm: (hostname: string, username: string, password: string) =>
      emberServices.validateLoginForm(hostname, username, password),
    validateRegisterForm: (
      hostname: string,
      username: string,
      password: string,
      confirmPassword: string
    ) =>
      emberServices.validateRegisterForm(
        hostname,
        username,
        password,
        confirmPassword
      ),
    refreshToken: (hostname: string, currentToken: string) =>
      refreshToken(hostname, currentToken),
  },

  tokenUtils: {
    getTokenExpiry: (token: string) => getTokenExpiry(token),
    isTokenExpiringSoon: (token: string, thresholdSeconds: number) =>
      isTokenExpiringSoon(token, thresholdSeconds),
  },

  messageService: {
    fetchMessages: (auth: unknown, channelId: string, beforeId?: string) =>
      emberServices.fetchMessages(auth as AuthData, channelId, beforeId),
    sendMessage: (
      auth: unknown,
      channelId: string,
      ciphertext: string
    ) =>
      emberServices.sendMessage(
        auth as AuthData,
        channelId,
        ciphertext
      ),
    deleteMessage: (
      auth: unknown,
      channelId: string,
      messageId: string,
    ) =>
      emberServices.deleteMessage(
        auth as AuthData,
        channelId,
        messageId,
      ),
    editMessage: (
      auth: unknown,
      channelId: string,
      messageId: string,
      ciphertext: string
    ) =>
      emberServices.editMessage(
        auth as AuthData,
        channelId,
        messageId,
        ciphertext
      ),
    uploadAttachment: (
      auth: unknown,
      channelId: string,
      encryptedData: string,
      meta: { name: string; size: number; mime: string }
    ) =>
      emberServices.uploadAttachment(
        auth as AuthData,
        channelId,
        encryptedData,
        meta
      ),
    downloadAttachment: (
      auth: unknown,
      channelId: string,
      attachmentId: string
    ) =>
      emberServices.downloadAttachment(
        auth as AuthData,
        channelId,
        attachmentId
      ),
    uploadDMAttachment: (
      auth: unknown,
      conversationId: string,
      encryptedData: string,
      meta: { name: string; size: number; mime: string }
    ) =>
      emberServices.uploadDMAttachment(
        auth as AuthData,
        conversationId,
        encryptedData,
        meta
      ),
    downloadDMAttachment: (
      auth: unknown,
      conversationId: string,
      attachmentId: string
    ) =>
      emberServices.downloadDMAttachment(
        auth as AuthData,
        conversationId,
        attachmentId
      ),
  },

  emberService: {
    fetchEmbers: (auth: unknown) => emberServices.fetchEmbers(auth as AuthData),
    updateEmber: (auth: unknown, emberId: string, updates: unknown) =>
      emberServices.updateEmber(auth as AuthData, emberId, updates as any),
  },

  channelService: {
    fetchChannels: (auth: unknown, emberId: string) =>
      emberServices.fetchChannels(auth as AuthData, emberId),
    fetchEmberKey: (auth: unknown, emberId: string) =>
      emberServices.fetchEmberKey(auth as AuthData, emberId),
  },

  wsService: {
    buildWsUrl: (hostname: string, token: string) =>
      emberServices.buildWsUrl(hostname, token),
  },

  getKlipyApiKey: () => ipcRenderer.invoke("get-klipy-api-key"),

  desktopCapturer: {
    getSources: () => ipcRenderer.invoke("get-screen-sources"),
  },

  audioCapture: {
    checkSupport: () => ipcRenderer.invoke("audio-capture-check-support"),
    setup: () => ipcRenderer.invoke("audio-capture-setup"),
    frames: () => ipcRenderer.invoke("audio-capture-frames"),
    teardown: () => ipcRenderer.invoke("audio-capture-teardown"),
  },

});

contextBridge.exposeInMainWorld("emberAPI", {
  invoke<D = unknown>(cmd: EmberCmd, args: object): Promise<EmberIpcResponse<D>> {
    return ipcRenderer.invoke("ember", { cmd, args }) as Promise<EmberIpcResponse<D>>;
  },
});

preloadLog("info", "Preload script ready, contextBridge API exposed");
