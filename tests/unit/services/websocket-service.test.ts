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
      JSON.stringify({ type: 'subscribe', channel_id: 'ch-123' })
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
      JSON.stringify({ type: 'subscribe_ember', ember_id: 'e-456' })
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
      { user_id: 'user-1', username: 'Alice', status: 'online', role: 'member' },
    ];

    (window as any).handlePresenceUpdate({ user_id: 'user-1', username: 'Alice', status: 'idle' });

    expect((window as any).App.currentMembers[0].status).toBe('idle');
    expect(mockRenderMemberList).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ user_id: 'user-1', status: 'idle' })])
    );
  });

  it('appends a new member entry when user_id is not found', () => {
    (window as any).handlePresenceUpdate({ user_id: 'user-2', username: 'Bob', status: 'online' });

    expect((window as any).App.currentMembers).toHaveLength(1);
    expect((window as any).App.currentMembers[0]).toEqual({
      user_id: 'user-2',
      username: 'Bob',
      status: 'online',
      role: 'member',
    });
    expect(mockRenderMemberList).toHaveBeenCalled();
  });

  it('does not modify other members when updating one', () => {
    (window as any).App.currentMembers = [
      { user_id: 'user-1', username: 'Alice', status: 'online', role: 'member' },
      { user_id: 'user-2', username: 'Bob', status: 'online', role: 'member' },
    ];

    (window as any).handlePresenceUpdate({ user_id: 'user-2', username: 'Bob', status: 'dnd' });

    expect((window as any).App.currentMembers[0].status).toBe('online');
    expect((window as any).App.currentMembers[1].status).toBe('dnd');
  });

  it('calls renderMemberList with the updated members array', () => {
    (window as any).App.currentMembers = [
      { user_id: 'user-1', username: 'Alice', status: 'online', role: 'member' },
    ];

    (window as any).handlePresenceUpdate({ user_id: 'user-1', username: 'Alice', status: 'offline' });

    expect(mockRenderMemberList).toHaveBeenCalledTimes(1);
    expect(mockRenderMemberList).toHaveBeenCalledWith((window as any).App.currentMembers);
  });
});

// ─── disconnectWebSocket ──────────────────────────────────────────────────────

describe('disconnectWebSocket', () => {
  it('calls close() on the WebSocket and sets wsConnection to null', () => {
    const mockClose = jest.fn();
    (window as any).App.wsConnection = { readyState: WebSocket.OPEN, close: mockClose, send: jest.fn() };

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
