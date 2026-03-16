/**
 * Unit tests for src/renderer/managers/read-all-manager.ts
 *
 * Tests cover:
 *   - readAll: exposed on window
 *   - readAll: calls clearAllChannelUnread
 *   - readAll: calls clearAllDmUnread
 *   - read-all-btn: click triggers readAll
 */

let mockClearAllChannelUnread: jest.Mock;
let mockClearAllDmUnread: jest.Mock;

beforeAll(() => {
  // 1. Populate window.App
  require('../../../src/renderer/managers/app-state');

  // 2. Add the read-all-btn to the DOM before the IIFE loads
  const btn = document.createElement('div');
  btn.id = 'read-all-btn';
  document.body.appendChild(btn);

  // 3. Mock window.electronAPI
  (window as any).electronAPI = {
    ipc: { invoke: jest.fn(), send: jest.fn(), on: jest.fn() },
    crypto: {},
    nacl: {},
    naclUtil: {},
  };

  // 4. Mock window.emberLog
  (window as any).emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  // 5. Mock the functions that read-all-manager depends on
  mockClearAllChannelUnread = jest.fn();
  mockClearAllDmUnread = jest.fn();
  (window as any).clearAllChannelUnread = mockClearAllChannelUnread;
  (window as any).clearAllDmUnread = mockClearAllDmUnread;

  // 6. Load the IIFE
  require('../../../src/renderer/managers/read-all-manager');
});

beforeEach(() => {
  mockClearAllChannelUnread.mockClear();
  mockClearAllDmUnread.mockClear();
});

// ─── readAll ──────────────────────────────────────────────────────────────────

describe('readAll', () => {
  it('is exposed on window', () => {
    expect(typeof (window as any).readAll).toBe('function');
  });

  it('calls clearAllChannelUnread', () => {
    (window as any).readAll();
    expect(mockClearAllChannelUnread).toHaveBeenCalledTimes(1);
  });

  it('calls clearAllDmUnread', () => {
    (window as any).readAll();
    expect(mockClearAllDmUnread).toHaveBeenCalledTimes(1);
  });

  it('does not throw when clearAllChannelUnread is not defined', () => {
    const original = (window as any).clearAllChannelUnread;
    delete (window as any).clearAllChannelUnread;
    expect(() => (window as any).readAll()).not.toThrow();
    (window as any).clearAllChannelUnread = original;
  });
});

// ─── read-all-btn click ───────────────────────────────────────────────────────

describe('read-all-btn click', () => {
  it('triggers clearAllChannelUnread when clicked', () => {
    const btn = document.getElementById('read-all-btn')!;
    btn.click();
    expect(mockClearAllChannelUnread).toHaveBeenCalled();
  });

  it('triggers clearAllDmUnread when clicked', () => {
    const btn = document.getElementById('read-all-btn')!;
    btn.click();
    expect(mockClearAllDmUnread).toHaveBeenCalled();
  });
});
