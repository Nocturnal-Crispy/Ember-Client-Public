/**
 * Simple test to verify prekey endpoint path corrections
 */

describe('Prekey endpoint path corrections', () => {
  it('uploadSignedPreKey should use /api/v1/ endpoint', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = mockFetch;

    const { uploadSignedPreKey } = require('ember-shared');
    
    const mockAuth = {
      token: 'test-token',
      hostname: 'test.example.com',
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
      expect.any(Object)
    );
  });

  it('uploadOneTimePreKeys should use /api/v1/ endpoint', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = mockFetch;

    const { uploadOneTimePreKeys } = require('ember-shared');
    
    const mockAuth = {
      token: 'test-token',
      hostname: 'test.example.com',
    };

    const mockPreKeys = [
      {
        id: 1,
        keyPair: { publicKey: new Uint8Array([1, 2, 3]), privateKey: new Uint8Array([4, 5, 6]) },
      },
    ];

    await uploadOneTimePreKeys(mockAuth, mockPreKeys);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.example.com/api/v1/prekeys/one-time',
      expect.any(Object)
    );
  });

  it('getOneTimePreKeyCount should use /api/v1/ endpoint', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: 25 }),
    });
    global.fetch = mockFetch;

    const { getOneTimePreKeyCount } = require('ember-shared');
    
    const mockAuth = {
      token: 'test-token',
      hostname: 'test.example.com',
    };

    await getOneTimePreKeyCount(mockAuth);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.example.com/api/v1/prekeys/one-time/count',
      expect.any(Object)
    );
  });

  it('fetchPreKeyBundle should continue using /api/v1/ endpoint', async () => {
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
      hostname: 'test.example.com',
    };

    await fetchPreKeyBundle(mockAuth, 'user-123', 'device-456');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.example.com/api/v1/users/user-123/devices/device-456/prekey-bundle',
      expect.any(Object)
    );
  });
});
