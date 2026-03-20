/**
 * @jest-environment jsdom
 *
 * Integration tests for the DM Signal Protocol flow.
 *
 * Verifies that direct-messaging-manager.ts correctly routes:
 *   - startDmConversation  → SignalService.ensureSession for Signal-capable peers
 *   - sendDirectMessage    → SignalService.encrypt + signal_dm envelope when a session exists
 *   - handleIncomingMessage → SignalService.decrypt for signal_dm envelope messages
 *   - handleIncomingMessage → hard cutover placeholder for messages without envelope_type
 */

import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';

// ── Constants ────────────────────────────────────────────────────────────────

const BOB_USER_ID = 'bob-id';
const BOB_DEVICE_ID = 'bob-device';
const ALICE_USER_ID = 'alice-id';
const ALICE_DEVICE_ID = 'alice-device';
const EMBER_ID = 'ember-1';
const TEXT_CHANNEL_ID = 'ch-text-1';

// ── Signal service mock ──────────────────────────────────────────────────────

const mockEnsureSession = jest.fn<(userId: string, deviceId: string) => Promise<void>>().mockResolvedValue(undefined);
const mockHasSession = jest.fn<(userId: string, deviceId: string) => Promise<boolean>>();
const mockEncrypt = jest.fn<(addr: string, plain: Uint8Array) => Promise<{ ciphertext: Uint8Array; messageType: number }>>();
const mockDecrypt = jest.fn<(addr: string, ct: Uint8Array, type: number) => Promise<Uint8Array>>();

const mockSignalService = {
  ensureSession: mockEnsureSession,
  hasSession: mockHasSession,
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
};

// ── NaCl crypto mocks ────────────────────────────────────────────────────────

const mockDecryptNaCl = jest.fn<(ciphertext: string, key: Uint8Array) => string | null>() as jest.MockedFunction<(ciphertext: string, key: Uint8Array) => string | null>;
const mockEncryptNaCl = jest.fn<(plaintext: string, key: Uint8Array) => string>(
  () => 'nacl-ciphertext',
);
const mockGenerateEmberKey = jest.fn<() => Uint8Array>(() => new Uint8Array([1, 2, 3]));

// ── Auth ─────────────────────────────────────────────────────────────────────

const mockAuth = {
  token: 'test-token',
  hostname: 'https://api.test.com',
  user_id: ALICE_USER_ID,
  device_id: ALICE_DEVICE_ID,
  username: 'alice',
};

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function buildFetchMock(): jest.MockedFunction<typeof fetch> {
  return jest.fn<typeof fetch>().mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (url.includes(`/users/${BOB_USER_ID}/devices`)) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            devices: [{ id: BOB_DEVICE_ID, public_key: 'bW9ja0tleQ==', protocol_version: 1 }],
          }),
      } as Response);
    }
    if (url.includes('/api/v1/dm-requests') && !url.includes('/accept') && !url.includes('/decline')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ id: 'req-1', ember_id: EMBER_ID, status: 'pending' }),
      } as Response);
    }
    if (url.includes(`/embers/${EMBER_ID}/channels`)) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ channels: [{ id: TEXT_CHANNEL_ID, type: 'text' }] }),
      } as Response);
    }
    if (url.includes(`/channels/${TEXT_CHANNEL_ID}/messages`)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'msg-1' }),
      } as Response);
    }
    // dm-requests listing (polling) — return empty
    if (url.includes('/api/v1/dm-requests')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ requests: [] }),
      } as Response);
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
  });
}

// ── Module bootstrap ──────────────────────────────────────────────────────────

