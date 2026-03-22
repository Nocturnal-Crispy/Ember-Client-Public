/**
 * Unit tests for Phase 3:
 *   BP-4 — sendDirectMessage optimistically renders the message immediately.
 *   BP-5 — WS echo for an optimistically-rendered message is deduplicated.
 *
 * The IIFE module is loaded once in beforeAll; internal state persists across
 * all tests in this file, which is intentional for the send → echo flow.
 */

const HOSTNAME = 'http://localhost';
const MY_USER_ID = 'me-123';
const PARTNER_ID = 'partner-456';
const EMBER_ID = 'emb-bp345';
const TEXT_CH = 'ch-text-bp345';
const VOICE_CH = 'ch-voice-bp345';
const PLAINTEXT = 'Hello Phase 3!';
const MSG_ID = 'msg-optimistic-1';

let fetchMock: jest.Mock;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  // 1. Bootstrap App state
  require('../../../src/renderer/managers/app-state');
  const App = (window as any).App;
  App.activeChannelId = null;
  App.currentMembers = [];
  App.signalSessionManager = {
    ensureSession: jest.fn().mockResolvedValue(undefined),
    hasSession: jest.fn().mockResolvedValue(true),
    encrypt: jest.fn().mockResolvedValue({
      ciphertext: new Uint8Array([10, 11, 12]),
      messageType: 3,
    }),
  };

  // 2. electronAPI mock
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockImplementation((ch: string) => {
        if (ch === 'get-auth')
          return Promise.resolve({
            token: 'tok',
            hostname: HOSTNAME,
            user_id: MY_USER_ID,
            username: 'Me',
          });
        if (ch === 'get-device-identity')
          return Promise.resolve({
            public_key: 'pubkey64',
            private_key: 'privkey64',
            device_id: 'dev-1',
          });
        return Promise.resolve(null);
      }),
      send: jest.fn(),
      on: jest.fn(),
    },
    crypto: {
      generateEmberKey: jest.fn().mockReturnValue(new Uint8Array(32).fill(1)),
      encryptEmberKeyForUser: jest.fn().mockReturnValue('encryptedkey64'),
      decryptEmberKeyForUser: jest.fn().mockReturnValue(new Uint8Array(32).fill(7)),
      encryptMessage: jest.fn().mockReturnValue('ciphertext64'),
      decryptMessage: jest.fn().mockReturnValue(PLAINTEXT),
      // Legacy decrypt not used during hard cutover.
    },
    nacl: {},
    naclUtil: {
      decodeBase64: jest.fn().mockReturnValue(new Uint8Array(32)),
      encodeBase64: jest.fn().mockReturnValue('encoded64'),
    },
    wsService: { buildWsUrl: jest.fn() },
    tokenUtils: { isTokenExpiringSoon: jest.fn().mockReturnValue(false) },
    authService: { refreshToken: jest.fn() },
  };

  // 3. emberLog mock
  (window as any).emberLog = {
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  };

  // 4. Globals used by the module
  (window as any).getValidAuth = jest
    .fn()
    .mockResolvedValue({ token: 'tok', hostname: HOSTNAME, user_id: MY_USER_ID });
  (window as any).getDevice = jest
    .fn()
    .mockResolvedValue({ public_key: 'pubkey64', private_key: 'privkey64' });
  (window as any).wsSubscribeToChannel = jest.fn();
  (window as any).wsUnsubscribeFromChannel = jest.fn();
  (window as any).addDmConversationToList = jest.fn();
  (window as any).displayDmMessage = jest.fn();
  (window as any).markChannelUnread = jest.fn();
  (window as any).showDmPendingBanner = jest.fn();
  (window as any).hideDmPendingBanner = jest.fn();
  (window as any).playNotificationSound = jest.fn();
  (window as any).renderMemberList = jest.fn();
  (window as any).renderServerList = jest.fn();
  (window as any).loadServerContent = jest.fn();
  (window as any).fetchMembers = jest.fn().mockResolvedValue([]);
  (window as any).displayDecryptedMessage = jest.fn();

  // 5. fetch mock
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;

  // 6. Load IIFE module
  require('../../../src/renderer/managers/direct-messaging-manager');
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedDmEntry(): Promise<void> {
  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    if (String(url).includes(`/users/${PARTNER_ID}/devices`) && !opts?.method) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            devices: [{ id: 'partner-dev-1', public_key: 'partnerPub', protocol_version: 1 }],
          }),
      } as Response);
    }
    if (String(url).includes('/dm-requests') && opts?.method === 'POST')
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'req-1', ember_id: EMBER_ID, status: 'created' }),
      });
    if (String(url).includes(`/embers/${EMBER_ID}/channels`))
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            channels: [
              { id: TEXT_CH, type: 'text' },
              { id: VOICE_CH, type: 'voice' },
            ],
          }),
      });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
  await (window as any).startDmConversation(PARTNER_ID, 'Partner');
}

