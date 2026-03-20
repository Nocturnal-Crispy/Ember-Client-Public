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

  // Mock window.emberLog (createLogger called at load time)
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  (window as any).emberLog = {
    createLogger: () => mockLogger,
  };
  // Store mockLogger globally for test access
  (window as any)._mockLogger = mockLogger;

  // Mock window.getValidAuth
  (window as any).getValidAuth = jest.fn().mockResolvedValue({
    token: 'tok',
    hostname: 'http://localhost:8085',
    user_id: 'u1',
    device_id: 'd1',
    username: 'alice'
  });

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

// ─── processIncomingDistributions ─────────────────────────────────────────────

describe('processIncomingDistributions', () => {
  it('should be assigned to window.processIncomingDistributions', () => {
    // This test reproduces the bug: window.processIncomingDistributions is undefined
    // because the assignment is missing in ember-manager.ts
    expect((window as any).processIncomingDistributions).toBeDefined();
  });

  it('should be a callable function', () => {
    expect(typeof (window as any).processIncomingDistributions).toBe('function');
  });

  it('should call processIncomingSenderKeyDistributions when invoked', async () => {
    // Mock the dependencies for processIncomingSenderKeyDistributions
    mockEmberApiInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'GetAuth') {
        return Promise.resolve({ 
          success: true, 
          data: { token: 'tok', userId: 'u1', deviceId: 'd1', hostname: 'http://localhost:8085', username: 'alice' }
        });
      }
      return Promise.resolve({ success: true, data: null });
    });

    // Mock fetch to return empty distributions
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ distributions: [] })
    });

    // This should call the function but will fail because window.processIncomingDistributions is undefined
    await expect((window as any).processIncomingDistributions?.()).resolves.not.toThrow();
  });
});

// ─── Self-Distribution Fix Tests ───────────────────────────────────────────

