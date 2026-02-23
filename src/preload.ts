import { contextBridge, ipcRenderer } from 'electron';

const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');
const emberCrypto = require('../public/crypto');

const ALLOWED_SEND: readonly string[] = [
  'window-minimize',
  'window-maximize',
  'window-close',
  'auth-success',
  'auth-logout',
];

const ALLOWED_INVOKE: readonly string[] = [
  'get-device-identity',
  'save-device-identity',
  'get-auth',
  'save-auth',
  'get-last-hostname',
  'get-voice-video-settings',
  'save-voice-video-settings',
];

const ALLOWED_ON: readonly string[] = ['handle-invite-link'];

contextBridge.exposeInMainWorld('electronAPI', {
  ipc: {
    send(channel: string, ...args: unknown[]) {
      if (ALLOWED_SEND.includes(channel)) {
        ipcRenderer.send(channel, ...args);
      }
    },
    invoke(channel: string, ...args: unknown[]) {
      if (ALLOWED_INVOKE.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    },
    on(channel: string, listener: (...args: unknown[]) => void) {
      if (ALLOWED_ON.includes(channel)) {
        ipcRenderer.on(channel, (_event, ...args) => listener(...args));
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
    generateRecoveryCode: () =>
      emberCrypto.generateRecoveryCode(),
    encryptPrivateKeyWithRecoveryCode: (privateKey: Uint8Array, recoveryCode: string) =>
      emberCrypto.encryptPrivateKeyWithRecoveryCode(privateKey, recoveryCode),
    decryptPrivateKeyWithRecoveryCode: (encryptedBase64: string, recoveryCode: string, saltBase64: string) =>
      emberCrypto.decryptPrivateKeyWithRecoveryCode(encryptedBase64, recoveryCode, saltBase64),
    generateEmberKey: () =>
      emberCrypto.generateEmberKey(),
    encryptEmberKeyForUser: (emberKey: Uint8Array, recipientPublicKey: Uint8Array, senderPrivateKey: Uint8Array) =>
      emberCrypto.encryptEmberKeyForUser(emberKey, recipientPublicKey, senderPrivateKey),
    decryptEmberKeyForUser: (encryptedBase64: string, senderPublicKey: Uint8Array, recipientPrivateKey: Uint8Array) =>
      emberCrypto.decryptEmberKeyForUser(encryptedBase64, senderPublicKey, recipientPrivateKey),
    encryptMessage: (plaintext: string, emberKey: Uint8Array) =>
      emberCrypto.encryptMessage(plaintext, emberKey),
    decryptMessage: (ciphertextBase64: string, emberKey: Uint8Array) =>
      emberCrypto.decryptMessage(ciphertextBase64, emberKey),
    encryptEmberKeyForInvite: (emberKey: Uint8Array, inviteCode: string) =>
      emberCrypto.encryptEmberKeyForInvite(emberKey, inviteCode),
    decryptEmberKeyFromInvite: (encryptedBase64: string, inviteCode: string, saltBase64: string) =>
      emberCrypto.decryptEmberKeyFromInvite(encryptedBase64, inviteCode, saltBase64),
  },
});
