/**
 * Unit tests for pre-acceptance DM messaging (feature/pre-acceptance-dm-messaging).
 *
 * PA-1  startDmConversation — generates ember key and sends encrypted_key_self
 *        + peer_box in the DM request body so the requester can message before acceptance.
 * PA-2  startDmConversation — caches the ember key immediately so sendDirectMessage
 *        works without waiting for acceptance.
 * PA-3  sendDirectMessage — succeeds on a pending (requester) DM now that the key
 *        exists in cache. Must NOT throw "X hasn't accepted your message request yet".
 * PA-4  fetchConversationMessages — no longer short-circuits on a pending DM;
 *        calls the key API and returns decrypted messages.
 * PA-5  acceptDMRequest — posts an empty body (no key generation client-side),
 *        then triggers a key fetch so the recipient gets the pre-computed peer-box.
 */

const HOSTNAME             = 'http://localhost';
const MY_USER_ID           = 'user-me-pa';
const PARTNER_ID           = 'user-partner-pa';
const PARTNER_NAME         = 'Alice';
const RECIPIENT_DEVICE_PUB = 'recippub64';
const EMBER_ID             = 'emb-pa-1';
const TEXT_CH              = 'ch-pa-text';
const REQUEST_ID           = 'req-pa-1';

// PA-5 — a second DM where the current user is the RECIPIENT
const REQUESTER_ID         = 'user-requester-pa';
const REQUESTER_USERNAME   = 'Bob';
const RECIPIENT_EMBER_ID   = 'emb-pa-recipient-1';
const RECIPIENT_TEXT_CH    = 'ch-pa-recipient-text';
const RECIPIENT_REQUEST_ID = 'req-pa-recipient-1';

let fetchMock: jest.Mock;

// Body captured from the DM-request POST so PA-1 can inspect it after beforeAll runs.
let capturedDmRequestBody: {
  user_id?: string;
  encrypted_key_self?: string;
  peer_box?: { recipient_id: string; encrypted_key: string; sender_public_key: string };
} | null = null;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  require('../../../src/renderer/managers/app-state');

  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockImplementation((ch: string) => {
        if (ch === 'get-auth')
          return Promise.resolve({ token: 'tok', hostname: HOSTNAME, user_id: MY_USER_ID, username: 'Me' });
        if (ch === 'get-device-identity')
          return Promise.resolve({ public_key: 'mypub64', private_key: 'mypriv64', device_id: 'my-dev-1' });
        return Promise.resolve(null);
      }),
      send: jest.fn(),
      on:   jest.fn(),
    },
    crypto: {
      generateEmberKey:       jest.fn().mockReturnValue(new Uint8Array(32).fill(2)),
      encryptEmberKeyForUser: jest.fn().mockReturnValue('enckey64'),
      decryptEmberKeyForUser: jest.fn().mockReturnValue(new Uint8Array(32).fill(2)),
      encryptMessage:         jest.fn().mockReturnValue('cipher64'),
      decryptMessage:         jest.fn().mockReturnValue('decrypted content'),
    },
    nacl:     {},
    naclUtil: {
      decodeBase64: jest.fn().mockReturnValue(new Uint8Array(32)),
      encodeBase64: jest.fn().mockReturnValue('enc64'),
    },
    wsService:   { buildWsUrl:          jest.fn() },
    tokenUtils:  { isTokenExpiringSoon: jest.fn().mockReturnValue(false) },
    authService: { refreshToken:        jest.fn() },
  };

  (window as any).emberLog = {
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  };

  (window as any).getValidAuth            = jest.fn().mockResolvedValue({ token: 'tok', hostname: HOSTNAME, user_id: MY_USER_ID });
  (window as any).wsSubscribeToChannel    = jest.fn();
  (window as any).wsUnsubscribeFromChannel = jest.fn();
  (window as any).addDmConversationToList = jest.fn();
  (window as any).displayDmMessage        = jest.fn();
  (window as any).markChannelUnread       = jest.fn();
  (window as any).showDmPendingBanner     = jest.fn();
  (window as any).hideDmPendingBanner     = jest.fn();
  (window as any).playNotificationSound   = jest.fn();
  (window as any).renderMemberList        = jest.fn();
  (window as any).renderServerList        = jest.fn();
  (window as any).loadServerContent       = jest.fn();
  (window as any).fetchMembers            = jest.fn().mockResolvedValue([]);
  (window as any).displayDecryptedMessage = jest.fn();

  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;

  require('../../../src/renderer/managers/direct-messaging-manager');

  // ── Seed the pending requester DM via startDmConversation ──
  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    // New: recipient device lookup for peer-box creation
    if (String(url).includes(`/users/${PARTNER_ID}/devices`) && !opts?.method)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ devices: [{ id: 'dev-r-1', public_key: RECIPIENT_DEVICE_PUB }] }) });

    if (String(url).includes('/dm-requests') && opts?.method === 'POST') {
      capturedDmRequestBody = opts?.body ? JSON.parse(opts.body as string) : null;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: REQUEST_ID, ember_id: EMBER_ID, status: 'created' }) });
    }
    if (String(url).includes(`/embers/${EMBER_ID}/channels`))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ channels: [{ id: TEXT_CH, type: 'text' }] }) });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
  await (window as any).startDmConversation(PARTNER_ID, PARTNER_NAME);

  // ── Seed the pending RECIPIENT DM via loadAndShowDmRequests ──
  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    if (String(url).includes('/dm-requests') && !opts?.method)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ requests: [{
        id: RECIPIENT_REQUEST_ID,
        requester_id: REQUESTER_ID,
        requester_username: REQUESTER_USERNAME,
        requester_avatar: '',
        ember_id: RECIPIENT_EMBER_ID,
        created_at: new Date().toISOString(),
      }] }) });
    if (String(url).includes(`/embers/${RECIPIENT_EMBER_ID}/channels`))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ channels: [{ id: RECIPIENT_TEXT_CH, type: 'text' }] }) });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
  await (window as any).loadAndShowDmRequests();
});