function mockMessagePost(msgId: string): void {
  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    if (String(url).includes(`/channels/${TEXT_CH}/messages`) && opts?.method === 'POST')
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: msgId }) });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

// ─── BP-4: Optimistic render ──────────────────────────────────────────────────

describe('BP-4: sendDirectMessage — optimistic render', () => {
  beforeAll(async () => {
    await seedDmEntry();
    mockMessagePost(MSG_ID);
  });

  beforeEach(() => {
    (window as any).displayDmMessage.mockClear();
  });

  it('calls displayDmMessage after a successful POST', async () => {
    await (window as any).sendDirectMessage(TEXT_CH, PLAINTEXT);
    expect((window as any).displayDmMessage).toHaveBeenCalledTimes(1);
  });

  it('displays the message with isOwn: true', async () => {
    await (window as any).sendDirectMessage(TEXT_CH, PLAINTEXT);
    const msg = (window as any).displayDmMessage.mock.calls[0][0];
    expect(msg.isOwn).toBe(true);
  });

  it('displays the original plaintext content', async () => {
    await (window as any).sendDirectMessage(TEXT_CH, PLAINTEXT);
    const msg = (window as any).displayDmMessage.mock.calls[0][0];
    expect(msg.content).toBe(PLAINTEXT);
  });

  it('displays the server-assigned message id', async () => {
    await (window as any).sendDirectMessage(TEXT_CH, PLAINTEXT);
    const msg = (window as any).displayDmMessage.mock.calls[0][0];
    expect(msg.id).toBe(MSG_ID);
  });

  it('displays the correct conversationId', async () => {
    await (window as any).sendDirectMessage(TEXT_CH, PLAINTEXT);
    const msg = (window as any).displayDmMessage.mock.calls[0][0];
    expect(msg.conversationId).toBe(TEXT_CH);
  });
});

// ─── BP-5: Dedup ──────────────────────────────────────────────────────────────

describe('BP-5: dm-channel-message — dedup for optimistically rendered messages', () => {
  const DEDUP_ID = 'msg-dedup-xyz';

  beforeAll(async () => {
    // Send a message so DEDUP_ID lands in pendingMessageIds.
    mockMessagePost(DEDUP_ID);
    await (window as any).sendDirectMessage(TEXT_CH, 'seed for dedup');
  });

  beforeEach(() => {
    (window as any).displayDmMessage.mockClear();
  });

  it('does NOT call displayDmMessage when WS echo arrives for an optimistically rendered id', async () => {
    window.dispatchEvent(
      new CustomEvent('dm-channel-message', {
        detail: {
          id: DEDUP_ID,
          channel_id: TEXT_CH,
          sender_user_id: MY_USER_ID,
          ciphertext: 'enc',
          created_at: Date.now() / 1000,
        },
      })
    );
    // Wait long enough for the async handler to complete if dedup were not working.
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    expect((window as any).displayDmMessage).not.toHaveBeenCalled();
  });

  it('calls displayDmMessage for a new message from the other party', async () => {
    window.dispatchEvent(
      new CustomEvent('dm-channel-message', {
        detail: {
          id: 'msg-from-partner-999',
          channel_id: TEXT_CH,
          sender_user_id: PARTNER_ID,
          ciphertext: 'enc',
          created_at: Date.now() / 1000,
        },
      })
    );
    await new Promise<void>(resolve => setTimeout(resolve, 50));

    expect((window as any).displayDmMessage).toHaveBeenCalledTimes(1);
    const msg = (window as any).displayDmMessage.mock.calls[0][0];
    expect(msg.id).toBe('msg-from-partner-999');
    expect(msg.isOwn).toBe(false);
  });
});

