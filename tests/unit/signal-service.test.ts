/**
 * Unit tests for the IPC-Backed Signal Service (Phase 4).
 *
 * All Signal Protocol operations are routed through window.emberAPI.invoke.
 * Tests mock window.emberAPI.invoke to return controlled EmberIpcResponse values.
 * The renderer never holds libsignal types or calls libsignal functions directly.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { EmberIpcResponse } from 'ember-shared';
import {
  SignalService,
  IpcSessionStore,
  IpcIdentityKeyStore,
  IpcPreKeyStore,
  IpcSignedPreKeyStore,
  EmberIpcError,
} from '../../src/renderer/services/signal-service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(s: string): Uint8Array {
  return new Uint8Array(atob(s).split('').map((c) => c.charCodeAt(0)));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockAuth = {
  token: 'test-token',
  user_id: 'user-123',
  device_id: 'device-1',
  hostname: 'api.test.com',
  username: 'testuser',
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('signal-service', () => {
  let mockInvoke: jest.MockedFunction<
    (cmd: string, args: object) => Promise<EmberIpcResponse<unknown>>
  >;
  let savedFetch: typeof globalThis.fetch;

  beforeEach(() => {
    mockInvoke = jest.fn<
      (cmd: string, args: object) => Promise<EmberIpcResponse<unknown>>
    >();
    (window as unknown as { emberAPI: { invoke: typeof mockInvoke } }).emberAPI = {
      invoke: mockInvoke,
    };
    savedFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  // ── IpcSessionStore ──────────────────────────────────────────────────────────

  describe('IpcSessionStore', () => {
    let store: IpcSessionStore;

    beforeEach(() => {
      store = new IpcSessionStore();
    });

    describe('storeSession', () => {
      it('calls invoke with StoreSession cmd and base64-encoded record', async () => {
        mockInvoke.mockResolvedValueOnce({ success: true, data: undefined });
        const address = 'alice.1';
        const record = new Uint8Array([1, 2, 3, 4]);

        await store.storeSession(address, record);

        expect(mockInvoke).toHaveBeenCalledWith('StoreSession', {
          address,
          record: toBase64(record),
        });
      });

      it('calls invoke once per storeSession call', async () => {
        mockInvoke.mockResolvedValue({ success: true, data: undefined });

        await store.storeSession('alice.1', new Uint8Array([1]));
        await store.storeSession('bob.1', new Uint8Array([2]));

        expect(mockInvoke).toHaveBeenCalledTimes(2);
      });
    });

    describe('loadSession', () => {
      it('returns null when data.record is null', async () => {
        mockInvoke.mockResolvedValueOnce({ success: true, data: { record: null } });

        const result = await store.loadSession('alice.1');

        expect(result).toBeNull();
        expect(mockInvoke).toHaveBeenCalledWith('LoadSession', { address: 'alice.1' });
      });

      it('returns decoded Uint8Array when data.record is a base64 string', async () => {
        const inputRecord = new Uint8Array([5, 6, 7, 8]);
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { record: toBase64(inputRecord) },
        });

        const result = await store.loadSession('alice.1');

        expect(result).not.toBeNull();
        expect(result).toEqual(inputRecord);
      });
    });

    describe('removeSession', () => {
      it('calls invoke with RemoveSession cmd and address', async () => {
        mockInvoke.mockResolvedValueOnce({ success: true, data: undefined });

        await store.removeSession('alice.1');

        expect(mockInvoke).toHaveBeenCalledWith('RemoveSession', { address: 'alice.1' });
      });
    });

    describe('getSubDeviceSessions', () => {
      it('returns an empty array (not implemented at IPC level)', async () => {
        const result = await store.getSubDeviceSessions('alice');
        expect(result).toEqual([]);
      });
    });
  });

  // ── IpcIdentityKeyStore ──────────────────────────────────────────────────────

  describe('IpcIdentityKeyStore', () => {
    let store: IpcIdentityKeyStore;

    beforeEach(() => {
      store = new IpcIdentityKeyStore(mockAuth);
    });

    describe('isTrustedIdentity — TOFU', () => {
      it('returns true on first contact when no identity key is stored', async () => {
        mockInvoke.mockResolvedValueOnce({ success: true, data: { identityKey: null } });

        const inputKey = new Uint8Array([1, 2, 3, 4, 5]);
        const result = await store.isTrustedIdentity('alice.1', inputKey, 'sending');

        expect(result).toBe(true);
        expect(mockInvoke).toHaveBeenCalledWith('LoadIdentity', { address: 'alice.1' });
      });

      it('returns true when stored key matches the input key', async () => {
        const key = new Uint8Array([10, 20, 30, 40, 50]);
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { identityKey: toBase64(key) },
        });

        const result = await store.isTrustedIdentity('alice.1', key, 'receiving');

        expect(result).toBe(true);
      });

      it('returns false when stored key differs from input key', async () => {
        const storedKey = new Uint8Array([10, 20, 30, 40, 50]);
        const differentKey = new Uint8Array([1, 2, 3, 4, 5]);
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { identityKey: toBase64(storedKey) },
        });

        const result = await store.isTrustedIdentity('alice.1', differentKey, 'sending');

        expect(result).toBe(false);
      });
    });

    describe('saveIdentity', () => {
      it('calls StoreIdentity with base64 key and returns changed flag', async () => {
        mockInvoke.mockResolvedValueOnce({ success: true, data: { changed: false } });
        const key = new Uint8Array([1, 2, 3]);

        const result = await store.saveIdentity('alice.1', key);

        expect(mockInvoke).toHaveBeenCalledWith('StoreIdentity', {
          address: 'alice.1',
          identityKey: toBase64(key),
        });
        expect(result).toBe(false);
      });

      it('returns true when StoreIdentity reports changed', async () => {
        mockInvoke.mockResolvedValueOnce({ success: true, data: { changed: true } });

        const result = await store.saveIdentity('bob.1', new Uint8Array([9, 8, 7]));

        expect(result).toBe(true);
      });
    });

    describe('getIdentity', () => {
      it('returns null when no identity is stored', async () => {
        mockInvoke.mockResolvedValueOnce({ success: true, data: { identityKey: null } });

        const result = await store.getIdentity('alice.1');

        expect(result).toBeNull();
      });

      it('returns decoded Uint8Array when identity key is present', async () => {
        const key = new Uint8Array([4, 5, 6]);
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { identityKey: toBase64(key) },
        });

        const result = await store.getIdentity('alice.1');

        expect(result).toEqual(key);
      });
    });
  });

  // ── IpcPreKeyStore ───────────────────────────────────────────────────────────

  describe('IpcPreKeyStore', () => {
    let store: IpcPreKeyStore;

    beforeEach(() => {
      store = new IpcPreKeyStore();
    });

    it('storePreKey calls StorePreKey with base64 record', async () => {
      mockInvoke.mockResolvedValueOnce({ success: true, data: undefined });
      const record = new Uint8Array([11, 22, 33]);

      await store.storePreKey(42, record);

      expect(mockInvoke).toHaveBeenCalledWith('StorePreKey', {
        id: 42,
        record: toBase64(record),
      });
    });

    it('loadPreKey returns null when data.record is null', async () => {
      mockInvoke.mockResolvedValueOnce({ success: true, data: { record: null } });

      const result = await store.loadPreKey(42);

      expect(result).toBeNull();
      expect(mockInvoke).toHaveBeenCalledWith('LoadPreKey', { id: 42 });
    });

    it('loadPreKey returns decoded bytes when record is present', async () => {
      const record = new Uint8Array([44, 55, 66]);
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: { record: toBase64(record) },
      });

      const result = await store.loadPreKey(7);

      expect(result).toEqual(record);
    });

    it('removePreKey calls RemovePreKey with id', async () => {
      mockInvoke.mockResolvedValueOnce({ success: true, data: undefined });

      await store.removePreKey(99);

      expect(mockInvoke).toHaveBeenCalledWith('RemovePreKey', { id: 99 });
    });
  });

  // ── IpcSignedPreKeyStore ─────────────────────────────────────────────────────

  describe('IpcSignedPreKeyStore', () => {
    let store: IpcSignedPreKeyStore;

    beforeEach(() => {
      store = new IpcSignedPreKeyStore();
    });

    it('storeSignedPreKey calls StoreSignedPreKey with base64 record', async () => {
      mockInvoke.mockResolvedValueOnce({ success: true, data: undefined });
      const record = new Uint8Array([77, 88, 99]);

      await store.storeSignedPreKey(1, record);

      expect(mockInvoke).toHaveBeenCalledWith('StoreSignedPreKey', {
        id: 1,
        record: toBase64(record),
      });
    });

    it('loadSignedPreKey returns null when data.record is null', async () => {
      mockInvoke.mockResolvedValueOnce({ success: true, data: { record: null } });

      const result = await store.loadSignedPreKey(1);

      expect(result).toBeNull();
    });

    it('loadSignedPreKey returns decoded bytes when record is present', async () => {
      const record = new Uint8Array([111, 122, 133]);
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: { record: toBase64(record) },
      });

      const result = await store.loadSignedPreKey(1);

      expect(result).toEqual(record);
    });
  });

  // ── SignalService ────────────────────────────────────────────────────────────

  describe('SignalService', () => {
    let service: SignalService;

    beforeEach(() => {
      service = new SignalService(mockAuth);
    });

    describe('getLocalDevice', () => {
      it('reads identity key and registration ID from safeStorage', async () => {
        const mockPublicKey = new Uint8Array([1, 2, 3, 4, 5]);
        const mockRegistrationId = '12345';

        mockInvoke
          .mockResolvedValueOnce({ success: true, data: { value: toBase64(mockPublicKey) } })
          .mockResolvedValueOnce({ success: true, data: { value: mockRegistrationId } });

        const result = await service.getLocalDevice();

        expect(mockInvoke).toHaveBeenNthCalledWith(1, 'GetSafeStorage', {
          key: 'identity_key_user-123_device-1',
        });
        expect(mockInvoke).toHaveBeenNthCalledWith(2, 'GetSafeStorage', {
          key: 'registration_id_user-123_device-1',
        });
        expect(result.publicKey).toEqual(mockPublicKey);
        expect(result.privateKey).toEqual(new Uint8Array(0)); // Private key not exposed
        expect(result.registrationId).toBe(12345);
      });

      it('throws error when identity key is not found', async () => {
        mockInvoke.mockResolvedValueOnce({ success: true, data: { value: null } });

        await expect(service.getLocalDevice()).rejects.toThrow('Identity key not found in secure storage');
      });

      it('throws error when registration ID is not found', async () => {
        mockInvoke
          .mockResolvedValueOnce({ success: true, data: { value: toBase64(new Uint8Array([1, 2, 3])) } })
          .mockResolvedValueOnce({ success: true, data: { value: null } });

        await expect(service.getLocalDevice()).rejects.toThrow('Registration ID not found in secure storage');
      });
    });

    describe('ensureSession', () => {
      it('calls ProcessPreKeyBundle when no session exists', async () => {
        const mockBundle = {
          registration_id: 1234,
          device_id: 1,
          prekey_id: 42,
          prekey_public: [1, 2, 3],
          signed_prekey_id: 1,
          signed_prekey_public: [4, 5, 6],
          signed_prekey_signature: [7, 8, 9],
          identity_key: [10, 11, 12],
        };

        mockInvoke
          .mockResolvedValueOnce({ success: true, data: { record: null } })
          .mockResolvedValueOnce({ success: true, data: undefined });

        globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockBundle),
        } as Response);

        await service.ensureSession('user-456', 'device-2');

        expect(mockInvoke).toHaveBeenNthCalledWith(1, 'LoadSession', {
          address: 'user-456.device-2',
        });
        expect(mockInvoke).toHaveBeenNthCalledWith(
          2,
          'ProcessPreKeyBundle',
          expect.objectContaining({
            recipientAddress: 'user-456.device-2',
            registrationId: mockBundle.registration_id,
          }),
        );
      });

      it('skips bundle fetch and ProcessPreKeyBundle when session already exists', async () => {
        const existingRecord = new Uint8Array([1, 2, 3]);
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { record: toBase64(existingRecord) },
        });

        await service.ensureSession('user-456', 'device-2');

        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(mockInvoke).toHaveBeenCalledWith('LoadSession', {
          address: 'user-456.device-2',
        });
      });
    });

    describe('encrypt', () => {
      it('calls Encrypt cmd and returns ciphertext as Uint8Array with messageType', async () => {
        const ciphertextBytes = new Uint8Array([20, 21, 22, 23]);
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { ciphertext: toBase64(ciphertextBytes), messageType: 3 },
        });

        const plaintext = new Uint8Array([1, 2, 3]);
        const result = await service.encrypt('alice.1', plaintext);

        expect(mockInvoke).toHaveBeenCalledWith('Encrypt', {
          recipientAddress: 'alice.1',
          plaintext: toBase64(plaintext),
        });
        expect(result.ciphertext).toEqual(ciphertextBytes);
        expect(result.messageType).toBe(3);
      });
    });

    describe('decrypt', () => {
      it('dispatches to DecryptPreKey when messageType is PreKey (3)', async () => {
        const plaintextBytes = new Uint8Array([30, 31, 32]);
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { plaintext: toBase64(plaintextBytes) },
        });

        const ciphertext = new Uint8Array([40, 41, 42]);
        const result = await service.decrypt('alice.1', ciphertext, 3);

        expect(mockInvoke).toHaveBeenCalledWith('DecryptPreKey', {
          senderAddress: 'alice.1',
          ciphertext: toBase64(ciphertext),
          messageType: 3,
        });
        expect(result).toEqual(plaintextBytes);
      });

      it('dispatches to Decrypt when messageType is Whisper (2)', async () => {
        const plaintextBytes = new Uint8Array([50, 51, 52]);
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { plaintext: toBase64(plaintextBytes) },
        });

        const ciphertext = new Uint8Array([60, 61, 62]);
        const result = await service.decrypt('alice.1', ciphertext, 2);

        expect(mockInvoke).toHaveBeenCalledWith('Decrypt', {
          senderAddress: 'alice.1',
          ciphertext: toBase64(ciphertext),
        });
        expect(result).toEqual(plaintextBytes);
      });
    });

    describe('groupEncrypt', () => {
      it('calls GroupEncrypt and returns ciphertext Uint8Array', async () => {
        const ciphertextBytes = new Uint8Array([70, 71, 72]);
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { ciphertext: toBase64(ciphertextBytes) },
        });

        const plaintext = new Uint8Array([1, 2, 3]);
        const result = await service.groupEncrypt('dist-uuid-1', plaintext);

        expect(mockInvoke).toHaveBeenCalledWith('GroupEncrypt', {
          distributionId: 'dist-uuid-1',
          plaintext: toBase64(plaintext),
        });
        expect(result).toEqual(ciphertextBytes);
      });
    });

    describe('groupDecrypt', () => {
      it('calls GroupDecrypt and returns plaintext Uint8Array', async () => {
        const plaintextBytes = new Uint8Array([80, 81, 82]);
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { plaintext: toBase64(plaintextBytes) },
        });

        const ciphertext = new Uint8Array([90, 91, 92]);
        const result = await service.groupDecrypt('alice.1', ciphertext);

        expect(mockInvoke).toHaveBeenCalledWith('GroupDecrypt', {
          senderAddress: 'alice.1',
          ciphertext: toBase64(ciphertext),
        });
        expect(result).toEqual(plaintextBytes);
      });
    });

    describe('createSenderKeyDistribution', () => {
      it('calls CreateSenderKeyDistribution and returns bytes', async () => {
        const distBytes = new Uint8Array([100, 101, 102]);
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { distributionMessage: toBase64(distBytes) },
        });

        const result = await service.createSenderKeyDistribution('dist-uuid-1');

        expect(mockInvoke).toHaveBeenCalledWith('CreateSenderKeyDistribution', {
          distributionId: 'dist-uuid-1',
        });
        expect(result).toEqual(distBytes);
      });
    });

    describe('processSenderKeyDistribution', () => {
      it('calls ProcessSenderKeyDistribution with base64 message', async () => {
        mockInvoke.mockResolvedValueOnce({ success: true, data: undefined });
        const distBytes = new Uint8Array([110, 111, 112]);

        await service.processSenderKeyDistribution('alice.1', distBytes);

        expect(mockInvoke).toHaveBeenCalledWith('ProcessSenderKeyDistribution', {
          senderAddress: 'alice.1',
          distributionMessage: toBase64(distBytes),
        });
      });
    });

    describe('hasSession', () => {
      it('returns true when a session record exists', async () => {
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { record: toBase64(new Uint8Array([1, 2, 3])) },
        });

        const result = await service.hasSession('user-456', 'device-2');

        expect(mockInvoke).toHaveBeenCalledWith('LoadSession', {
          address: 'user-456.device-2',
        });
        expect(result).toBe(true);
      });

      it('returns false when no session record exists', async () => {
        mockInvoke.mockResolvedValueOnce({
          success: true,
          data: { record: null },
        });

        const result = await service.hasSession('user-456', 'device-2');

        expect(result).toBe(false);
      });
    });

    describe('invoke helper — error handling', () => {
      it('throws EmberIpcError when response.success is false', async () => {
        mockInvoke.mockResolvedValueOnce({ success: false, error: 'Encryption failed' });

        const plaintext = new Uint8Array([1, 2, 3]);
        await expect(service.encrypt('alice.1', plaintext)).rejects.toBeInstanceOf(
          EmberIpcError,
        );
      });

      it('EmberIpcError carries the cmd name and error message', async () => {
        mockInvoke.mockResolvedValueOnce({ success: false, error: 'Key not found' });

        const plaintext = new Uint8Array([1, 2, 3]);
        try {
          await service.encrypt('alice.1', plaintext);
          expect(true).toBe(false); // must not reach here
        } catch (err) {
          expect(err).toBeInstanceOf(EmberIpcError);
          expect((err as EmberIpcError).message).toBe('Key not found');
          expect((err as EmberIpcError).cmd).toBe('Encrypt');
        }
      });

      it('EmberIpcError falls back to Unknown error when error field is absent', async () => {
        mockInvoke.mockResolvedValueOnce({ success: false });

        const plaintext = new Uint8Array([1, 2, 3]);
        try {
          await service.encrypt('alice.1', plaintext);
        } catch (err) {
          expect((err as EmberIpcError).message).toBe('Unknown error');
        }
      });
    });
  });
});
