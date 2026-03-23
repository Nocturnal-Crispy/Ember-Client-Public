/**
 * Unit tests for src/renderer/services/websocket-service.ts
 *
 * The IIFE captures window.App, window.electronAPI.ipc, and window.emberLog
 * at load time, so all mocks must be set up before require()-ing the module.
 *
 * Tests cover:
 *   - wsSubscribeToChannel: sends correct JSON over an open WebSocket
 *   - wsSubscribeToEmber: sends correct JSON over an open WebSocket
 *   - handlePresenceUpdate: updates existing member status / adds new member
 *   - disconnectWebSocket: closes connection and clears reconnect timer
 */

let mockIpcInvoke: jest.Mock;
let mockRenderMemberList: jest.Mock;

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
    wsService: {
      buildWsUrl: jest.fn().mockReturnValue('ws://localhost:8086/ws?token=tok'),
    },
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

  // 4. Stubs for functions called by websocket-service
  mockRenderMemberList = jest.fn();
  (window as any).renderMemberList = mockRenderMemberList;
  (window as any).displayDecryptedMessage = jest.fn();
  (window as any).handleVoiceUserJoined = jest.fn();
  (window as any).handleVoiceUserLeft = jest.fn();

  // 5. Load the IIFE
  require('../../../src/renderer/services/websocket-service');
});

// ─── wsSubscribeToChannel ─────────────────────────────────────────────────────

describe('wsSubscribeToChannel', () => {
  it('sends a subscribe JSON message when the WebSocket is open', () => {
    const mockWsSend = jest.fn();
    (window as any).App.wsConnection = { readyState: WebSocket.OPEN, send: mockWsSend };

    (window as any).wsSubscribeToChannel('ch-123');

    expect(mockWsSend).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribe', channelId: 'ch-123' })
    );
  });

  it('does not send when the WebSocket is not open', () => {
    const mockWsSend = jest.fn();
    (window as any).App.wsConnection = { readyState: WebSocket.CLOSED, send: mockWsSend };

    (window as any).wsSubscribeToChannel('ch-123');

    expect(mockWsSend).not.toHaveBeenCalled();
  });

  it('does not send when wsConnection is null', () => {
    (window as any).App.wsConnection = null;
    // Should not throw
    expect(() => (window as any).wsSubscribeToChannel('ch-123')).not.toThrow();
  });
});

// ─── wsSubscribeToEmber ───────────────────────────────────────────────────────

describe('wsSubscribeToEmber', () => {
  it('sends a subscribe_ember JSON message when the WebSocket is open', () => {
    const mockWsSend = jest.fn();
    (window as any).App.wsConnection = { readyState: WebSocket.OPEN, send: mockWsSend };

    (window as any).wsSubscribeToEmber('e-456');

    expect(mockWsSend).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribe_ember', emberId: 'e-456' })
    );
  });

  it('does not send when the WebSocket is not open', () => {
    const mockWsSend = jest.fn();
    (window as any).App.wsConnection = { readyState: WebSocket.CONNECTING, send: mockWsSend };

    (window as any).wsSubscribeToEmber('e-456');

    expect(mockWsSend).not.toHaveBeenCalled();
  });
});

// ─── handlePresenceUpdate ─────────────────────────────────────────────────────

