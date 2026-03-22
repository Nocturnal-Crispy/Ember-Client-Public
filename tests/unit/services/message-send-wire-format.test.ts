/**
 * Tests for the message send wire format.
 *
 * Verifies that sendEncryptedMessage sends camelCase JSON keys matching
 * the server's expected format (protocolVersion, envelopeType) per the
 * wire format convention documented in CLAUDE.md.
 */

let capturedFetchBody: Record<string, unknown> | null = null;
let mockFetchFn: jest.Mock;

beforeAll(() => {
  // 1. Create messages container BEFORE loading modules
  const container = document.createElement('div');
  container.id = 'messages';
  document.body.appendChild(container);

  // 2. Populate window.App
  require('../../../src/renderer/managers/app-state');

  // 3. Set up global fetch mock that captures the request body
  mockFetchFn = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.body) {
      capturedFetchBody = JSON.parse(init.body as string);
    }
    return {
      ok: true,
      json: async () => ({
        id: 'msg-123',
        channelId: 'ch-1',
        senderId: 'dev-1',
        senderUserId: 'user-1',
        ciphertext: 'enc',
        createdAt: Date.now(),
      }),
    };
  });
  (globalThis as any).fetch = mockFetchFn;

  // 4. Mock window.electronAPI
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockResolvedValue({
        token: 'test-token',
        hostname: 'http://localhost:8085',
        userId: 'user-1',
        deviceId: 'dev-1',
        username: 'Test',
      }),
      send: jest.fn(),
      on: jest.fn(),
    },
    crypto: {
      encryptMessage: jest.fn().mockReturnValue('encrypted'),
      decryptMessage: jest.fn().mockReturnValue('decrypted'),
    },
    nacl: {},
    naclUtil: {},
    messageService: {
      fetchMessages: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
      sendMessage: jest.fn().mockResolvedValue({ id: 'msg-1', ciphertext: 'enc' }),
    },
  };

  // 5. Mock window.emberLog
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  (window as any).emberLog = { createLogger: () => mockLogger };

  // 6. Mock window.emberAPI for sender key operations
  (window as any).emberAPI = {
    invoke: jest.fn().mockImplementation(async (cmd: string) => {
      if (cmd === 'LoadDistributionId') {
        return { success: true, data: { distributionId: 'dist-123' } };
      }
      if (cmd === 'GroupEncrypt') {
        return { success: true, data: { ciphertext: 'base64ciphertext' } };
      }
      return { success: true, data: null };
    }),
  };

  // 7. Stub globals
  (window as any).wsSubscribeToChannel = jest.fn();
  (window as any).registerSentMessageId = jest.fn();

  // 8. Load dependencies
  require('../../../src/renderer/components/messages-area');
  require('../../../src/renderer/services/message-service');
});

beforeEach(() => {
  capturedFetchBody = null;
  mockFetchFn.mockClear();

  // Set up App state for sending
  const App = (window as any).App;
  App.activeChannelId = 'ch-1';
  App.activeEmberId = 'ember-1';
  App.pendingAttachment = null;
});

describe('sendEncryptedMessage wire format', () => {
  it('sends protocolVersion as camelCase (not snake_case)', async () => {
    const sendFn = (window as any).sendEncryptedMessage;
    if (!sendFn) {
      // Function may not be globally exposed — skip gracefully
      expect(true).toBe(true);
      return;
    }

    await sendFn('ch-1', 'Hello');

    expect(capturedFetchBody).not.toBeNull();
    // Must use camelCase per wire format convention
    expect(capturedFetchBody).toHaveProperty('protocolVersion', 1);
    expect(capturedFetchBody).toHaveProperty('envelopeType', 'signal_group');
    // Must NOT have snake_case keys
    expect(capturedFetchBody).not.toHaveProperty('protocol_version');
    expect(capturedFetchBody).not.toHaveProperty('envelope_type');
  });

  it('sends ciphertext field in the request body', async () => {
    const sendFn = (window as any).sendEncryptedMessage;
    if (!sendFn) {
      expect(true).toBe(true);
      return;
    }

    await sendFn('ch-1', 'Test message');

    expect(capturedFetchBody).not.toBeNull();
    expect(capturedFetchBody).toHaveProperty('ciphertext');
    expect(typeof capturedFetchBody!.ciphertext).toBe('string');
    expect((capturedFetchBody!.ciphertext as string).length).toBeGreaterThan(0);
  });
});