describe('Self-Distribution Fix for Solo Users', () => {
  beforeEach(() => {
    // Mock get-auth to return current user
    mockIpcInvoke.mockImplementation((channel: string) => {
      if (channel === 'get-auth') {
        return Promise.resolve({ 
          token: 'tok', 
          hostname: 'http://localhost:8085', 
          user_id: 'u1', 
          device_id: 'd1', 
          username: 'alice' 
        });
      }
      return Promise.resolve(null);
    });

    // Mock emberAPI for encryption
    mockEmberApiInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'GetAuth') {
        return Promise.resolve({ 
          success: true, 
          data: { token: 'tok', userId: 'u1', deviceId: 'd1', hostname: 'http://localhost:8085', username: 'alice' }
        });
      }
      if (cmd === 'LoadDistributionId') {
        return Promise.resolve({ success: true, data: { distribution_id: 'test-dist-id' } });
      }
      if (cmd === 'CreateSenderKeyDistribution') {
        return Promise.resolve({ success: true, data: { distributionMessage: 'test-dist-msg' } });
      }
      if (cmd === 'Encrypt') {
        return Promise.resolve({ success: true, data: { ciphertext: 'encrypted', messageType: 1 } });
      }
      return Promise.resolve({ success: true, data: null });
    });

    // Mock window.getValidAuth to return consistent auth data
    (window as any).getValidAuth = jest.fn().mockResolvedValue({
      token: 'tok',
      hostname: 'http://localhost:8085',
      user_id: 'u1',
      device_id: 'd1',
      username: 'alice'
    });
  });

  it('should create self-distribution even when no other members exist', async () => {
    // Mock empty members response (solo user scenario)
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/device-members')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ members: [] }) // Empty - solo user
        });
      }
      if (url.includes('/sender-key-distributions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    // This should not throw and should create a self-distribution
    const result = await (window as any).distributeSenderKeyToMembers?.('test-ember');
    expect(result).toBeUndefined(); // Function returns void

    // Verify that the distribution API was called with exactly 1 distribution (self)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8085/api/v1/embers/test-ember/sender-key-distributions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('recipient_user_id'),
      })
    );

    // Parse the request body to verify self-distribution
    const distributionCall = mockFetch.mock.calls.find(call => 
      call[0].includes('/sender-key-distributions')
    );
    expect(distributionCall).toBeDefined();
    
    const requestBody = JSON.parse(distributionCall![1].body);
    expect(requestBody.distributions).toHaveLength(1);
    expect(requestBody.distributions[0]).toMatchObject({
      recipient_user_id: 'u1',
      recipient_device_id: 'd1',
    });
  });

  it('should not duplicate self-distribution when user is in members list', async () => {
    // Mock members response that includes the current user
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/device-members')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ 
            members: [{ user_id: 'u1', device_id: 'd1' }] // Current user included
          })
        });
      }
      if (url.includes('/sender-key-distributions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    // This should create exactly 1 distribution (not 2)
    const result = await (window as any).distributeSenderKeyToMembers?.('test-ember');
    expect(result).toBeUndefined();

    const distributionCall = mockFetch.mock.calls.find(call => 
      call[0].includes('/sender-key-distributions')
    );
    const requestBody = JSON.parse(distributionCall![1].body);
    expect(requestBody.distributions).toHaveLength(1); // Should not duplicate
    expect(requestBody.distributions[0]).toMatchObject({
      recipient_user_id: 'u1',
      recipient_device_id: 'd1',
    });
  });

  it('should handle multiple members including self correctly', async () => {
    // Mock members response with current user + others
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/device-members')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ 
            members: [
              { user_id: 'u1', device_id: 'd1' }, // Current user
              { user_id: 'u2', device_id: 'd2' }, // Other user
            ]
          })
        });
      }
      if (url.includes('/sender-key-distributions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const result = await (window as any).distributeSenderKeyToMembers?.('test-ember');
    expect(result).toBeUndefined();

    const distributionCall = mockFetch.mock.calls.find(call => 
      call[0].includes('/sender-key-distributions')
    );
    const requestBody = JSON.parse(distributionCall![1].body);
    expect(requestBody.distributions).toHaveLength(2); // Self + 1 other
    expect(requestBody.distributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recipient_user_id: 'u1', recipient_device_id: 'd1' }),
        expect.objectContaining({ recipient_user_id: 'u2', recipient_device_id: 'd2' }),
      ])
    );
  });

  it('should establish Signal session with self before encrypting self-distribution', async () => {
    // Mock empty members response (solo user scenario)
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/device-members')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ members: [] }) // Empty - solo user
        });
      }
      if (url.includes('/sender-key-distributions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' })
        });
      }
      if (url.includes('/prekey-bundle')) {
        // This should be called for self-session establishment
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ registrationId: 1, deviceId: 'd1', identityKey: 'test-key' })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    // Track emberAPI calls to verify session establishment
    const emberApiCalls: string[] = [];
    mockEmberApiInvoke.mockImplementation((cmd: string) => {
      emberApiCalls.push(cmd);
      if (cmd === 'GetAuth') {
        return Promise.resolve({ 
          success: true, 
          data: { token: 'tok', userId: 'u1', deviceId: 'd1', hostname: 'http://localhost:8085', username: 'alice' }
        });
      }
      if (cmd === 'LoadDistributionId') {
        return Promise.resolve({ success: true, data: { distribution_id: 'test-dist-id' } });
      }
      if (cmd === 'CreateSenderKeyDistribution') {
        return Promise.resolve({ success: true, data: { distributionMessage: 'test-dist-msg' } });
      }
      if (cmd === 'LoadSession') {
        // First call for self-session should return null (no session exists)
        return Promise.resolve({ success: true, data: { record: null } });
      }
      if (cmd === 'ProcessPreKeyBundle') {
        return Promise.resolve({ success: true, data: null });
      }
      if (cmd === 'Encrypt') {
        return Promise.resolve({ success: true, data: { ciphertext: 'encrypted', messageType: 1 } });
      }
      return Promise.resolve({ success: true, data: null });
    });

    await (window as any).distributeSenderKeyToMembers?.('test-ember');

    // Verify session establishment sequence was called for self
    expect(emberApiCalls).toContain('LoadSession');
    expect(emberApiCalls).toContain('ProcessPreKeyBundle');
    
    // Verify the calls happened in the right order (LoadSession before Encrypt)
    const loadSessionIndex = emberApiCalls.indexOf('LoadSession');
    const encryptIndex = emberApiCalls.indexOf('Encrypt');
    expect(loadSessionIndex).toBeLessThan(encryptIndex);
  });
});

// ─── Race Condition: Messages Before Keys ───────────────────────────────────────