describe('handlePresenceUpdate', () => {
  beforeEach(() => {
    // Reset currentMembers before each test
    (window as any).App.currentMembers = [];
  });

  it('updates the status of an existing member in App.currentMembers', () => {
    (window as any).App.currentMembers = [
      { userId: 'user-1', username: 'Alice', status: 'online', role: 'member' },
    ];

    (window as any).handlePresenceUpdate({ userId: 'user-1', username: 'Alice', status: 'idle' });

    expect((window as any).App.currentMembers[0].status).toBe('idle');
    expect(mockRenderMemberList).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ userId: 'user-1', status: 'idle' })])
    );
  });

  it('appends a new member entry when user_id is not found', () => {
    (window as any).handlePresenceUpdate({ userId: 'user-2', username: 'Bob', status: 'online' });

    expect((window as any).App.currentMembers).toHaveLength(1);
    expect((window as any).App.currentMembers[0]).toEqual({
      userId: 'user-2',
      username: 'Bob',
      status: 'online',
      role: 'member',
    });
    expect(mockRenderMemberList).toHaveBeenCalled();
  });

  it('does not modify other members when updating one', () => {
    (window as any).App.currentMembers = [
      { userId: 'user-1', username: 'Alice', status: 'online', role: 'member' },
      { userId: 'user-2', username: 'Bob', status: 'online', role: 'member' },
    ];

    (window as any).handlePresenceUpdate({ userId: 'user-2', username: 'Bob', status: 'dnd' });

    expect((window as any).App.currentMembers[0].status).toBe('online');
    expect((window as any).App.currentMembers[1].status).toBe('dnd');
  });

  it('updates custom_status and status_emoji for an existing member', () => {
    (window as any).App.currentMembers = [
      { userId: 'user-1', username: 'Alice', status: 'online', role: 'member' },
    ];

    (window as any).handlePresenceUpdate({
      userId: 'user-1',
      username: 'Alice',
      status: 'online',
      customStatus: 'Working on Ember',
      statusEmoji: '💻',
    });

    expect((window as any).App.currentMembers[0].customStatus).toBe('Working on Ember');
    expect((window as any).App.currentMembers[0].statusEmoji).toBe('💻');
    expect(mockRenderMemberList).toHaveBeenCalled();
  });

  it('includes custom_status and status_emoji when appending a new member', () => {
    (window as any).App.currentMembers = [];

    (window as any).handlePresenceUpdate({
      userId: 'user-3',
      username: 'Carol',
      status: 'idle',
      customStatus: 'On a break',
      statusEmoji: '☕',
    });

    expect((window as any).App.currentMembers).toHaveLength(1);
    expect((window as any).App.currentMembers[0].customStatus).toBe('On a break');
    expect((window as any).App.currentMembers[0].statusEmoji).toBe('☕');
  });

  it('handles presence update without custom_status gracefully', () => {
    (window as any).App.currentMembers = [
      {
        userId: 'user-1',
        username: 'Alice',
        status: 'online',
        role: 'member',
        customStatus: 'old status',
        statusEmoji: '🎯',
      },
    ];

    (window as any).handlePresenceUpdate({ userId: 'user-1', username: 'Alice', status: 'idle' });

    // Status updates, custom_status preserved (not cleared unless explicitly sent)
    expect((window as any).App.currentMembers[0].status).toBe('idle');
  });

  it('calls renderMemberList with the updated members array', () => {
    (window as any).App.currentMembers = [
      { userId: 'user-1', username: 'Alice', status: 'online', role: 'member' },
    ];

    (window as any).handlePresenceUpdate({
      userId: 'user-1',
      username: 'Alice',
      status: 'offline',
    });

    expect(mockRenderMemberList).toHaveBeenCalledTimes(1);
    expect(mockRenderMemberList).toHaveBeenCalledWith((window as any).App.currentMembers);
  });
});

// ─── handleIncomingMessage ────────────────────────────────────────────────────

