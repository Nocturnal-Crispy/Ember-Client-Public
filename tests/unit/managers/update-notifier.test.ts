/**
 * Unit tests for src/renderer/managers/update-notifier.ts
 *
 * The IIFE captures globals at load time. We set up all required mocks first,
 * then require() the module. Each describe block resets the DOM and re-requires
 * the module to isolate test state.
 */

let mockIpcInvoke: jest.Mock;
let windowControls: HTMLDivElement;

beforeAll(() => {
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

  jest.spyOn(global, 'setInterval').mockImplementation(() => 0 as any);
});

beforeEach(() => {
  // Provide the .window-controls container the module inserts into
  windowControls = document.createElement('div');
  windowControls.className = 'window-controls';
  const minimizeBtn = document.createElement('button');
  minimizeBtn.id = 'minimize-btn';
  windowControls.appendChild(minimizeBtn);
  document.body.appendChild(windowControls);

  // Clean up any leftover notification
  document.getElementById('ember-update-notification')?.remove();

  mockIpcInvoke.mockClear();
  jest.resetModules();
  (window as any).electronAPI.ipc.invoke = mockIpcInvoke;
});

afterEach(() => {
  windowControls.remove();
});

describe('checkForUpdate', () => {
  test('does not create a notification when no update is available', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ updateAvailable: false, currentVersion: '0.0.13', latestVersion: '0.0.13' });

    require('../../../src/renderer/managers/update-notifier');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.getElementById('ember-update-notification')).toBeNull();
  });

  test('creates a notification when an update is available', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ updateAvailable: true, currentVersion: '0.0.13', latestVersion: '0.0.14' });

    require('../../../src/renderer/managers/update-notifier');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.getElementById('ember-update-notification')).not.toBeNull();
  });

  test('notification is inserted before the minimize button', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ updateAvailable: true, currentVersion: '0.0.13', latestVersion: '0.0.14' });

    require('../../../src/renderer/managers/update-notifier');
    await new Promise(resolve => setTimeout(resolve, 0));

    const children = Array.from(windowControls.children);
    const notifIndex = children.findIndex(el => el.id === 'ember-update-notification');
    const minimizeIndex = children.findIndex(el => el.id === 'minimize-btn');
    expect(notifIndex).toBeGreaterThanOrEqual(0);
    expect(notifIndex).toBeLessThan(minimizeIndex);
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

    await (window as any).checkForUpdate();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.getElementById('ember-update-notification')).toBeNull();
  });

  test('a different newer version shows notification after dismiss', async () => {
    mockIpcInvoke.mockResolvedValueOnce({ updateAvailable: true, currentVersion: '0.0.13', latestVersion: '0.0.14' });

    require('../../../src/renderer/managers/update-notifier');
    await new Promise(resolve => setTimeout(resolve, 0));

    (window as any).dismissUpdateNotification();

    mockIpcInvoke.mockResolvedValueOnce({ updateAvailable: true, currentVersion: '0.0.13', latestVersion: '0.0.15' });

    await (window as any).checkForUpdate();
    await new Promise(resolve => setTimeout(resolve, 0));

    const el = document.getElementById('ember-update-notification');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('0.0.15');
  });
});
