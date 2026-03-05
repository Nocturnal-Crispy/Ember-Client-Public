import { contextBridge, ipcRenderer } from "electron";
import * as nacl from "tweetnacl";
import * as naclUtil from "tweetnacl-util";
import * as emberCrypto from "ember-shared";
import * as emberServices from "ember-shared";

// Preload-side logger — sends directly via ipcRenderer (bypasses the contextBridge allowlist)
function preloadLog(
  level: string,
  message: string,
  data?: Record<string, unknown>
) {
  try {
    ipcRenderer.send("log-to-console", {
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
  "check-for-update",
  "open-external-url",
];

const ALLOWED_ON: readonly string[] = ["handle-invite-link"];

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
        return ipcRenderer.invoke(channel, ...args);
      }
      preloadLog("warn", `Blocked IPC invoke on unlisted channel: ${channel}`);
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    },
    on(channel: string, listener: (...args: unknown[]) => void) {
      if (ALLOWED_ON.includes(channel)) {
        ipcRenderer.on(channel, (_event, ...args) => listener(...args));
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
  },

  emberService: {
    fetchEmbers: (auth: unknown) => emberServices.fetchEmbers(auth as AuthData),
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
});

preloadLog("info", "Preload script ready, contextBridge API exposed");