beforeEach(() => {
  fetchMock.mockReset();
});

// ─── PA-1: startDmConversation sends key material ─────────────────────────────

describe.skip('PA-1: startDmConversation — key generation', () => {
  it('sends encrypted_key_self in the DM request body', () => {
    expect(capturedDmRequestBody?.encrypted_key_self).toBeDefined();
    expect(capturedDmRequestBody?.encrypted_key_self).not.toBe('');
  });

  it('sends peer_box with recipient_id, encrypted_key, and sender_public_key', () => {
    expect(capturedDmRequestBody?.peer_box).toBeDefined();
    expect(capturedDmRequestBody?.peer_box?.recipient_id).toBe(PARTNER_ID);
    expect(capturedDmRequestBody?.peer_box?.encrypted_key).toBeDefined();
    expect(capturedDmRequestBody?.peer_box?.sender_public_key).toBeDefined();
  });
});

// ─── PA-2: startDmConversation caches key immediately ────────────────────────

describe.skip('PA-2: startDmConversation — immediate key caching', () => {
  it('caches the ember key in App.emberKeyCache right after the request is created', () => {
    const App = (window as any).App;
    expect(App.emberKeyCache.has(EMBER_ID)).toBe(true);
    expect(App.emberKeyCache.get(EMBER_ID)).toBeInstanceOf(Uint8Array);
  });
});

// ─── PA-3: sendDirectMessage succeeds on pending DM ──────────────────────────

describe.skip('PA-3: sendDirectMessage — pending DM (requester has key)', () => {
  it('resolves successfully and returns a message ID', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes(`/channels/${TEXT_CH}/messages`) && opts?.method === 'POST')
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'msg-pa-1' }) });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    const msgId = await (window as any).sendDirectMessage(TEXT_CH, 'Hello before acceptance!');
    expect(msgId).toBe('msg-pa-1');
  });

  it('does not throw "Ember key unavailable"', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes(`/channels/${TEXT_CH}/messages`) && opts?.method === 'POST')
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'msg-pa-2' }) });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await expect(
      (window as any).sendDirectMessage(TEXT_CH, 'Another message'),
    ).resolves.not.toThrow();
  });

  it('does not throw a "hasn\'t accepted" message', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes(`/channels/${TEXT_CH}/messages`) && opts?.method === 'POST')
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'msg-pa-3' }) });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await expect(
      (window as any).sendDirectMessage(TEXT_CH, 'Third message'),
    ).resolves.toBeDefined();
  });
});

// ─── PA-4: fetchConversationMessages calls key API on pending DM ──────────────

describe.skip('PA-4: fetchConversationMessages — pending DM no longer short-circuits', () => {
  it('calls the ember key API (no early empty-return for pending requester DMs)', async () => {
    // Clear cache so fetchAndCacheEmberKey must hit the API
    const App = (window as any).App;
    App.emberKeyCache.delete(EMBER_ID);

    let keyApiCalled = false;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes(`/embers/${EMBER_ID}/key`) && !opts?.method) {
        keyApiCalled = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ encrypted_key: 'enckey64', sender_public_key: '' }) });
      }
      if (String(url).includes(`/channels/${TEXT_CH}/messages`) && !opts?.method)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ messages: [
          { id: 'msg-1', sender_user_id: PARTNER_ID, ciphertext: 'enc', created_at: 1000 },
        ] }) });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await (window as any).fetchConversationMessages(TEXT_CH);

    expect(keyApiCalled).toBe(true);
  });
});

// ─── PA-5: acceptDMRequest posts empty body and fetches peer-box ─────────────

describe.skip('PA-5: acceptDMRequest — simplified recipient flow', () => {
  it('posts to the accept endpoint without encrypted_key_self or peer_boxes', async () => {
    let capturedAcceptBody: any = null;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes(`/dm-requests/${RECIPIENT_REQUEST_ID}/accept`) && opts?.method === 'POST') {
        capturedAcceptBody = opts?.body ? JSON.parse(opts.body as string) : null;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ember_id: RECIPIENT_EMBER_ID }) });
      }
      if (String(url).includes(`/embers/${RECIPIENT_EMBER_ID}/key`) && !opts?.method)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ encrypted_key: 'enckey64', sender_public_key: 'senderpub64' }) });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await (window as any).acceptDMRequest(RECIPIENT_REQUEST_ID, REQUESTER_ID, REQUESTER_USERNAME);

    expect(capturedAcceptBody).not.toHaveProperty('encrypted_key_self');
    expect(capturedAcceptBody).not.toHaveProperty('peer_boxes');
  });

  it('fetches the ember key from the server after posting accept', async () => {
    // Reset to pending state so acceptDMRequest can run again
    const dmEntry = (window as any).App;
    dmEntry.emberKeyCache.delete(RECIPIENT_EMBER_ID);

    let keyFetched = false;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes(`/dm-requests/${RECIPIENT_REQUEST_ID}/accept`) && opts?.method === 'POST')
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ember_id: RECIPIENT_EMBER_ID }) });
      if (String(url).includes(`/embers/${RECIPIENT_EMBER_ID}/key`) && !opts?.method) {
        keyFetched = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ encrypted_key: 'enckey64', sender_public_key: 'senderpub64' }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await (window as any).acceptDMRequest(RECIPIENT_REQUEST_ID, REQUESTER_ID, REQUESTER_USERNAME);
    await new Promise<void>(resolve => setTimeout(resolve, 50));

    expect(keyFetched).toBe(true);
  });
});
