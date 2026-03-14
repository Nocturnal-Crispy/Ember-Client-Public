/**
 * Unit tests for src/renderer/managers/voice-ui-manager.ts
 *
 * Tests cover:
 *   - renderVoiceParticipants: creates .voice-avatar elements with correct data-user-id
 *   - renderVoiceParticipants: re-applies speaking state from voiceManager.speakingStates
 *   - renderVoiceParticipants: clears list when channelId is null
 *   - updateSpeakingIndicator: adds 'speaking' class to matching voice-avatar
 *   - updateSpeakingIndicator: removes 'speaking' class when isSpeaking=false
 *   - updateSpeakingIndicator: does nothing when no matching element exists
 *   - updateSpeakingIndicator: updates all matching elements across multiple lists
 */

let mockIpcInvoke: jest.Mock;

const CHANNEL_ID = 'ch-voice-1';
const USER_A = 'user-a-123';
const USER_B = 'user-b-456';
const USERNAME_A = 'Alice';
const USERNAME_B = 'Bob';

function createParticipantList(channelId: string): HTMLElement {
  const list = document.createElement('div');
  list.className = 'voice-participant-list';
  list.dataset['voiceChannelId'] = channelId;
  document.body.appendChild(list);
  return list;
}

function createVoiceAvatar(userId: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'voice-avatar';
  el.dataset['userId'] = userId;
  document.body.appendChild(el);
  return el;
}

beforeAll(() => {
  // 1. Load app-state to populate window.App
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

  // 4. Stub globals used by the IIFE at load time
  (window as any).fetchMembers = jest.fn().mockResolvedValue([]);
  (window as any).renderMemberList = jest.fn();
  (window as any).refreshDmUsername = jest.fn();
  (window as any).initThemeSettings = jest.fn();
  (window as any).handlePresenceUpdate = jest.fn();

  // 5. Load the IIFE
  require('../../../src/renderer/managers/voice-ui-manager');
});

beforeEach(() => {
  // Clean up DOM between tests
  document.body.replaceChildren();

  // Reset App state
  const App = (window as any).App;
  App.voiceChannelPresence = new Map();
  App.voiceParticipants = new Map();
  App.activeVoiceChannelId = null;
  App.voiceManager = null;
  App.currentMembers = [];

  mockIpcInvoke.mockReset();
  mockIpcInvoke.mockResolvedValue(null);
});

// ─── renderVoiceParticipants ──────────────────────────────────────────────────

describe('renderVoiceParticipants', () => {
  it('creates .voice-avatar elements with correct data-user-id for each participant', () => {
    createParticipantList(CHANNEL_ID);

    const App = (window as any).App;
    App.voiceChannelPresence.set(CHANNEL_ID, new Map([
      [USER_A, USERNAME_A],
      [USER_B, USERNAME_B],
    ]));

    (window as any).renderVoiceParticipants(CHANNEL_ID);

    const avatars = document.querySelectorAll<HTMLElement>('.voice-avatar');
    expect(avatars).toHaveLength(2);

    const userIds = Array.from(avatars).map((el) => el.dataset['userId']);
    expect(userIds).toContain(USER_A);
    expect(userIds).toContain(USER_B);
  });

  it('creates avatar with initial letter when no avatar image is available', () => {
    createParticipantList(CHANNEL_ID);

    const App = (window as any).App;
    App.voiceChannelPresence.set(CHANNEL_ID, new Map([[USER_A, USERNAME_A]]));
    App.currentMembers = [];

    (window as any).renderVoiceParticipants(CHANNEL_ID);

    const avatar = document.querySelector<HTMLElement>('.voice-avatar');
    expect(avatar).not.toBeNull();
    expect(avatar!.textContent).toBe('A');
  });

  it('clears all participant lists when channelId is null', () => {
    const list = createParticipantList(CHANNEL_ID);

    // Pre-populate with a fake child
    const child = document.createElement('div');
    list.appendChild(child);
    expect(list.children).toHaveLength(1);

    (window as any).renderVoiceParticipants(null);

    expect(list.children).toHaveLength(0);
  });

  it('does nothing when no matching .voice-participant-list exists', () => {
    // No list in DOM
    const App = (window as any).App;
    App.voiceChannelPresence.set(CHANNEL_ID, new Map([[USER_A, USERNAME_A]]));

    expect(() => {
      (window as any).renderVoiceParticipants(CHANNEL_ID);
    }).not.toThrow();

    expect(document.querySelectorAll('.voice-avatar')).toHaveLength(0);
  });

  it('re-applies speaking state from voiceManager.speakingStates after re-render', () => {
    createParticipantList(CHANNEL_ID);

    const App = (window as any).App;
    App.voiceChannelPresence.set(CHANNEL_ID, new Map([
      [USER_A, USERNAME_A],
      [USER_B, USERNAME_B],
    ]));

    // Mock voiceManager with speakingStates indicating User B is speaking
    const speakingStates = new Map<string, boolean>();
    speakingStates.set(USER_B, true);
    App.voiceManager = { speakingStates };

    // Render participants — User B should have speaking class applied immediately
    (window as any).renderVoiceParticipants(CHANNEL_ID);

    const avatarA = document.querySelector<HTMLElement>(`.voice-avatar[data-user-id="${USER_A}"]`);
    const avatarB = document.querySelector<HTMLElement>(`.voice-avatar[data-user-id="${USER_B}"]`);

    expect(avatarA).not.toBeNull();
    expect(avatarB).not.toBeNull();
    expect(avatarA!.classList.contains('speaking')).toBe(false);
    expect(avatarB!.classList.contains('speaking')).toBe(true);
  });

  it('does not apply speaking class when user is not in speakingStates', () => {
    createParticipantList(CHANNEL_ID);

    const App = (window as any).App;
    App.voiceChannelPresence.set(CHANNEL_ID, new Map([[USER_A, USERNAME_A]]));
    App.voiceManager = { speakingStates: new Map<string, boolean>() };

    (window as any).renderVoiceParticipants(CHANNEL_ID);

    const avatar = document.querySelector<HTMLElement>(`.voice-avatar[data-user-id="${USER_A}"]`);
    expect(avatar!.classList.contains('speaking')).toBe(false);
  });
});

