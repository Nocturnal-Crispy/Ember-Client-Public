/**
 * Unit tests for src/renderer/managers/channel-manager.ts
 *
 * The IIFE captures globals at load time. All mocks are set up before require().
 * DOM elements like #channel-context-menu and #messages return null in jsdom,
 * which is safe because the code guards every access with optional chaining.
 *
 * Tests cover:
 *   - fetchChannels: returns [] when not authenticated
 *   - fetchChannels: returns [] on server error
 *   - fetchChannels: returns channel list on success
 *   - fetchCategories: returns [] when not authenticated
 *   - renderChannels: creates .channel elements for text and voice channels
 *   - renderChannels: creates .voice-participant-list for voice channels
 */

let mockIpcInvoke: jest.Mock;
let mockFetch: jest.Mock;

beforeAll(() => {
  // 1. Populate window.App
  require('../../../src/renderer/managers/app-state');

  // 2. Mock window.electronAPI
  mockIpcInvoke = jest.fn().mockResolvedValue(null);
  (window as any).electronAPI = {
    ipc: {
      invoke: mockIpcInvoke,
      send: jest.fn(),
      on: jest.fn(),
    },
    crypto: {},
    nacl: {},
    naclUtil: {},
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

  // 4. Stubs called by renderChannels auto-select logic
  (window as any).updateChatHeader = jest.fn();
  (window as any).loadChannelMessages = jest.fn();
  (window as any).joinVoiceChannel = jest.fn();

  // 5. Mock global fetch
  mockFetch = jest.fn();
  (global as any).fetch = mockFetch;

  // 6. Load the IIFE
  require('../../../src/renderer/managers/channel-manager');
});

beforeEach(() => {
  (window as any).App.activeEmberId = 'e-test';
  (window as any).App.activeChannelId = null;
});

// ─── fetchChannels ────────────────────────────────────────────────────────────

describe('fetchChannels', () => {
  it('returns an empty array when get-auth returns null', async () => {
    mockIpcInvoke.mockResolvedValueOnce(null);
    const result = await (window as any).fetchChannels('e-1');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns an empty array when the auth token is missing', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ hostname: 'http://localhost:8085' });
    const result = await (window as any).fetchChannels('e-1');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns an empty array when the server responds with non-ok status', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ token: 'tok', hostname: 'http://localhost:8085' });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    const result = await (window as any).fetchChannels('e-1');
    expect(result).toEqual([]);
  });

  it('returns the channels array from a successful response', async () => {
    const mockChannels = [
      { id: 'ch-1', ember_id: 'e-1', name: 'general', type: 'text' },
      { id: 'ch-2', ember_id: 'e-1', name: 'voice', type: 'voice' },
    ];
    mockIpcInvoke.mockResolvedValueOnce({ token: 'tok', hostname: 'http://localhost:8085' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ channels: mockChannels }),
    });
    const result = await (window as any).fetchChannels('e-1');
    expect(result).toEqual(mockChannels);
  });

  it('returns an empty array when fetch throws', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ token: 'tok', hostname: 'http://localhost:8085' });
    mockFetch.mockRejectedValueOnce(new Error('network error'));
    const result = await (window as any).fetchChannels('e-1');
    expect(result).toEqual([]);
  });

  it('calls the correct API endpoint with auth header', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ token: 'tok', hostname: 'http://localhost:8085' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ channels: [] }),
    });
    await (window as any).fetchChannels('e-42');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8085/api/v1/embers/e-42/channels',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      })
    );
  });
});

// ─── fetchCategories ──────────────────────────────────────────────────────────

describe('fetchCategories', () => {
  it('returns an empty array when get-auth returns null', async () => {
    mockIpcInvoke.mockResolvedValueOnce(null);
    const result = await (window as any).fetchCategories('e-1');
    expect(result).toEqual([]);
  });

  it('returns categories from a successful response', async () => {
    const mockCats = [{ id: 'cat-1', ember_id: 'e-1', name: 'Text Channels' }];
    mockIpcInvoke.mockResolvedValueOnce({ token: 'tok', hostname: 'http://localhost:8085' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ categories: mockCats }),
    });
    const result = await (window as any).fetchCategories('e-1');
    expect(result).toEqual(mockCats);
  });
});

// ─── renderChannels ───────────────────────────────────────────────────────────

describe('renderChannels', () => {
  let channelsContainer: HTMLDivElement;

  beforeEach(() => {
    channelsContainer = document.createElement('div');
    channelsContainer.className = 'channels';
    document.body.appendChild(channelsContainer);
  });

  afterEach(() => {
    document.body.removeChild(channelsContainer);
  });

  it('creates a .channel element for each text channel', () => {
    const channels = [
      { id: 'ch-1', ember_id: 'e-1', name: 'general', type: 'text' as const },
      { id: 'ch-2', ember_id: 'e-1', name: 'announcements', type: 'text' as const },
    ];

    (window as any).renderChannels(channels, []);

    expect(channelsContainer.querySelectorAll('.channel').length).toBe(2);
  });

  it('creates a .voice-participant-list element after each voice channel', () => {
    const channels = [
      { id: 'vc-1', ember_id: 'e-1', name: 'General Voice', type: 'voice' as const },
    ];

    (window as any).renderChannels(channels, []);

    expect(channelsContainer.querySelectorAll('.voice-participant-list').length).toBe(1);
  });

  it('creates both .channel elements and voice participant lists for mixed channels', () => {
    const channels = [
      { id: 'ch-1', ember_id: 'e-1', name: 'general', type: 'text' as const },
      { id: 'vc-1', ember_id: 'e-1', name: 'voice', type: 'voice' as const },
    ];

    (window as any).renderChannels(channels, []);

    expect(channelsContainer.querySelectorAll('.channel').length).toBe(2);
    expect(channelsContainer.querySelectorAll('.voice-participant-list').length).toBe(1);
  });

  it('clears existing channel elements before rendering new ones', () => {
    // Pre-populate with a stale element
    const staleEl = document.createElement('div');
    staleEl.className = 'channel';
    channelsContainer.appendChild(staleEl);

    (window as any).renderChannels(
      [{ id: 'ch-new', ember_id: 'e-1', name: 'new', type: 'text' as const }],
      []
    );

    const channels = channelsContainer.querySelectorAll('.channel');
    expect(channels.length).toBe(1);
    expect((channels[0] as HTMLElement).dataset['channelId']).toBe('ch-new');
  });

  it('renders an empty container when given no channels', () => {
    const staleEl = document.createElement('div');
    staleEl.className = 'channel';
    channelsContainer.appendChild(staleEl);

    (window as any).renderChannels([], []);

    expect(channelsContainer.querySelectorAll('.channel').length).toBe(0);
  });

  it('sets data-channel-id attribute on each channel element', () => {
    const channels = [
      { id: 'ch-abc', ember_id: 'e-1', name: 'test', type: 'text' as const },
    ];

    (window as any).renderChannels(channels, []);

    const el = channelsContainer.querySelector('.channel') as HTMLElement;
    expect(el.dataset['channelId']).toBe('ch-abc');
  });
});
