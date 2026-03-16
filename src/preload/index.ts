import type { AuthData, DeviceIdentity } from "ember-shared";
import { contextBridge, ipcRenderer } from "electron";
import * as nacl from "tweetnacl";
import * as naclUtil from "tweetnacl-util";
import * as emberCrypto from "ember-shared";
import * as emberServices from "ember-shared";
import { refreshToken } from "./services/token-refresh-service";
import { getTokenExpiry, isTokenExpiringSoon } from "./utils/token-utils";
const { IPC_CHANNELS } = require("../shared/constants");

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

  if (
    savedTheme &&
    document.documentElement &&
    isValidPreloadRgb(savedTheme.accentRgb) &&
    isValidPreloadRgb(savedTheme.backgroundRgb) &&
    isValidPreloadRgb(savedTheme.surfaceRgb)
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
  } else if (savedTheme) {
    preloadLog("warn", "Theme settings failed validation in preload; skipping early application");
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
  "get-screen-sources",
  "audio-capture-check-support",
  "audio-capture-setup",
  "audio-capture-frames",
  "audio-capture-teardown",
];

const ALLOWED_ON: readonly string[] = [
  "handle-invite-link",
  "update-download-progress",
  "update-download-complete",
  "update-download-error",
  "window-blur",
  "window-focus",
];