// ─── HIGH-07: DM placeholder key cryptographic correctness ────────────────────────

describe('HIGH-07: DM placeholder key cryptographic correctness', () => {
  const UNIQUE_PARTNER_ID = 'partner-high-07-unique';

  beforeEach(() => {
    fetchMock.mockClear();
    // Mock successful device fetch
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes(`/users/${UNIQUE_PARTNER_ID}/devices`) && !opts?.method) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              devices: [{ id: 'partner-dev-1', public_key: 'partnerPub', protocol_version: 1 }],
            }),
        } as Response);
      }
      if (String(url).includes('/dm-requests') && opts?.method === 'POST')
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'req-1', ember_id: 'emb-high07', status: 'created' }),
        });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
  });

  it('uses crypto.getRandomValues instead of Math.random fallback', async () => {
    // Mock crypto.getRandomValues to track if it's called
    const mockGetRandomValues = jest.fn().mockImplementation((array: Uint8Array) => {
      array.fill(42); // Fill with predictable value for testing
      return array;
    });

    // Override the global crypto to mock getRandomValues
    Object.defineProperty(global, 'crypto', {
      value: {
        getRandomValues: mockGetRandomValues,
      },
      writable: true,
    });

    await (window as any).startDmConversation(UNIQUE_PARTNER_ID, 'Partner');

    // Verify crypto.getRandomValues was called instead of Math.random
    expect(mockGetRandomValues).toHaveBeenCalled();

    // Get the POST request that was made
    const postCall = fetchMock.mock.calls.find(call => call[1]?.method === 'POST');
    expect(postCall).toBeDefined();

    const requestBody = JSON.parse(postCall![1]!.body as string);
    const encryptedKeySelf = requestBody.encrypted_key_self;

    // Should be base64 of 32 random bytes (not 56 bytes with fake nonce)
    const decoded = Buffer.from(encryptedKeySelf, 'base64');
    expect(decoded.length).toBe(32); // Should be 32 bytes, not 56 (32+24 fake nonce)
    expect(decoded.every(byte => byte === 42)).toBe(true); // Should contain our mocked values
  });

  it('does not include fake nonce structure in encrypted_key_self', async () => {
    // Reset fetch mock for this test
    fetchMock.mockClear();
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes(`/users/${UNIQUE_PARTNER_ID}/devices`) && !opts?.method) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              devices: [{ id: 'partner-dev-1', public_key: 'partnerPub', protocol_version: 1 }],
            }),
        } as Response);
      }
      if (String(url).includes('/dm-requests') && opts?.method === 'POST')
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'req-2', ember_id: 'emb-high07-2', status: 'created' }),
        });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await (window as any).startDmConversation(`${UNIQUE_PARTNER_ID}-2`, 'Partner');

    // Get the POST request that was made
    const postCall = fetchMock.mock.calls.find(call => call[1]?.method === 'POST');
    expect(postCall).toBeDefined();

    const requestBody = JSON.parse(postCall![1]!.body as string);
    const encryptedKeySelf = requestBody.encrypted_key_self;

    // Decode and verify it's exactly 32 bytes (no 24-byte zero nonce appended)
    const decoded = Buffer.from(encryptedKeySelf, 'base64');
    expect(decoded.length).toBe(32);
  });
});