function setupWindowGlobals(): void {
  Object.assign(window, {
    App: {
      emberKeyCache: new Map<string, Uint8Array>(),
      signalSessionReady: new Map<string, boolean>(),
      signalSessionManager: mockSignalService,
      ownedMessageIds: new Set<string>(),
      activeChannelId: null,
      activeEmberId: null,
      currentEmbers: [],
      currentMembers: [],
    },
    getValidAuth: jest
      .fn<() => Promise<typeof mockAuth>>()
      .mockResolvedValue(mockAuth),
    emberLog: {
      createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }),
    },
    electronAPI: {
      ipc: {
        invoke: jest.fn<(channel: string) => Promise<unknown>>().mockResolvedValue({
          device_id: ALICE_DEVICE_ID,
          public_key: 'alicePubBase64',
          private_key: 'alicePrivBase64',
        }),
        send: jest.fn(),
        on: jest.fn(),
      },
      crypto: {
        generateEmberKey: mockGenerateEmberKey,
        encryptMessage: mockEncryptNaCl,
        encryptEmberKeyForUser: jest.fn<() => string>(() => 'peerBoxBase64'),
        decryptEmberKeyForUser: jest.fn<() => Uint8Array>(() => new Uint8Array([9, 9, 9])),
      },
      naclUtil: {
        decodeBase64: jest.fn<(s: string) => Uint8Array>(() => new Uint8Array([4, 5, 6])),
        encodeBase64: jest.fn<(b: Uint8Array) => string>(() => 'mockEncBase64'),
      },
    },
    emberAPI: { invoke: jest.fn() },
    addDmConversationToList: jest.fn(),
    wsSubscribeToChannel: jest.fn(),
    displayDmMessage: jest.fn(),
    showDmPendingBanner: jest.fn(),
    hideDmPendingBanner: jest.fn(),
    playNotificationSound: jest.fn(),
    wsUnsubscribeFromChannel: jest.fn(),
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('dm-signal-flow', () => {
  beforeAll(() => {
    setupWindowGlobals();
    globalThis.fetch = buildFetchMock();

    jest.isolateModules(() => {
      require('../../src/renderer/managers/direct-messaging-manager');
    });
  });

  beforeEach(() => {
    globalThis.fetch = buildFetchMock();
  });

  // ── startDmConversation ──────────────────────────────────────────────────────

  describe('startDmConversation — Signal-capable peer', () => {
    it('calls ensureSession when peer device reports protocol_version 1', async () => {
      await (
        window as Window & {
          startDmConversation(id: string, name: string): Promise<string>;
        }
      ).startDmConversation(BOB_USER_ID, 'Bob');

      expect(mockEnsureSession).toHaveBeenCalledWith(BOB_USER_ID, BOB_DEVICE_ID);
    });
  });

  // ── sendDirectMessage ────────────────────────────────────────────────────────

  describe('sendDirectMessage', () => {
    it('uses Signal encrypt and sends signal_dm envelope when session exists', async () => {
      const ciphertextBytes = new Uint8Array([10, 11, 12]);
      mockHasSession.mockResolvedValueOnce(true);
      mockEncrypt.mockResolvedValueOnce({ ciphertext: ciphertextBytes, messageType: 3 });

      await (
        window as Window & {
          sendDirectMessage(channelId: string, text: string): Promise<string>;
        }
      ).sendDirectMessage(TEXT_CHANNEL_ID, 'hello Signal');

      expect(mockEncrypt).toHaveBeenCalledWith(
        `${BOB_USER_ID}.${BOB_DEVICE_ID}`,
        expect.anything(),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/channels/${TEXT_CHANNEL_ID}/messages`),
        expect.objectContaining({
          body: expect.stringContaining('"envelope_type":"signal_dm"'),
        }),
      );
    });

    it('throws migration required when signalSessionManager has no session', async () => {
      mockHasSession.mockResolvedValueOnce(false);

      await expect(
        (
          window as Window & {
            sendDirectMessage(channelId: string, text: string): Promise<string>;
          }
        ).sendDirectMessage(TEXT_CHANNEL_ID, 'hello legacy')
      ).rejects.toThrow(/Migration required/i);
    });
  });

  // ── handleIncomingMessage ─────────────────────────────────────────────────────

  describe('handleIncomingMessage', () => {
    it('calls SignalService.decrypt for messages with envelope_type signal_dm', async () => {
      const ciphertextBytes = new Uint8Array([20, 21, 22]);
      const plaintextBytes = new TextEncoder().encode('decrypted signal message');
      const ciphertextBase64 = btoa(String.fromCharCode(...ciphertextBytes));

      mockDecrypt.mockResolvedValueOnce(plaintextBytes);

      window.dispatchEvent(
        new CustomEvent('dm-channel-message', {
          detail: {
            id: 'msg-signal-1',
            channel_id: TEXT_CHANNEL_ID,
            sender_user_id: BOB_USER_ID,
            sender_device_id: BOB_DEVICE_ID,
            ciphertext: ciphertextBase64,
            envelope_type: 'signal_dm',
            message_type: 3,
            created_at: Date.now() / 1000,
          },
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockDecrypt).toHaveBeenCalledWith(
        `${BOB_USER_ID}.${BOB_DEVICE_ID}`,
        expect.any(Uint8Array),
        3,
      );
      expect(
        (window as unknown as { displayDmMessage: jest.Mock }).displayDmMessage,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'decrypted signal message' }),
      );
    });

    it('uses legacy NaCl decrypt for messages without envelope_type', async () => {
      window.dispatchEvent(
        new CustomEvent('dm-channel-message', {
          detail: {
            id: 'msg-legacy-1',
            channel_id: TEXT_CHANNEL_ID,
            sender_user_id: BOB_USER_ID,
            ciphertext: 'legacy-ciphertext-b64',
            created_at: Date.now() / 1000,
          },
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockDecrypt).not.toHaveBeenCalled();
      expect(
        (window as unknown as { displayDmMessage: jest.Mock }).displayDmMessage,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '[This message cannot be decrypted — unsupported envelope]',
        }),
      );
    });
  });
});
