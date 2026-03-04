/**
 * Unit tests for src/renderer/managers/update-notifier.ts
 *
 * The IIFE captures globals at load time. We set up all required mocks first,
 * then require() the module. Each describe block resets the DOM and re-requires
 * the module to isolate test state.
 */

let mockIpcInvoke: jest.Mock;

beforeAll(() => {
  // window.App is not needed by update-notifier, but set a minimal stub
  (window as any).App = {};

  mockIpcInvoke = jest.fn().mockResolvedValue({ updateAvailable: false, currentVersion: '0.0.13', latestVersion: null });

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

  // Stub setInterval to prevent periodic checks from interfering with tests
  jest.spyOn(global, 'setInterval').mockImplementation(() => 0 as any);
});

beforeEach(() => {
  // Clean up the notification element between tests
  const existing = document.getElementById('ember-update-notification');
  if (existing) existing.remove();

  // Reset mock state
  mockIpcInvoke.mockClear();

  // Reset module registry so the IIFE re-runs for each test
  jest.resetModules();

  // Re-apply mocks after module reset (they persist on window)
  (window as any).electronAPI.ipc.invoke = mockIpcInvoke;
});

describe('checkForUpdate', () => {
  test('does not create a notification when no update is available', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ updateAvailable: false, currentVersion: '0.0.13', latestVersion: '0.0.13' });

    require('../../../src/renderer/managers/update-notifier');

    // Allow async IPC call to resolve
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.getElementById('ember-update-notification')).toBeNull();
  });

  test('creates a notification when an update is available', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ updateAvailable: true, currentVersion: '0.0.13', latestVersion: '0.0.14' });

    require('../../../src/renderer/managers/update-notifier');
    await new Promise(resolve => setTimeout(resolve, 0));

    const el = document.getElementById('ember-update-notification');
    expect(el).not.toBeNull();
  });

  test('notification displays the correct version string', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ updateAvailable: true, currentVersion: '0.0.13', latestVersion: '0.0.14' });

    require('../../../src/renderer/managers/update-notifier');
    await new Promise(resolve => setTimeout(resolve, 0));

    const el = document.getElementById('ember-update-notification');
    expect(el?.textContent).toContain('0.0.14');
  });

  test('does not create notification when IPC call fails', async () => {
    mockIpcInvoke.mockRejectedValueOnce(new Error('network error'));

    require('../../../src/renderer/managers/update-notifier');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.getElementById('ember-update-notification')).toBeNull();
  });
});

describe('dismissUpdateNotification', () => {
  test('removes the notification element', async () => {
    mockIpcInvoke.mockResolvedValue({ updateAvailable: true, currentVersion: '0.0.13', latestVersion: '0.0.14' });

    require('../../../src/renderer/managers/update-notifier');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.getElementById('ember-update-notification')).not.toBeNull();

    (window as any).dismissUpdateNotification();

    expect(document.getElementById('ember-update-notification')).toBeNull();
  });

  test('dismissing same version prevents re-showing', async () => {
    mockIpcInvoke.mockResolvedValue({ updateAvailable: true, currentVersion: '0.0.13', latestVersion: '0.0.14' });

    require('../../../src/renderer/managers/update-notifier');
    await new Promise(resolve => setTimeout(resolve, 0));

    (window as any).dismissUpdateNotification();
    expect(document.getElementById('ember-update-notification')).toBeNull();

    // Call checkForUpdate again — same version should not re-appear
    await (window as any).checkForUpdate();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.getElementById('ember-update-notification')).toBeNull();
  });

  test('a different newer version shows notification after dismiss', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ updateAvailable: true, currentVersion: '0.0.13', latestVersion: '0.0.14' });

    require('../../../src/renderer/managers/update-notifier');
    await new Promise(resolve => setTimeout(resolve, 0));

    (window as any).dismissUpdateNotification();

    // Now a newer version is released
    mockIpcInvoke.mockResolvedValueOnce({ updateAvailable: true, currentVersion: '0.0.13', latestVersion: '0.0.15' });

    await (window as any).checkForUpdate();
    await new Promise(resolve => setTimeout(resolve, 0));

    const el = document.getElementById('ember-update-notification');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('0.0.15');
  });
});
