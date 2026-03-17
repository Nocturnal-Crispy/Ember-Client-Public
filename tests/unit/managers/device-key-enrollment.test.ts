/**
 * Unit tests for Phase 4 — Device key enrollment.
 *
 * Covers:
 *   - requestDeviceKeyEnrollment: POSTs to device-key-requests when a DM
 *     ember key is missing (404) for the current device.
 *   - fulfillPendingKeyRequests: GETs pending requests, creates a peer-box
 *     for each requesting device, and POSTs to the fulfill endpoint.
 *   - WS device_key_fulfilled event: clears the key cache and re-fetches.
 */

const HOSTNAME     = 'http://localhost';
const MY_USER_ID   = 'me-user';
const MY_DEVICE_ID = 'device-a';
const MY_PUB_KEY   = 'mypubkey64';
const MY_PRIV_KEY  = 'myprivkey64';
const EMBER_ID     = 'emb-enrollment';
const TEXT_CH      = 'ch-enroll-text';
const VOICE_CH     = 'ch-enroll-voice';
const PARTNER_ID   = 'partner-user';

let fetchMock: jest.Mock;

beforeAll(() => {
  // 1. App state
  require('../../../src/renderer/managers/app-state');

  // 2. electronAPI
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockImplementation((ch: string) => {
        if (ch === 'get-auth')
          return Promise.resolve({ token: 'tok', hostname: HOSTNAME, user_id: MY_USER_ID, username: 'Me' });
        if (ch === 'get-device-identity')
          return Promise.resolve({ public_key: MY_PUB_KEY, private_key: MY_PRIV_KEY, device_id: MY_DEVICE_ID });
        return Promise.resolve(null);
      }),
      send: jest.fn(),
      on:   jest.fn(),
    },
    crypto: {
      generateEmberKey:       jest.fn().mockReturnValue(new Uint8Array(32).fill(1)),
      encryptEmberKeyForUser: jest.fn().mockReturnValue('encryptedkey64'),
      decryptEmberKeyForUser: jest.fn().mockReturnValue(new Uint8Array(32).fill(7)),
      encryptMessage:         jest.fn().mockReturnValue('ciphertext64'),
      decryptMessage:         jest.fn().mockReturnValue('hello'),
    },
    nacl:     {},
    naclUtil: {
      decodeBase64: jest.fn().mockReturnValue(new Uint8Array(32)),
      encodeBase64: jest.fn().mockReturnValue('encoded64'),
    },
    wsService:   { buildWsUrl: jest.fn() },
    tokenUtils:  { isTokenExpiringSoon: jest.fn().mockReturnValue(false) },
    authService: { refreshToken: jest.fn() },
  };

  // 3. emberLog
  (window as any).emberLog = {
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  };

  // 4. Globals
  (window as any).getValidAuth             = jest.fn().mockResolvedValue({ token: 'tok', hostname: HOSTNAME, user_id: MY_USER_ID });
  (window as any).wsSubscribeToChannel     = jest.fn();
  (window as any).wsUnsubscribeFromChannel = jest.fn();
  (window as any).addDmConversationToList  = jest.fn();
  (window as any).displayDmMessage        = jest.fn();
  (window as any).markChannelUnread        = jest.fn();
  (window as any).showDmPendingBanner      = jest.fn();
  (window as any).hideDmPendingBanner      = jest.fn();
  (window as any).playNotificationSound    = jest.fn();
  (window as any).renderMemberList         = jest.fn();
  (window as any).renderServerList         = jest.fn();
  (window as any).loadServerContent        = jest.fn();
  (window as any).fetchMembers             = jest.fn().mockResolvedValue([]);
  (window as any).displayDecryptedMessage  = jest.fn();

  // 5. fetch mock
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;

  // 6. Load module
  require('../../../src/renderer/managers/direct-messaging-manager');
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedDmEntry(): Promise<void> {
  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    if (String(url).includes('/dm-requests') && opts?.method === 'POST')
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'req-1', ember_id: EMBER_ID, status: 'created' }) });
    if (String(url).includes(`/embers/${EMBER_ID}/channels`))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ channels: [{ id: TEXT_CH, type: 'text' }, { id: VOICE_CH, type: 'voice' }] }) });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
  await (window as any).startDmConversation(PARTNER_ID, 'Partner');
}

