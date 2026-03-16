/**
 * Unit tests for app-lock-related behavior in plugin-settings.ts
 *
 * Tests cover:
 *   - Default settings include appLock with correct defaults
 *   - Existing settings are merged with defaults (backward compat)
 *   - getPluginSettings returns appLock settings
 *   - App lock settings can be saved and reloaded
 */

let mockIpcInvoke: jest.Mock;

beforeEach(() => {
  jest.resetModules();
  localStorage.clear();

  mockIpcInvoke = jest.fn().mockResolvedValue(null);
  (window as any).electronAPI = {
    ipc: {
      invoke: mockIpcInvoke,
      send: jest.fn(),
      on: jest.fn(),
    },
  };

  (window as any).emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  // Stub functions that plugin-settings may reference
  (window as any).lockApp = jest.fn();
  (window as any).updateAppLockSettings = jest.fn();
  (window as any).isAppLocked = jest.fn().mockReturnValue(false);
});

afterEach(() => {
  localStorage.clear();
});

// ─── Default settings ─────────────────────────────────────────────────────────

describe('default settings include appLock', () => {
  it('getPluginSettings returns appLock with enabled=false by default', () => {
    require('../../../src/renderer/managers/plugin-settings');
    const settings = (window as any).getPluginSettings() as PluginSettings;
    expect(settings.appLock).toBeDefined();
    expect(settings.appLock.enabled).toBe(false);
  });

  it('default idleTimeoutMinutes is 5', () => {
    require('../../../src/renderer/managers/plugin-settings');
    const settings = (window as any).getPluginSettings() as PluginSettings;
    expect(settings.appLock.idleTimeoutMinutes).toBe(5);
  });

  it('default lockOnFocusLoss is false', () => {
    require('../../../src/renderer/managers/plugin-settings');
    const settings = (window as any).getPluginSettings() as PluginSettings;
    expect(settings.appLock.lockOnFocusLoss).toBe(false);
  });

  it('default focusLossDelaySeconds is 5', () => {
    require('../../../src/renderer/managers/plugin-settings');
    const settings = (window as any).getPluginSettings() as PluginSettings;
    expect(settings.appLock.focusLossDelaySeconds).toBe(5);
  });

  it('existing readAllButton setting is preserved', () => {
    require('../../../src/renderer/managers/plugin-settings');
    const settings = (window as any).getPluginSettings() as PluginSettings;
    expect(typeof settings.readAllButton).toBe('boolean');
  });
});

// ─── Settings persistence ─────────────────────────────────────────────────────

describe('appLock settings persistence', () => {
  it('saves appLock settings to localStorage', () => {
    require('../../../src/renderer/managers/plugin-settings');

    // Simulate saving settings with appLock enabled
    const toSave: PluginSettings = {
      readAllButton: false,
      appLock: {
        enabled: true,
        idleTimeoutMinutes: 10,
        lockOnFocusLoss: true,
        focusLossDelaySeconds: 15,
      },
    };
    localStorage.setItem('ember_plugin_settings', JSON.stringify(toSave));

    // Reset and reload module
    jest.resetModules();
    require('../../../src/renderer/managers/plugin-settings');

    const settings = (window as any).getPluginSettings() as PluginSettings;
    expect(settings.appLock.enabled).toBe(true);
    expect(settings.appLock.idleTimeoutMinutes).toBe(10);
    expect(settings.appLock.lockOnFocusLoss).toBe(true);
    expect(settings.appLock.focusLossDelaySeconds).toBe(15);
  });

  it('merges partial appLock settings with defaults', () => {
    // Only store partial appLock settings (e.g., from older version)
    const partial = { readAllButton: true, appLock: { enabled: true } };
    localStorage.setItem('ember_plugin_settings', JSON.stringify(partial));

    require('../../../src/renderer/managers/plugin-settings');
    const settings = (window as any).getPluginSettings() as PluginSettings;

    expect(settings.appLock.enabled).toBe(true);
    // Defaults applied for missing fields
    expect(settings.appLock.idleTimeoutMinutes).toBe(5);
    expect(settings.appLock.lockOnFocusLoss).toBe(false);
  });

  it('handles missing appLock key in stored settings (backward compatibility)', () => {
    // Old settings without appLock
    const old = { readAllButton: true };
    localStorage.setItem('ember_plugin_settings', JSON.stringify(old));

    require('../../../src/renderer/managers/plugin-settings');
    const settings = (window as any).getPluginSettings() as PluginSettings;

    expect(settings.readAllButton).toBe(true);
    expect(settings.appLock).toBeDefined();
    expect(settings.appLock.enabled).toBe(false);
  });
});
