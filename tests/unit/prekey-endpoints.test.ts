/**
 * Unit tests for prekey endpoint path corrections
 *
 * Tests that prekey upload endpoints use /api/v1/ instead of /v1/
 * to match the server's API route registration.
 */

describe('Prekey endpoint path corrections', () => {
  describe('uploadSignedPreKey', () => {
    it('should use /api/v1/prekeys/signed endpoint', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      global.fetch = mockFetch;

      const { uploadSignedPreKey } = require('ember-shared');
      
      const mockAuth = {
        token: 'test-token',
        hostname: 'https://test.example.com',
      };

      const mockSignedPreKey = {
        id: 1,
        keyPair: { publicKey: new Uint8Array([1, 2, 3]), privateKey: new Uint8Array([4, 5, 6]) },
        signature: new Uint8Array([7, 8, 9]),
        timestamp: Date.now(),
      };

      await uploadSignedPreKey(mockAuth, mockSignedPreKey);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/prekeys/signed',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          }),
        })
      );
    });

    it('should NOT use the old /v1/prekeys/signed endpoint', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = mockFetch;

      const { uploadSignedPreKey } = require('ember-shared');
      
      const mockAuth = {
        token: 'test-token',
        hostname: 'https://test.example.com',
      };

      const mockSignedPreKey = {
        id: 1,
        keyPair: { publicKey: new Uint8Array([1, 2, 3]), privateKey: new Uint8Array([4, 5, 6]) },
        signature: new Uint8Array([7, 8, 9]),
        timestamp: Date.now(),
      };

      await uploadSignedPreKey(mockAuth, mockSignedPreKey);

      // Should not have been called with the old endpoint
      expect(mockFetch).not.toHaveBeenCalledWith(
        'https://test.example.com/v1/prekeys/signed',
        expect.any(Object)
      );
    });
  });

  describe('uploadOneTimePreKeys', () => {
    it('should use /api/v1/prekeys/one-time endpoint', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = mockFetch;

      const { uploadOneTimePreKeys } = require('ember-shared');
      
      const mockAuth = {
        token: 'test-token',
        hostname: 'https://test.example.com',
      };

      const mockPreKeys = [
        {
          id: 1,
          keyPair: { publicKey: new Uint8Array([1, 2, 3]), privateKey: new Uint8Array([4, 5, 6]) },
        },
        {
          id: 2,
          keyPair: { publicKey: new Uint8Array([7, 8, 9]), privateKey: new Uint8Array([10, 11, 12]) },
        },
      ];

      await uploadOneTimePreKeys(mockAuth, mockPreKeys);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/prekeys/one-time',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          }),
        })
      );
    });

    it('should NOT use the old /v1/prekeys/one-time endpoint', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = mockFetch;

      const { uploadOneTimePreKeys } = require('ember-shared');
      
      const mockAuth = {
        token: 'test-token',
        hostname: 'https://test.example.com',
      };

      const mockPreKeys = [
        {
          id: 1,
          keyPair: { publicKey: new Uint8Array([1, 2, 3]), privateKey: new Uint8Array([4, 5, 6]) },
        },
      ];

      await uploadOneTimePreKeys(mockAuth, mockPreKeys);

      // Should not have been called with the old endpoint
      expect(mockFetch).not.toHaveBeenCalledWith(
        'https://test.example.com/v1/prekeys/one-time',
        expect.any(Object)
      );
    });
  });

  describe('getOneTimePreKeyCount', () => {
    it('should use /api/v1/prekeys/one-time/count endpoint', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ count: 25 }),
      });
      global.fetch = mockFetch;

      const { getOneTimePreKeyCount } = require('ember-shared');
      
      const mockAuth = {
        token: 'test-token',
        hostname: 'https://test.example.com',
      };

      const count = await getOneTimePreKeyCount(mockAuth);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/prekeys/one-time/count',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );
      expect(count).toBe(25);
    });

    it('should NOT use the old /v1/prekeys/one-time/count endpoint', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ count: 25 }),
      });
      global.fetch = mockFetch;

      const { getOneTimePreKeyCount } = require('ember-shared');
      
      const mockAuth = {
        token: 'test-token',
        hostname: 'https://test.example.com',
      };

      await getOneTimePreKeyCount(mockAuth);

      // Should not have been called with the old endpoint
      expect(mockFetch).not.toHaveBeenCalledWith(
        'https://test.example.com/v1/prekeys/one-time/count',
        expect.any(Object)
      );
    });
  });

  describe('fetchPreKeyBundle', () => {
    it('should continue using /api/v1/users/{userId}/devices/{deviceId}/prekey-bundle endpoint', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          registration_id: 1,
          device_id: 1,
          prekey_id: 1,
          prekey_public: new Uint8Array([1, 2, 3]),
          signed_prekey_id: 1,
          signed_prekey_public: new Uint8Array([4, 5, 6]),
          signed_prekey_signature: new Uint8Array([7, 8, 9]),
          identity_key: new Uint8Array([10, 11, 12]),
        }),
      });
      global.fetch = mockFetch;

      const { fetchPreKeyBundle } = require('ember-shared');
      
      const mockAuth = {
        token: 'test-token',
        hostname: 'https://test.example.com',
      };

      const bundle = await fetchPreKeyBundle(mockAuth, 'user-123', 'device-456');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/users/user-123/devices/device-456/prekey-bundle',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );
      expect(bundle).toEqual({
        registrationId: 1,
        deviceId: 1,
        preKeyId: 1,
        preKey: new Uint8Array([1, 2, 3]),
        signedPreKeyId: 1,
        signedPreKey: new Uint8Array([4, 5, 6]),
        signedPreKeySignature: new Uint8Array([7, 8, 9]),
        identityKey: new Uint8Array([10, 11, 12]),
      });
    });
  });
});