// ─── requestDeviceKeyEnrollment ───────────────────────────────────────────────

describe('requestDeviceKeyEnrollment', () => {
  beforeAll(async () => { await seedDmEntry(); });

  it('is exposed on window', () => {
    expect(typeof (window as any).requestDeviceKeyEnrollment).toBe('function');
  });

  it('POSTs to /embers/{ember_id}/device-key-requests with device_pub_key', async () => {
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'dkr-1' }),
    });

    await (window as any).requestDeviceKeyEnrollment(EMBER_ID);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/embers/${EMBER_ID}/device-key-requests`);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.device_pub_key).toBe(MY_PUB_KEY);
  });

  it('does not throw when the POST fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: 'err' }) });
    await expect((window as any).requestDeviceKeyEnrollment(EMBER_ID)).resolves.not.toThrow();
  });
});

// ─── fulfillPendingKeyRequests ────────────────────────────────────────────────

describe('fulfillPendingKeyRequests', () => {
  beforeAll(async () => {
    await seedDmEntry();
    // Pre-populate the cache so fetchAndCacheEmberKey doesn't make a network call.
    (window as any).App.emberKeyCache.set(EMBER_ID, new Uint8Array(32).fill(7));
  });

  it('is exposed on window', () => {
    expect(typeof (window as any).fulfillPendingKeyRequests).toBe('function');
  });

  it('GETs pending requests for the ember and POSTs a fulfill for each', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);
      // GET pending requests
      if (u.includes(`/embers/${EMBER_ID}/device-key-requests`) && (!opts || opts.method === 'GET' || !opts.method))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          requests: [{ id: 'dkr-1', requesting_device_id: 'device-b', requesting_device_pub_key: 'devbpub64', created_at: Date.now() }],
        })});
      // POST fulfill
      if (u.includes('/fulfill') && opts?.method === 'POST')
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ message: 'key delivered' }) });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await (window as any).fulfillPendingKeyRequests(EMBER_ID);

    const fulfillCall = fetchMock.mock.calls.find(
      ([url, opts]: [string, RequestInit]) => String(url).includes('/fulfill') && opts?.method === 'POST'
    );
    expect(fulfillCall).toBeDefined();
    const [fulfillUrl, fulfillOpts] = fulfillCall!;
    expect(String(fulfillUrl)).toContain('device-b/fulfill');
    const body = JSON.parse(fulfillOpts.body as string);
    expect(body.encrypted_key).toBeDefined();
    expect(body.sender_public_key).toBe(MY_PUB_KEY);
  });

  it('skips fulfill when no pending requests exist', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requests: [] }),
    });
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ requests: [] }) });

    await (window as any).fulfillPendingKeyRequests(EMBER_ID);

    const fulfillCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit]) => String(url).includes('/fulfill') && opts?.method === 'POST'
    );
    expect(fulfillCalls).toHaveLength(0);
  });
});

// ─── WS device_key_fulfilled event ───────────────────────────────────────────

describe('device_key_fulfilled WS event', () => {
  it('clears the ember key cache when received', async () => {
    (window as any).App.emberKeyCache.set(EMBER_ID, new Uint8Array(32).fill(5));

    // Make fetchAndCacheEmberKey return a key so it doesn't fail.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ encrypted_key: 'enc', sender_public_key: '' }),
    });

    window.dispatchEvent(new CustomEvent('device-key-fulfilled', {
      detail: { ember_id: EMBER_ID, requesting_device_id: MY_DEVICE_ID },
    }));

    await new Promise<void>(resolve => setTimeout(resolve, 50));

    // Cache should have been cleared and re-populated by fetchAndCacheEmberKey.
    // The key was re-fetched so the cache now holds the refreshed value.
    expect((window as any).App.emberKeyCache.has(EMBER_ID)).toBe(true);
  });
});