// ─── updateSpeakingIndicator ──────────────────────────────────────────────────

describe('updateSpeakingIndicator', () => {
  it('adds speaking class to matching .voice-avatar element', () => {
    createVoiceAvatar(USER_A);

    (window as any).updateSpeakingIndicator(USER_A, true);

    const el = document.querySelector<HTMLElement>('.voice-avatar');
    expect(el!.classList.contains('speaking')).toBe(true);
  });

  it('removes speaking class when isSpeaking is false', () => {
    const avatar = createVoiceAvatar(USER_A);
    avatar.classList.add('speaking');

    (window as any).updateSpeakingIndicator(USER_A, false);

    expect(avatar.classList.contains('speaking')).toBe(false);
  });

  it('does not add speaking class when userId does not match', () => {
    createVoiceAvatar(USER_A);

    (window as any).updateSpeakingIndicator(USER_B, true);

    const el = document.querySelector<HTMLElement>('.voice-avatar');
    expect(el!.classList.contains('speaking')).toBe(false);
  });

  it('updates all matching elements when the same user appears in multiple lists', () => {
    // User appears in two different channel participant lists
    createVoiceAvatar(USER_A);
    createVoiceAvatar(USER_A);

    (window as any).updateSpeakingIndicator(USER_A, true);

    const elements = document.querySelectorAll<HTMLElement>(`.voice-avatar[data-user-id="${USER_A}"]`);
    expect(elements).toHaveLength(2);
    elements.forEach((el) => expect(el.classList.contains('speaking')).toBe(true));
  });

  it('handles empty userId gracefully', () => {
    createVoiceAvatar(USER_A);

    expect(() => {
      (window as any).updateSpeakingIndicator('', true);
    }).not.toThrow();

    const el = document.querySelector<HTMLElement>('.voice-avatar');
    expect(el!.classList.contains('speaking')).toBe(false);
  });
});

// ─── Speaking indicator persists through re-render (integration) ──────────────

describe('speaking indicator persists through re-render', () => {
  it('remote user speaking class survives a call to renderVoiceParticipants', () => {
    createParticipantList(CHANNEL_ID);

    const App = (window as any).App;
    App.voiceChannelPresence.set(CHANNEL_ID, new Map([
      [USER_A, USERNAME_A],
      [USER_B, USERNAME_B],
    ]));

    // Initial render
    App.voiceManager = { speakingStates: new Map<string, boolean>() };
    (window as any).renderVoiceParticipants(CHANNEL_ID);

    // User B starts speaking
    (window as any).updateSpeakingIndicator(USER_B, true);
    App.voiceManager.speakingStates.set(USER_B, true);

    let avatarB = document.querySelector<HTMLElement>(`.voice-avatar[data-user-id="${USER_B}"]`);
    expect(avatarB!.classList.contains('speaking')).toBe(true);

    // Simulate participant list update (e.g., another user joins) — re-render the list
    (window as any).renderVoiceParticipants(CHANNEL_ID);

    // Speaking class must still be present after re-render
    avatarB = document.querySelector<HTMLElement>(`.voice-avatar[data-user-id="${USER_B}"]`);
    expect(avatarB).not.toBeNull();
    expect(avatarB!.classList.contains('speaking')).toBe(true);
  });
});
