/**
 * Unit tests for src/renderer/managers/app-lock-manager.ts
 *
 * The app-lock-manager IIFE exports:
 *   - initAppLock()            — sets up event listeners and idle timer
 *   - lockApp()                — locks the application, shows overlay
 *   - unlockApp(pin)           — validates PIN, unlocks if correct
 *   - isAppLocked()            — returns current lock state
 *   - updateAppLockSettings(s) — updates settings and resets timers
 *
 * Tests cover:
 *   - Window exports
 *   - Lock / unlock state transitions
 *   - PIN validation (correct / incorrect / lockout)
 *   - Idle timeout triggering lock
 *   - Focus loss triggering lock
 *   - Disabled feature does not trigger lock
 */

import { JSDOM } from 'jsdom';

let mockIpcInvoke: jest.Mock;
let mockGetPluginSettings: jest.Mock;

const CORRECT_PIN = '1234';

function buildDefaultSettings(overrides: Partial<AppLockSettings> = {}): PluginSettings {
  return {
    readAllButton: false,
    appLock: {
      enabled: true,
      idleTimeoutMinutes: 1,
      lockOnFocusLoss: false,
      focusLossDelaySeconds: 5,
      ...overrides,
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();

  // --- Mock window.electronAPI.ipc ---
  mockIpcInvoke = jest.fn().mockImplementation((channel: string, ...args: unknown[]) => {
    if (channel === 'verify-pin') {
      return Promise.resolve(args[0] === CORRECT_PIN);
    }
    if (channel === 'has-pin') {
      return Promise.resolve(true);
    }
    return Promise.resolve(null);
  });

  // Track IPC 'on' listeners so tests can trigger them
  const ipcListeners: Record<string, (() => void)[]> = {};
  const mockIpcOn = jest.fn().mockImplementation((channel: string, listener: () => void) => {
    if (!ipcListeners[channel]) ipcListeners[channel] = [];
    ipcListeners[channel].push(listener);
  });
  (window as any)._ipcListeners = ipcListeners;

  (window as any).electronAPI = {
    ipc: {
      invoke: mockIpcInvoke,
      send: jest.fn(),
      on: mockIpcOn,
    },
    crypto: {},
    nacl: {},
    naclUtil: {},
  };

  // --- Mock window.emberLog ---
  (window as any).emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  // --- Mock window.getPluginSettings ---
  mockGetPluginSettings = jest.fn().mockReturnValue(buildDefaultSettings());
  (window as any).getPluginSettings = mockGetPluginSettings;

  // --- Build DOM ---
  const overlay = document.createElement('div');
  overlay.id = 'app-lock-overlay';
  overlay.className = 'hidden';
  overlay.style.display = 'none';

  const pinInput = document.createElement('input');
  pinInput.id = 'app-lock-pin-input';
  pinInput.type = 'password';
  overlay.appendChild(pinInput);

  const errorEl = document.createElement('div');
  errorEl.id = 'app-lock-error';
  errorEl.className = 'hidden';
  overlay.appendChild(errorEl);

  const lockoutEl = document.createElement('div');
  lockoutEl.id = 'app-lock-lockout';
  lockoutEl.className = 'hidden';
  overlay.appendChild(lockoutEl);

  const submitBtn = document.createElement('button');
  submitBtn.id = 'app-lock-submit-btn';
  overlay.appendChild(submitBtn);

  const lockIcon = document.createElement('div');
  lockIcon.id = 'app-lock-icon';
  overlay.appendChild(lockIcon);

  document.body.appendChild(overlay);

  // Load the IIFE
  require('../../../src/renderer/managers/app-lock-manager');
});

afterEach(() => {
  // Clean up DOM
  const overlay = document.getElementById('app-lock-overlay');
  if (overlay) overlay.remove();

  jest.clearAllTimers();
  jest.useRealTimers();
});

// ─── Window exports ───────────────────────────────────────────────────────────

describe('window exports', () => {
  it('exports initAppLock on window', () => {
    expect(typeof (window as any).initAppLock).toBe('function');
  });

  it('exports lockApp on window', () => {
    expect(typeof (window as any).lockApp).toBe('function');
  });

  it('exports unlockApp on window', () => {
    expect(typeof (window as any).unlockApp).toBe('function');
  });

  it('exports isAppLocked on window', () => {
    expect(typeof (window as any).isAppLocked).toBe('function');
  });

  it('exports updateAppLockSettings on window', () => {
    expect(typeof (window as any).updateAppLockSettings).toBe('function');
  });
});

// ─── Initial state ────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('isAppLocked returns false before any locking', () => {
    expect((window as any).isAppLocked()).toBe(false);
  });

  it('overlay is hidden initially', () => {
    const overlay = document.getElementById('app-lock-overlay')!;
    expect(overlay.classList.contains('hidden')).toBe(true);
  });
});

