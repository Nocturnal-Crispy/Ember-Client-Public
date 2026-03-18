/**
 * Unit tests for src/renderer/managers/ember-manager.ts
 *
 * The IIFE captures globals at load time. We set up all required mocks first,
 * then require() the module. DOM elements referenced at load time (modal buttons,
 * etc.) will be null — the code guards every access with optional chaining so
 * this is safe.
 *
 * Tests cover:
 *   - fetchEmbers: returns [] when get-auth returns null
 *   - fetchEmbers: returns [] when the server responds with an error
 *   - fetchEmberKey: cache hit returns the cached key without a network call
 *   - fetchEmberKey: returns null when get-auth returns null
 */

let mockIpcInvoke: jest.Mock;
let mockEmberApiInvoke: jest.Mock;
let mockFetch: jest.Mock;
let mockEmberServiceFetchEmbers: jest.Mock;
let mockChannelServiceFetchChannels: jest.Mock;

beforeAll(() => {
  // 1. Populate window.App
  require('../../../src/renderer/managers/app-state');

  // 2. Load auth-loader to make getValidAuth available globally
  require('../../../src/renderer/utils/auth-loader');

  // 3. Mock window.electronAPI (used directly by ember-manager's own IPC calls)
  mockIpcInvoke = jest.fn().mockImplementation((channel: string) => {
    if (channel === 'get-auth') {
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  });
  mockEmberServiceFetchEmbers = jest.fn().mockResolvedValue([]);
  mockChannelServiceFetchChannels = jest.fn().mockResolvedValue({ channels: [], categories: [] });
  (window as any).electronAPI = {
    ipc: {
      invoke: mockIpcInvoke,
      send: jest.fn(),
      on: jest.fn(),
    },
    crypto: {
      generateEmberKey: jest.fn().mockReturnValue(new Uint8Array(32)),
      encryptEmberKeyForUser: jest.fn().mockReturnValue('encrypted-key'),
      decryptEmberKeyForUser: jest.fn().mockReturnValue(null),
      encryptEmberKeyForInvite: jest.fn().mockResolvedValue({ encrypted: 'enc', salt: 'salt' }),
    },
    nacl: {},
    naclUtil: {
      decodeBase64: jest.fn().mockReturnValue(new Uint8Array(32)),
      encodeBase64: jest.fn().mockReturnValue('base64string'),
    },
    emberService: {
      fetchEmbers: mockEmberServiceFetchEmbers,
    },
    channelService: {
      fetchChannels: mockChannelServiceFetchChannels,
    },
  };

  // 3b. Mock window.emberAPI (used by auth-loader's getValidAuth)
  mockEmberApiInvoke = jest.fn().mockImplementation((cmd: string) => {
    if (cmd === 'GetAuth') {
      return Promise.resolve({ success: true, data: null });
    }
    return Promise.resolve({ success: true, data: null });
  });
  (window as any).emberAPI = {
    invoke: mockEmberApiInvoke,
  };

  // 3. Mock window.emberLog
  (window as any).emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  // 4. Stubs required by ember-manager (called from event handlers / async fns)
  (window as any).openJoinServerModal = jest.fn();
  (window as any).renderChannels = jest.fn();
  (window as any).fetchMembers = jest.fn().mockResolvedValue([]);
  (window as any).renderMemberList = jest.fn();
  (window as any).wsSubscribeToEmber = jest.fn();
  (window as any).hideWelcomeScreen = jest.fn();
  (window as any).showWelcomeScreen = jest.fn();

  // 5. Mock global fetch (still needed for ember key and other direct fetch calls)
  mockFetch = jest.fn();
  (global as any).fetch = mockFetch;

  // 6. Load the IIFE
  require('../../../src/renderer/managers/ember-manager');
});

beforeEach(() => {
  // Reset App state between tests
  (window as any).App.activeEmberId = null;
  (window as any).App.emberKeyCache.clear();
  (window as any).App.currentEmbers = [];
  mockEmberServiceFetchEmbers.mockClear();
  mockChannelServiceFetchChannels.mockClear();
  mockIpcInvoke.mockReset();
  mockEmberApiInvoke.mockReset();
  // Reset the default implementations
  mockIpcInvoke.mockImplementation((channel: string) => {
    if (channel === 'get-auth') {
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  });
  mockEmberApiInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'GetAuth') {
      return Promise.resolve({ success: true, data: null });
    }
    return Promise.resolve({ success: true, data: null });
  });
});

