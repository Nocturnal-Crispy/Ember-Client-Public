/**
 * Unit tests for src/renderer/managers/direct-messaging-ui.ts
 *
 * Tests the handleDmPresenceUpdate function, which is called by websocket-service.ts
 * when a presence_update WebSocket message is received for a DM participant.
 *
 * Tests cover:
 *   - handleDmPresenceUpdate: exposed on window
 *   - handleDmPresenceUpdate: marks conversation online when status is 'online'
 *   - handleDmPresenceUpdate: marks conversation offline when status is 'offline'
 *   - handleDmPresenceUpdate: ignores updates for unknown user IDs without throwing
 */

function buildDom(): void {
  // dm-sidebar
  const sidebar = document.createElement('div');
  sidebar.className = 'dm-sidebar';
  const convList = document.createElement('div');
  convList.className = 'dm-conversation-list';
  sidebar.appendChild(convList);

  // dm-chat-container
  const chat = document.createElement('div');
  chat.className = 'dm-chat-container';

  const header = document.createElement('div');
  header.className = 'dm-chat-header';

  const headerAvatar = document.createElement('div');
  headerAvatar.className = 'dm-chat-header-avatar';
  const headerName = document.createElement('div');
  headerName.className = 'dm-chat-header-name';
  const headerStatus = document.createElement('div');
  headerStatus.className = 'dm-chat-header-status';

  header.appendChild(headerAvatar);
  header.appendChild(headerName);
  header.appendChild(headerStatus);

  const messages = document.createElement('div');
  messages.className = 'messages-container';
  const statusIndicator = document.createElement('div');
  statusIndicator.className = 'dm-status-indicator';

  chat.appendChild(header);
  chat.appendChild(messages);
  chat.appendChild(statusIndicator);

  document.body.appendChild(sidebar);
  document.body.appendChild(chat);
}

beforeAll(() => {
  // 1. Populate window.App
  require('../../../src/renderer/managers/app-state');

  // 2. Mock window.electronAPI
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockImplementation((channel: string) => {
        if (channel === 'get-auth') {
          return Promise.resolve({ token: 'tok', hostname: 'http://localhost', user_id: 'me', username: 'Me' });
        }
        return Promise.resolve(null);
      }),
      send: jest.fn(),
      on: jest.fn(),
    },
    crypto: {
      decryptEmberKeyForUser: jest.fn(),
      encryptEmberKeyForUser: jest.fn(),
      generateEmberKey: jest.fn(),
      decryptMessage: jest.fn(),
      encryptMessage: jest.fn(),
    },
    nacl: {},
    naclUtil: { decodeBase64: jest.fn(), encodeBase64: jest.fn() },
    wsService: { buildWsUrl: jest.fn().mockReturnValue('ws://localhost:8086/ws?token=tok') },
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

  // 4. Set up DOM structure required by the module
  buildDom();

  // 5. Stub globals the module may call
  (window as any).getValidAuth = jest.fn().mockResolvedValue({
    token: 'tok', hostname: 'http://localhost', user_id: 'me', username: 'Me',
  });
  (window as any).announceToScreenReader = jest.fn();

  // 6. Load the module (IIFE runs immediately and registers window.* exports)
  require('../../../src/renderer/managers/direct-messaging-ui');

  // 7. Initialize the UI so dmSidebarElement and dmChatContainer are set
  (window as any).initializeDirectMessagingUI();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function addTestConversation(id: string, participantId: string, username: string, isOnline = false): void {
  (window as any).addDmConversationToList({
    id,
    participantId,
    participantUsername: username,
    participantAvatar: '',
    unreadCount: 0,
    isOnline,
    keyExchanged: true,
    createdAt: Date.now(),
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('handleDmPresenceUpdate', () => {
  it('is exposed on window', () => {
    expect(typeof (window as any).handleDmPresenceUpdate).toBe('function');
  });

  it('sets avatar to online class when status is "online"', () => {
    addTestConversation('ch-online-1', 'user-alice', 'Alice');

    (window as any).handleDmPresenceUpdate({ user_id: 'user-alice', username: 'Alice', status: 'online' });

    const avatar = document.querySelector('[data-conversation-id="ch-online-1"] .dm-avatar') as HTMLElement;
    expect(avatar).not.toBeNull();
    expect(avatar.classList.contains('online')).toBe(true);
    expect(avatar.classList.contains('offline')).toBe(false);
  });

  it('sets avatar to offline class when status is "offline"', () => {
    addTestConversation('ch-offline-1', 'user-bob', 'Bob', true /* starts online */);

    (window as any).handleDmPresenceUpdate({ user_id: 'user-bob', username: 'Bob', status: 'offline' });

    const avatar = document.querySelector('[data-conversation-id="ch-offline-1"] .dm-avatar') as HTMLElement;
    expect(avatar).not.toBeNull();
    expect(avatar.classList.contains('offline')).toBe(true);
    expect(avatar.classList.contains('online')).toBe(false);
  });

  it('does not throw for unknown user IDs', () => {
    expect(() => {
      (window as any).handleDmPresenceUpdate({ user_id: 'nobody-xyz', username: 'Nobody', status: 'online' });
    }).not.toThrow();
  });
});
