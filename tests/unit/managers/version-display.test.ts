/**
 * Unit tests for src/renderer/managers/version-display.ts
 *
 * The IIFE captures globals at load time. Set up mocks first, then require().
 */

let mockIpcInvoke: jest.Mock;
let mockFetch: jest.Mock;
let versionElement: HTMLSpanElement;

beforeAll(() => {
  (window as any).App = {};

  mockIpcInvoke = jest.fn().mockResolvedValue({
    updateAvailable: false,
    currentVersion: '1.2.3',
    latestVersion: null,
  });

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
  versionElement = document.createElement('span');
  versionElement.id = 'version-number';
  document.body.appendChild(versionElement);

  mockIpcInvoke.mockClear();
  mockIpcInvoke.mockResolvedValue({
    updateAvailable: false,
    currentVersion: '1.2.3',
    latestVersion: null,
  });

  jest.isolateModules(() => {
    require('../../../src/renderer/managers/version-display');
  });
});

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe('version-display IPC channel', () => {
  it('invokes the correct IPC channel name "check-for-update" (not "CHECK_FOR_UPDATE")', async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mockIpcInvoke).toHaveBeenCalledWith('check-for-update');
    expect(mockIpcInvoke).not.toHaveBeenCalledWith('CHECK_FOR_UPDATE');
  });

  it('displays the currentVersion returned from main process', async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(versionElement.textContent).toBe('1.2.3');
  });

  it('falls back to package.json version when IPC throws', async () => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    const el = document.createElement('span');
    el.id = 'version-number';
    document.body.appendChild(el);

    mockIpcInvoke.mockRejectedValueOnce(new Error('Blocked IPC channel: check-for-update'));

    mockFetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ version: '0.0.99' }),
    });
    (global as any).fetch = mockFetch;

    jest.isolateModules(() => {
      require('../../../src/renderer/managers/version-display');
    });

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(el.textContent).toBe('0.0.99');
  });
});
