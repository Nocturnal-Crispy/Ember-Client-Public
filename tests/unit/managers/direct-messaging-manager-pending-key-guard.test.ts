/**
 * Unit tests for the pending-DM enrollment guard.
 *
 * PK-2  fetchAndCacheEmberKey — 404 on a PENDING requester DM does NOT trigger
 *        requestDeviceKeyEnrollment (POST to device-key-requests). Enrollment is
 *        only meaningful once the key has been created somewhere.
 * PK-3  fetchAndCacheEmberKey — 404 on an ACCEPTED DM DOES trigger enrollment,
 *        because the key exists but hasn't been delivered to this device yet.
 *
 * Note: PK-1 (fetchConversationMessages early return) and PK-4 (friendly send error)
 * were removed — those guards are no longer needed now that the requester generates
 * the key at request time and can send messages immediately.
 */

const HOSTNAME      = 'http://localhost';
const MY_USER_ID    = 'user-me-pk';
const PARTNER_ID    = 'user-partner-pk';
const PARTNER_NAME  = 'Greed';
const EMBER_ID      = 'emb-pk-guard-1';
const TEXT_CH       = 'ch-pk-guard-text';
const VOICE_CH      = 'ch-pk-guard-voice';
const ACCEPTED_EMBER = 'emb-pk-accepted-1';
const ACCEPTED_TEXT  = 'ch-pk-accepted-text';

let fetchMock: jest.Mock;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // 1. App state (empty ember key cache — tests must NOT pre-seed keys)
  require('../../../src/renderer/managers/app-state');
  const App = (window as any).App;
  // Intentionally leave App.emberKeyCache empty for EMBER_ID and ACCEPTED_EMBER

  // 2. electronAPI mock
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockImplementation((ch: string) => {
        if (ch === 'get-auth')
          return Promise.resolve({ token: 'tok', hostname: HOSTNAME, user_id: MY_USER_ID, username: 'Me' });
        if (ch === 'get-device-identity')
          return Promise.resolve({ public_key: 'pubkey64', private_key: 'privkey64', device_id: 'dev-1' });
        return Promise.resolve(null);
      }),
      send: jest.fn(),
      on:   jest.fn(),
    },
    crypto: {
      generateEmberKey:       jest.fn().mockReturnValue(new Uint8Array(32).fill(1)),
      encryptEmberKeyForUser: jest.fn().mockReturnValue('encryptedkey64'),
      decryptEmberKeyForUser: jest.fn().mockReturnValue(null), // key fetch always fails
      encryptMessage:         jest.fn().mockReturnValue('ciphertext64'),
      decryptMessage:         jest.fn().mockReturnValue('plaintext'),
    },
    nacl:     {},
    naclUtil: {
      decodeBase64: jest.fn().mockReturnValue(new Uint8Array(32)),
      encodeBase64: jest.fn().mockReturnValue('encoded64'),
    },
    wsService:   { buildWsUrl:          jest.fn() },
    tokenUtils:  { isTokenExpiringSoon: jest.fn().mockReturnValue(false) },
    authService: { refreshToken:        jest.fn() },
  };

  // 3. Logging mock
  (window as any).emberLog = {
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  };

  // 4. Globals
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

  // 5. fetch mock (will be reconfigured per test)
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;

  // 6. Load IIFE module
  require('../../../src/renderer/managers/direct-messaging-manager');

  // 7. Seed a PENDING (requester) DM entry via startDmConversation.
  //    startDmConversation now fetches recipient devices to create a peer-box.
  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    if (String(url).includes(`/users/${PARTNER_ID}/devices`) && !opts?.method)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ devices: [{ id: 'dev-r', public_key: 'recippub64' }] }) });
    if (String(url).includes('/dm-requests') && opts?.method === 'POST')
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'req-1', ember_id: EMBER_ID, status: 'created' }) });
    if (String(url).includes(`/embers/${EMBER_ID}/channels`))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ channels: [{ id: TEXT_CH, type: 'text' }, { id: VOICE_CH, type: 'voice' }] }) });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
  await (window as any).startDmConversation(PARTNER_ID, PARTNER_NAME);

  // 8. Seed an ACCEPTED DM entry by dispatching dm-request-accepted (simulates acceptance).
  //    First register the channels so the manager knows about it.
  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    if (String(url).includes(`/users/partner-b/devices`) && !opts?.method)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ devices: [{ id: 'dev-r2', public_key: 'recippub64b' }] }) });
    if (String(url).includes('/dm-requests') && opts?.method === 'POST')
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'req-2', ember_id: ACCEPTED_EMBER, status: 'created' }) });
    if (String(url).includes(`/embers/${ACCEPTED_EMBER}/channels`))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ channels: [{ id: ACCEPTED_TEXT, type: 'text' }] }) });
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
  await (window as any).startDmConversation('partner-b', 'Bob');

  // Simulate dm-request-accepted to transition ACCEPTED_EMBER to 'accepted' state
  const App2 = (window as any).App;
  App2.emberKeyCache.delete(ACCEPTED_EMBER); // ensure cache is empty after event
  window.dispatchEvent(new CustomEvent('dm-request-accepted', { detail: { ember_id: ACCEPTED_EMBER } }));
  // Allow async handler to run, but we still need the key fetch to 404 in individual tests
  await new Promise<void>(resolve => setTimeout(resolve, 20));
});

beforeEach(() => {
  fetchMock.mockReset();
  // Clear ember key cache for the embers under test before each test
  const App = (window as any).App;
  App.emberKeyCache.delete(EMBER_ID);
  App.emberKeyCache.delete(ACCEPTED_EMBER);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockKeyEndpoint404(emberId: string): void {
  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    if (String(url).includes(`/embers/${emberId}/key`) && !opts?.method)
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    if (String(url).includes(`/embers/${emberId}/device-key-requests`) && opts?.method === 'POST')
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
}

function wasDeviceKeyEnrollmentRequested(emberId: string): boolean {
  return fetchMock.mock.calls.some(
    ([url, opts]: [string, RequestInit?]) =>
      String(url).includes(`/embers/${emberId}/device-key-requests`) &&
      opts?.method === 'POST',
  );
}

// ─── PK-2: fetchAndCacheEmberKey — pending DM, 404 → NO enrollment ────────────

describe.skip('PK-2: fetchAndCacheEmberKey — pending requester DM', () => {
  it('does NOT call requestDeviceKeyEnrollment when 404 on a pending DM', async () => {
    mockKeyEndpoint404(EMBER_ID);

    // Trigger key fetch indirectly through sendDirectMessage (or direct via wrapper)
    // fetchConversationMessages would skip key fetch entirely (PK-1 fix), so use
    // setActiveDmConversation which explicitly fetches the key.
    (window as any).setActiveDmConversation(TEXT_CH);
    await new Promise<void>(resolve => setTimeout(resolve, 30));

    expect(wasDeviceKeyEnrollmentRequested(EMBER_ID)).toBe(false);
  });
});

// ─── PK-3: fetchAndCacheEmberKey — accepted DM, 404 → enrollment triggered ────

describe.skip('PK-3: fetchAndCacheEmberKey — accepted DM', () => {
  it('DOES call requestDeviceKeyEnrollment when 404 on an accepted DM', async () => {
    mockKeyEndpoint404(ACCEPTED_EMBER);

    (window as any).setActiveDmConversation(ACCEPTED_TEXT);
    await new Promise<void>(resolve => setTimeout(resolve, 30));

    expect(wasDeviceKeyEnrollmentRequested(ACCEPTED_EMBER)).toBe(true);
  });
});