// ─── fetchEmbers ──────────────────────────────────────────────────────────────

describe('fetchEmbers', () => {
  it('returns an empty array when get-auth returns null', async () => {
    mockIpcInvoke.mockResolvedValueOnce(null);
    const result = await (window as any).fetchEmbers();
    expect(result).toEqual([]);
    expect(mockEmberServiceFetchEmbers).not.toHaveBeenCalled();
  });

  it('returns an empty array when get-auth returns an object without a token', async () => {
    // emberAPI returns no data → getValidAuth returns null → fetchEmbers returns []
    mockEmberApiInvoke.mockResolvedValueOnce({ success: true, data: null });
    const result = await (window as any).fetchEmbers();
    expect(result).toEqual([]);
    expect(mockEmberServiceFetchEmbers).not.toHaveBeenCalled();
  });

  it('returns an empty array when the service throws', async () => {
    mockEmberApiInvoke.mockResolvedValueOnce({
      success: true,
      data: { token: 'tok', userId: 'u1', deviceId: 'd1', hostname: 'http://localhost:8085', username: 'alice' },
    });
    mockIpcInvoke.mockImplementationOnce((channel: string) => {
      if (channel === 'get-auth') {
        return Promise.resolve({ token: 'tok', hostname: 'http://localhost:8085', user_id: 'u1', device_id: 'd1', username: 'alice' });
      }
      return Promise.resolve(null);
    });
    mockEmberServiceFetchEmbers.mockRejectedValueOnce(new Error('forbidden'));
    const result = await (window as any).fetchEmbers();
    expect(result).toEqual([]);
  });

  it('returns the embers array from a successful response', async () => {
    const mockEmbers = [
      { id: 'e-1', name: 'Ember One' },
      { id: 'e-2', name: 'Ember Two' },
    ];
    mockEmberApiInvoke.mockResolvedValueOnce({
      success: true,
      data: { token: 'tok', userId: 'u1', deviceId: 'd1', hostname: 'http://localhost:8085', username: 'alice' },
    });
    mockIpcInvoke.mockImplementationOnce((channel: string) => {
      if (channel === 'get-auth') {
        return Promise.resolve({ token: 'tok', hostname: 'http://localhost:8085', user_id: 'u1', device_id: 'd1', username: 'alice' });
      }
      return Promise.resolve(null);
    });
    mockEmberServiceFetchEmbers.mockResolvedValueOnce(mockEmbers);
    const result = await (window as any).fetchEmbers();
    expect(result).toEqual(mockEmbers);
  });

  it('returns an empty array when the service rejects', async () => {
    mockEmberApiInvoke.mockResolvedValueOnce({
      success: true,
      data: { token: 'tok', userId: 'u1', deviceId: 'd1', hostname: 'http://localhost:8085', username: 'alice' },
    });
    mockIpcInvoke.mockImplementationOnce((channel: string) => {
      if (channel === 'get-auth') {
        return Promise.resolve({ token: 'tok', hostname: 'http://localhost:8085', user_id: 'u1', device_id: 'd1', username: 'alice' });
      }
      return Promise.resolve(null);
    });
    mockEmberServiceFetchEmbers.mockRejectedValueOnce(new Error('network error'));
    const result = await (window as any).fetchEmbers();
    expect(result).toEqual([]);
  });
});

// ─── fetchEmberKey ────────────────────────────────────────────────────────────

describe('fetchEmberKey', () => {
  it('returns the cached key immediately without a network call on cache hit', async () => {
    const cachedKey = new Uint8Array(32).fill(7);
    (window as any).App.emberKeyCache.set('e-cache', cachedKey);

    const result = await (window as any).fetchEmberKey('e-cache');

    expect(result).toEqual(cachedKey);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when get-auth returns null (cache miss)', async () => {
    mockIpcInvoke.mockResolvedValue(null);
    const result = await (window as any).fetchEmberKey('e-miss');
    expect(result).toBeNull();
  });

  it('returns null when get-device-identity is not available (cache miss)', async () => {
    mockIpcInvoke
      .mockImplementationOnce((channel: string) => {
        if (channel === 'get-auth') {
          return Promise.resolve({ token: 'tok', hostname: 'http://localhost:8085', user_id: 'u1', device_id: 'd1', username: 'alice' });
        }
        return Promise.resolve(null);
      }) // get-auth
      .mockResolvedValueOnce(null); // get-device-identity
    const result = await (window as any).fetchEmberKey('e-no-device');
    expect(result).toBeNull();
  });
});