// ─── lockApp ──────────────────────────────────────────────────────────────────

describe('lockApp', () => {
  it('sets locked state to true', () => {
    (window as any).lockApp();
    expect((window as any).isAppLocked()).toBe(true);
  });

  it('shows the overlay by removing hidden class', () => {
    (window as any).lockApp();
    const overlay = document.getElementById('app-lock-overlay')!;
    expect(overlay.classList.contains('hidden')).toBe(false);
  });

  it('clears the PIN input field when locking', () => {
    const pinInput = document.getElementById('app-lock-pin-input') as HTMLInputElement;
    pinInput.value = 'something';
    (window as any).lockApp();
    expect(pinInput.value).toBe('');
  });

  it('does not lock when feature is disabled', () => {
    mockGetPluginSettings.mockReturnValue(buildDefaultSettings({ enabled: false }));
    jest.resetModules();
    require('../../../src/renderer/managers/app-lock-manager');

    (window as any).lockApp();
    expect((window as any).isAppLocked()).toBe(false);
  });
});

// ─── unlockApp ────────────────────────────────────────────────────────────────

describe('unlockApp', () => {
  beforeEach(() => {
    (window as any).lockApp();
  });

  it('returns true and unlocks when correct PIN is provided', async () => {
    const result = await (window as any).unlockApp(CORRECT_PIN);
    expect(result).toBe(true);
    expect((window as any).isAppLocked()).toBe(false);
  });

  it('hides overlay when correct PIN is provided', async () => {
    await (window as any).unlockApp(CORRECT_PIN);
    const overlay = document.getElementById('app-lock-overlay')!;
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('returns false and stays locked when wrong PIN is provided', async () => {
    const result = await (window as any).unlockApp('0000');
    expect(result).toBe(false);
    expect((window as any).isAppLocked()).toBe(true);
  });

  it('keeps overlay visible when wrong PIN is provided', async () => {
    await (window as any).unlockApp('0000');
    const overlay = document.getElementById('app-lock-overlay')!;
    expect(overlay.classList.contains('hidden')).toBe(false);
  });

  it('shows error message when wrong PIN is provided', async () => {
    await (window as any).unlockApp('0000');
    const errorEl = document.getElementById('app-lock-error')!;
    expect(errorEl.classList.contains('hidden')).toBe(false);
  });

  it('clears error message after successful unlock', async () => {
    await (window as any).unlockApp('0000'); // trigger error
    await (window as any).unlockApp(CORRECT_PIN); // unlock
    const errorEl = document.getElementById('app-lock-error')!;
    expect(errorEl.classList.contains('hidden')).toBe(true);
  });
});

// ─── PIN lockout ──────────────────────────────────────────────────────────────

describe('PIN lockout after max failed attempts', () => {
  const MAX_ATTEMPTS = 5;

  beforeEach(() => {
    (window as any).lockApp();
  });

  it('shows lockout message after max failed attempts', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await (window as any).unlockApp('wrong');
    }
    const lockoutEl = document.getElementById('app-lock-lockout')!;
    expect(lockoutEl.classList.contains('hidden')).toBe(false);
  });

  it('rejects correct PIN during lockout period', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await (window as any).unlockApp('wrong');
    }
    const result = await (window as any).unlockApp(CORRECT_PIN);
    expect(result).toBe(false);
    expect((window as any).isAppLocked()).toBe(true);
  });

  it('allows unlock after lockout period expires', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await (window as any).unlockApp('wrong');
    }
    // Advance past the 30-second lockout
    jest.advanceTimersByTime(31000);
    await Promise.resolve(); // flush microtasks

    const result = await (window as any).unlockApp(CORRECT_PIN);
    expect(result).toBe(true);
  });
});