describe('Race Condition: Messages Before Keys', () => {
  beforeEach(() => {
    // Mock basic auth
    mockIpcInvoke.mockImplementation((channel: string) => {
      if (channel === 'get-auth') {
        return Promise.resolve({ 
          token: 'tok', 
          hostname: 'http://localhost:8085', 
          user_id: 'u1', 
          device_id: 'd1', 
          username: 'alice' 
        });
      }
      return Promise.resolve(null);
    });

    // Mock emberAPI for basic operations
    mockEmberApiInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'GetAuth') {
        return Promise.resolve({ 
          success: true, 
          data: { token: 'tok', userId: 'u1', deviceId: 'd1', hostname: 'http://localhost:8085', username: 'alice' }
        });
      }
      if (cmd === 'LoadDistributionId') {
        return Promise.resolve({ success: true, data: { distribution_id: 'test-dist-id' } });
      }
      if (cmd === 'CreateSenderKeyDistribution') {
        return Promise.resolve({ success: true, data: { distributionMessage: 'test-dist-msg' } });
      }
      return Promise.resolve({ success: true, data: null });
    });

    // Mock missing window functions for loadServerContent
    (window as any).fetchAndRenderVoicePresence = jest.fn().mockResolvedValue(undefined);
    (window as any).fetchMembers = jest.fn().mockResolvedValue([]);
    (window as any).renderMemberList = jest.fn();
    (window as any).wsSubscribeToEmber = jest.fn();
    (window as any).renderChannels = jest.fn();
    (window as any).electronAPI = {
      channelService: {
        fetchChannels: jest.fn().mockResolvedValue({ channels: [], categories: [] })
      }
    };
  });

  it('should distribute sender keys BEFORE loading channel messages', async () => {
    // Track the order of operations
    const operationOrder: string[] = [];
    
    // Mock fetch to track API calls
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/device-members')) {
        operationOrder.push('fetch-device-members');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ members: [] })
        });
      }
      if (url.includes('/sender-key-distributions')) {
        operationOrder.push('sender-key-distributions');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' })
        });
      }
      if (url.includes('/channels')) {
        operationOrder.push('fetch-channels');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ channels: [], categories: [] })
        });
      }
      if (url.includes('/messages')) {
        operationOrder.push('fetch-messages');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messages: [], has_more: false })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    // Mock emberAPI to track encryption calls
    mockEmberApiInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'GetAuth') {
        return Promise.resolve({ 
          success: true, 
          data: { token: 'tok', userId: 'u1', deviceId: 'd1', hostname: 'http://localhost:8085', username: 'alice' }
        });
      }
      if (cmd === 'LoadDistributionId') {
        operationOrder.push('load-distribution-id');
        return Promise.resolve({ success: true, data: { distribution_id: 'test-dist-id' } });
      }
      if (cmd === 'CreateSenderKeyDistribution') {
        operationOrder.push('create-sender-key-distribution');
        return Promise.resolve({ success: true, data: { distributionMessage: 'test-dist-msg' } });
      }
      if (cmd === 'Encrypt') {
        operationOrder.push('encrypt-self-distribution');
        return Promise.resolve({ success: true, data: { ciphertext: 'encrypted', messageType: 1 } });
      }
      return Promise.resolve({ success: true, data: null });
    });

    // Call loadServerContent which should fix the race condition
    await (window as any).loadServerContent?.('test-ember');

    // Verify sender key operations happen BEFORE message loading
    const senderKeyOps = operationOrder.filter(op => 
      op.includes('distribution') || op.includes('encrypt')
    );
    const messageOps = operationOrder.filter(op => 
      op.includes('messages') || op.includes('channels')
    );

    // All sender key operations should come before message operations
    const lastSenderKeyOp = Math.max(...senderKeyOps.map(op => operationOrder.lastIndexOf(op)));
    const firstMessageOp = Math.min(...messageOps.map(op => operationOrder.indexOf(op)));

    expect(lastSenderKeyOp).toBeLessThan(firstMessageOp);
  });

  it('should complete sender key distribution before processing messages', async () => {
    // Mock slow sender key distribution
    let distributionCompleted = false;
    
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/device-members')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ members: [] })
        });
      }
      if (url.includes('/sender-key-distributions')) {
        return new Promise(resolve => {
          setTimeout(() => {
            distributionCompleted = true;
            resolve({
              ok: true,
              json: () => Promise.resolve({ status: 'ok' })
            });
          }, 100); // Simulate slow network
        });
      }
      if (url.includes('/channels')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ channels: [], categories: [] })
        });
      }
      if (url.includes('/messages')) {
        // This should only be called AFTER distribution completes
        expect(distributionCompleted).toBe(true);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messages: [], has_more: false })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    // Mock emberAPI for encryption
    mockEmberApiInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'GetAuth') {
        return Promise.resolve({ 
          success: true, 
          data: { token: 'tok', userId: 'u1', deviceId: 'd1', hostname: 'http://localhost:8085', username: 'alice' }
        });
      }
      if (cmd === 'LoadDistributionId') {
        return Promise.resolve({ success: true, data: { distribution_id: 'test-dist-id' } });
      }
      if (cmd === 'CreateSenderKeyDistribution') {
        return Promise.resolve({ success: true, data: { distributionMessage: 'test-dist-msg' } });
      }
      if (cmd === 'Encrypt') {
        return Promise.resolve({ success: true, data: { ciphertext: 'encrypted', messageType: 1 } });
      }
      return Promise.resolve({ success: true, data: null });
    });

    await (window as any).loadServerContent?.('test-ember');

    // If we get here, the test passed (messages were fetched after distribution)
    expect(distributionCompleted).toBe(true);
  });
});