preloadLog("debug", "Setting up contextBridge API");

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
          preloadLog("debug", "Returning pending invite:", { invite });
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
          preloadLog("debug", `IPC received on channel ${channel}:`, { args });
          if (channel === "handle-invite-link" && args.length > 0) {
            // Store the invite data to work around context bridge argument passing issues
            pendingInvite = args[0] as { code: string; hostname: string | null };
            preloadLog("debug", "Stored pending invite:", { pendingInvite });
            // Just call the listener without arguments to trigger the invite processing
            listener();
          } else {
            preloadLog("debug", `Calling listener with ${args.length} arguments`);
            try {
              listener(...args);
              preloadLog("debug", `Listener called successfully`);
            } catch (error) {
              preloadLog("error", `Error calling listener:`, { error: String(error) });
            }
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

  nacl: {
    randomBytes: (n: number) => nacl.randomBytes(n),
    box: (m: Uint8Array, n: Uint8Array, pk: Uint8Array, sk: Uint8Array) =>
      nacl.box(m, n, pk, sk),
    boxOpen: (b: Uint8Array, n: Uint8Array, pk: Uint8Array, sk: Uint8Array) =>
      nacl.box.open(b, n, pk, sk),
    boxKeyPair: () => nacl.box.keyPair(),
    secretbox: (m: Uint8Array, n: Uint8Array, k: Uint8Array) =>
      nacl.secretbox(m, n, k),
    secretboxOpen: (b: Uint8Array, n: Uint8Array, k: Uint8Array) =>
      nacl.secretbox.open(b, n, k),
    BOX_NONCE_LENGTH: nacl.box.nonceLength as number,
    SECRETBOX_NONCE_LENGTH: nacl.secretbox.nonceLength as number,
    SECRETBOX_KEY_LENGTH: nacl.secretbox.keyLength as number,
  },

  naclUtil: {
    encodeBase64: (data: Uint8Array) => naclUtil.encodeBase64(data),
    decodeBase64: (str: string) => naclUtil.decodeBase64(str),
    encodeUTF8: (data: Uint8Array) => naclUtil.encodeUTF8(data),
    decodeUTF8: (str: string) => naclUtil.decodeUTF8(str),
  },

  crypto: {
    generateRecoveryCode: () => {
      preloadLog("debug", "Crypto: generateRecoveryCode");
      return emberCrypto.generateRecoveryCode();
    },
    encryptPrivateKeyWithRecoveryCode: (
      privateKey: Uint8Array,
      recoveryCode: string
    ) => {
      preloadLog("debug", "Crypto: encryptPrivateKeyWithRecoveryCode");
      return emberCrypto.encryptPrivateKeyWithRecoveryCode(
        privateKey,
        recoveryCode
      );
    },
    decryptPrivateKeyWithRecoveryCode: (
      encryptedBase64: string,
      recoveryCode: string,
      saltBase64: string
    ) => {
      preloadLog("debug", "Crypto: decryptPrivateKeyWithRecoveryCode");
      return emberCrypto.decryptPrivateKeyWithRecoveryCode(
        encryptedBase64,
        recoveryCode,
        saltBase64
      );
    },
    generateEmberKey: () => {
      preloadLog("debug", "Crypto: generateEmberKey");
      return emberCrypto.generateEmberKey();
    },
    encryptEmberKeyForUser: (
      emberKey: Uint8Array,
      recipientPublicKey: Uint8Array,
      senderPrivateKey: Uint8Array
    ) => {
      preloadLog("debug", "Crypto: encryptEmberKeyForUser");
      return emberCrypto.encryptEmberKeyForUser(
        emberKey,
        recipientPublicKey,
        senderPrivateKey
      );
    },
    decryptEmberKeyForUser: (
      encryptedBase64: string,
      senderPublicKey: Uint8Array,
      recipientPrivateKey: Uint8Array
    ) => {
      preloadLog("debug", "Crypto: decryptEmberKeyForUser");
      return emberCrypto.decryptEmberKeyForUser(
        encryptedBase64,
        senderPublicKey,
        recipientPrivateKey
      );
    },
    encryptMessage: (plaintext: string, emberKey: Uint8Array) => {
      preloadLog("debug", "Crypto: encryptMessage");
      return emberCrypto.encryptMessage(plaintext, emberKey);
    },
    decryptMessage: (ciphertextBase64: string, emberKey: Uint8Array) => {
      preloadLog("debug", "Crypto: decryptMessage");
      return emberCrypto.decryptMessage(ciphertextBase64, emberKey);
    },
    encryptFileBytes: (fileBytes: Uint8Array, key: Uint8Array): string => {
      const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
      const cipherBytes = nacl.secretbox(fileBytes, nonce, key);
      const combined = new Uint8Array(nonce.length + cipherBytes.length);
      combined.set(nonce, 0);
      combined.set(cipherBytes, nonce.length);
      return naclUtil.encodeBase64(combined);
    },
    decryptFileBytes: (encryptedBase64: string, key: Uint8Array): Uint8Array | null => {
      const combined = naclUtil.decodeBase64(encryptedBase64);
      const nonce = combined.slice(0, nacl.secretbox.nonceLength);
      const cipher = combined.slice(nacl.secretbox.nonceLength);
      return nacl.secretbox.open(cipher, nonce, key);
    },
    encryptEmberKeyForInvite: (emberKey: Uint8Array, inviteCode: string) => {
      preloadLog("debug", "Crypto: encryptEmberKeyForInvite");
      return emberCrypto.encryptEmberKeyForInvite(emberKey, inviteCode);
    },
    decryptEmberKeyFromInvite: (
      encryptedBase64: string,
      inviteCode: string,
      saltBase64: string
    ) => {
      preloadLog("debug", "Crypto: decryptEmberKeyFromInvite");
      return emberCrypto.decryptEmberKeyFromInvite(
        encryptedBase64,
        inviteCode,
        saltBase64
      );
    },
  },

  authService: {
    generateDeviceIdentity: () => emberServices.generateDeviceIdentity(),
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
      plaintext: string,
      emberKey: Uint8Array
    ) =>
      emberServices.sendMessage(
        auth as AuthData,
        channelId,
        plaintext,
        emberKey
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
      plaintext: string,
      emberKey: Uint8Array
    ) =>
      emberServices.editMessage(
        auth as AuthData,
        channelId,
        messageId,
        plaintext,
        emberKey
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

preloadLog("info", "Preload script ready, contextBridge API exposed");
