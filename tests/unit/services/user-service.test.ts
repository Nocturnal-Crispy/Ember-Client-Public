/**
 * Unit tests for src/renderer/services/user-service.ts
 *
 * Tests user lookup, caching, and voice channel detection
 * from App.currentMembers and App.voiceChannelPresence.
 */

// @jest-environment jsdom

beforeAll(() => {
  // 1. Load app-state to populate window.App
  require('../../../src/renderer/managers/app-state');

  // 2. Mock window.electronAPI
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockResolvedValue(null),
      send: jest.fn(),
      on: jest.fn(),
    },
    nacl: {},
    naclUtil: {},
    crypto: {},
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

  // 4. Load the IIFE module
  require('../../../src/renderer/services/user-service');
});

beforeEach(() => {
  // Reset member list and voice presence before each test
  (window as any).App.currentMembers = [];
  (window as any).App.voiceChannelPresence = new Map();
  (window as any).App.activeVoiceChannelName = null;
});

describe('getUserDetails', () => {
  it('returns member details when user_id is in App.currentMembers', () => {
    (window as any).App.currentMembers = [
      { user_id: 'u1', username: 'Alice', status: 'online', role: 'member' },
      { user_id: 'u2', username: 'Bob', status: 'offline', role: 'admin' },
    ];

    const result = window.getUserDetails('u1');

    expect(result).not.toBeNull();
    expect(result!.user_id).toBe('u1');
    expect(result!.username).toBe('Alice');
    expect(result!.status).toBe('online');
    expect(result!.role).toBe('member');
  });

  it('returns null when user_id is not in App.currentMembers', () => {
    (window as any).App.currentMembers = [
      { user_id: 'u1', username: 'Alice', status: 'online', role: 'member' },
    ];

    const result = window.getUserDetails('u-unknown');

    expect(result).toBeNull();
  });

  it('returns null when currentMembers is empty', () => {
    (window as any).App.currentMembers = [];

    const result = window.getUserDetails('u1');

    expect(result).toBeNull();
  });

  it('includes optional avatar and custom_status fields when present', () => {
    (window as any).App.currentMembers = [
      {
        user_id: 'u3',
        username: 'Carol',
        status: 'away',
        role: 'owner',
        avatar: 'https://example.com/avatar.png',
        custom_status: 'Working on stuff',
        status_emoji: '🔥',
      },
    ];

    const result = window.getUserDetails('u3');

    expect(result).not.toBeNull();
    expect(result!.avatar).toBe('https://example.com/avatar.png');
    expect(result!.custom_status).toBe('Working on stuff');
    expect(result!.status_emoji).toBe('🔥');
  });
});

describe('getUserDetailsByUsername', () => {
  it('returns member details when username matches', () => {
    (window as any).App.currentMembers = [
      { user_id: 'u1', username: 'Alice', status: 'online', role: 'member' },
      { user_id: 'u2', username: 'Bob', status: 'offline', role: 'admin' },
    ];

    const result = window.getUserDetailsByUsername('Bob');

    expect(result).not.toBeNull();
    expect(result!.user_id).toBe('u2');
    expect(result!.username).toBe('Bob');
  });

  it('returns null when username is not found', () => {
    (window as any).App.currentMembers = [
      { user_id: 'u1', username: 'Alice', status: 'online', role: 'member' },
    ];

    const result = window.getUserDetailsByUsername('Unknown');

    expect(result).toBeNull();
  });

  it('is case-sensitive for username lookup', () => {
    (window as any).App.currentMembers = [
      { user_id: 'u1', username: 'Alice', status: 'online', role: 'member' },
    ];

    const result = window.getUserDetailsByUsername('alice');

    expect(result).toBeNull();
  });
});

describe('getUserVoiceChannel', () => {
  it('returns channel name when user is in a voice channel', () => {
    const presenceMap = new Map<string, string>();
    presenceMap.set('u1', 'Alice');
    (window as any).App.voiceChannelPresence = new Map([['ch-lobby', presenceMap]]);
    // Voice channel names are tracked separately
    (window as any).App.activeVoiceChannelName = null;

    const result = window.getUserVoiceChannel('u1');

    expect(result).not.toBeNull();
    expect(result!.channelId).toBe('ch-lobby');
  });

  it('returns null when user is not in any voice channel', () => {
    (window as any).App.voiceChannelPresence = new Map();

    const result = window.getUserVoiceChannel('u1');

    expect(result).toBeNull();
  });

  it('returns null when voice channels exist but user is not in them', () => {
    const presenceMap = new Map<string, string>();
    presenceMap.set('u2', 'Bob');
    (window as any).App.voiceChannelPresence = new Map([['ch-lobby', presenceMap]]);

    const result = window.getUserVoiceChannel('u1');

    expect(result).toBeNull();
  });

  it('finds user across multiple voice channels', () => {
    const lobbyMap = new Map<string, string>();
    lobbyMap.set('u1', 'Alice');

    const generalMap = new Map<string, string>();
    generalMap.set('u2', 'Bob');

    (window as any).App.voiceChannelPresence = new Map([
      ['ch-lobby', lobbyMap],
      ['ch-general', generalMap],
    ]);

    const result = window.getUserVoiceChannel('u2');

    expect(result).not.toBeNull();
    expect(result!.channelId).toBe('ch-general');
  });
});