// ─── Idle timeout ─────────────────────────────────────────────────────────────

describe('idle timeout', () => {
  it('triggers lock after idle timeout when enabled', () => {
    // idleTimeoutMinutes = 1 → 60 seconds
    jest.advanceTimersByTime(61000);
    expect((window as any).isAppLocked()).toBe(true);
  });

  it('does NOT trigger lock when feature is disabled', () => {
    jest.resetModules();
    mockGetPluginSettings.mockReturnValue(buildDefaultSettings({ enabled: false }));
    require('../../../src/renderer/managers/app-lock-manager');

    jest.advanceTimersByTime(61000);
    expect((window as any).isAppLocked()).toBe(false);
  });

  it('resets idle timer when user activity is detected', () => {
    // Advance 50 seconds (not yet locked)
    jest.advanceTimersByTime(50000);
    // Simulate user activity
    document.dispatchEvent(new Event('mousemove'));
    // Advance another 50 seconds — if timer wasn't reset, it would have locked at 60s
    jest.advanceTimersByTime(50000);
    expect((window as any).isAppLocked()).toBe(false);
  });
});

// ─── Focus loss locking ───────────────────────────────────────────────────────

function fireIpc(channel: string): void {
  const listeners = (window as any)._ipcListeners?.[channel] ?? [];
  for (const fn of listeners) fn();
}

describe('focus loss locking', () => {
  it('locks after focus loss delay when lockOnFocusLoss is true', () => {
    jest.resetModules();
    mockGetPluginSettings.mockReturnValue(
      buildDefaultSettings({ lockOnFocusLoss: true, focusLossDelaySeconds: 5 })
    );
    require('../../../src/renderer/managers/app-lock-manager');

    fireIpc('window-blur');
    jest.advanceTimersByTime(5001);
    expect((window as any).isAppLocked()).toBe(true);
  });

  it('does NOT lock on focus loss when lockOnFocusLoss is false', () => {
    fireIpc('window-blur');
    jest.advanceTimersByTime(10000);
    expect((window as any).isAppLocked()).toBe(false);
  });

  it('cancels focus loss timer when window regains focus', () => {
    jest.resetModules();
    mockGetPluginSettings.mockReturnValue(
      buildDefaultSettings({ lockOnFocusLoss: true, focusLossDelaySeconds: 5 })
    );
    require('../../../src/renderer/managers/app-lock-manager');

    fireIpc('window-blur');
    jest.advanceTimersByTime(3000); // not yet locked
    fireIpc('window-focus');
    jest.advanceTimersByTime(5000); // would have locked if not cancelled
    expect((window as any).isAppLocked()).toBe(false);
  });
});

// ─── updateAppLockSettings ────────────────────────────────────────────────────

describe('updateAppLockSettings', () => {
  it('disabling feature stops idle lock', () => {
    (window as any).updateAppLockSettings({ enabled: false });
    jest.advanceTimersByTime(61000);
    expect((window as any).isAppLocked()).toBe(false);
  });

  it('changing timeout takes effect immediately', () => {
    // Update to 2 minute timeout
    (window as any).updateAppLockSettings({ enabled: true, idleTimeoutMinutes: 2 });
    // 1 minute shouldn't lock
    jest.advanceTimersByTime(61000);
    expect((window as any).isAppLocked()).toBe(false);
    // 2 minutes should lock
    jest.advanceTimersByTime(60000);
    expect((window as any).isAppLocked()).toBe(true);
  });
});