describe('handleIncomingMessage', () => {
  let mockDisplayDecryptedMessage: jest.Mock;
  let mockMarkChannelUnread: jest.Mock;

  beforeEach(() => {
    mockDisplayDecryptedMessage = jest.fn();
    mockMarkChannelUnread = jest.fn();
    (window as any).displayDecryptedMessage = mockDisplayDecryptedMessage;
    (window as any).markChannelUnread = mockMarkChannelUnread;
    (window as any).App.activeChannelId = 'ch-active';
    mockIpcInvoke.mockReset();
  });

  it('displays a message arriving on the active channel from a different user', async () => {
    mockIpcInvoke.mockResolvedValue({ userId: 'user-self' });
    const payload = {
      id: 'msg-1',
      channelId: 'ch-active',
      senderUserId: 'user-other',
      ciphertext: 'abc',
      username: 'Bob',
    };

    await (window as any).handleIncomingMessage(payload);

    expect(mockDisplayDecryptedMessage).toHaveBeenCalledWith(payload);
    expect(mockMarkChannelUnread).not.toHaveBeenCalled();
  });

  it('does not display a message sent by the current user (self-filter)', async () => {
    mockIpcInvoke.mockResolvedValue({ userId: 'user-self' });
    const payload = {
      id: 'msg-self-1',
      channelId: 'ch-active',
      senderUserId: 'user-self',
      ciphertext: 'abc',
      username: 'Me',
    };

    await (window as any).handleIncomingMessage(payload);

    expect(mockDisplayDecryptedMessage).not.toHaveBeenCalled();
  });

  it('calls markChannelUnread for a message arriving on a background channel', async () => {
    mockIpcInvoke.mockResolvedValue({ userId: 'user-self' });
    const payload = {
      id: 'msg-bg-1',
      channelId: 'ch-other',
      senderUserId: 'user-other',
      ciphertext: 'abc',
      username: 'Bob',
    };

    await (window as any).handleIncomingMessage(payload);

    expect(mockMarkChannelUnread).toHaveBeenCalledWith('ch-other');
    expect(mockDisplayDecryptedMessage).not.toHaveBeenCalled();
  });

  it('does not display a duplicate message (already in dedup set via registerSentMessageId)', async () => {
    mockIpcInvoke.mockResolvedValue({ userId: 'user-self' });
    (window as any).registerSentMessageId('msg-dup-1');
    const payload = {
      id: 'msg-dup-1',
      channelId: 'ch-active',
      senderUserId: 'user-other',
      ciphertext: 'abc',
      username: 'Bob',
    };

    await (window as any).handleIncomingMessage(payload);

    expect(mockDisplayDecryptedMessage).not.toHaveBeenCalled();
  });

  it('displays a message when auth is null (cannot verify sender)', async () => {
    mockIpcInvoke.mockResolvedValue(null);
    const payload = {
      id: 'msg-noauth-1',
      channelId: 'ch-active',
      senderUserId: 'user-other',
      ciphertext: 'abc',
      username: 'Bob',
    };

    await (window as any).handleIncomingMessage(payload);

    expect(mockDisplayDecryptedMessage).toHaveBeenCalledWith(payload);
  });
});

// ─── wsUnsubscribeFromChannel ─────────────────────────────────────────────────

describe('wsUnsubscribeFromChannel', () => {
  it('sends an unsubscribe JSON message when the WebSocket is open', () => {
    const mockWsSend = jest.fn();
    (window as any).App.wsConnection = { readyState: WebSocket.OPEN, send: mockWsSend };

    (window as any).wsUnsubscribeFromChannel('ch-123');

    expect(mockWsSend).toHaveBeenCalledWith(
      JSON.stringify({ type: 'unsubscribe', channelId: 'ch-123' })
    );
  });

  it('does not send when the WebSocket is not open', () => {
    const mockWsSend = jest.fn();
    (window as any).App.wsConnection = { readyState: WebSocket.CLOSED, send: mockWsSend };

    (window as any).wsUnsubscribeFromChannel('ch-123');

    expect(mockWsSend).not.toHaveBeenCalled();
  });

  it('does not throw when wsConnection is null', () => {
    (window as any).App.wsConnection = null;
    expect(() => (window as any).wsUnsubscribeFromChannel('ch-123')).not.toThrow();
  });
});

// ─── disconnectWebSocket ──────────────────────────────────────────────────────

describe('disconnectWebSocket', () => {
  it('calls close() on the WebSocket and sets wsConnection to null', () => {
    const mockClose = jest.fn();
    (window as any).App.wsConnection = {
      readyState: WebSocket.OPEN,
      close: mockClose,
      send: jest.fn(),
    };

    (window as any).disconnectWebSocket();

    expect(mockClose).toHaveBeenCalled();
    expect((window as any).App.wsConnection).toBeNull();
  });

  it('clears any pending reconnect timer', () => {
    const timerId = setTimeout(() => {}, 99999);
    (window as any).App.wsReconnectTimer = timerId;
    (window as any).App.wsConnection = null;

    (window as any).disconnectWebSocket();

    expect((window as any).App.wsReconnectTimer).toBeNull();
  });

  it('does not throw when wsConnection is already null', () => {
    (window as any).App.wsConnection = null;
    expect(() => (window as any).disconnectWebSocket()).not.toThrow();
  });
});
