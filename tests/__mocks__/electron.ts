/**
 * Jest manual mock for the 'electron' module.
 * Provides no-op stubs for the Electron APIs used by main-process modules.
 */

export const ipcMain = {
  handle: jest.fn(),
  on: jest.fn(),
  removeHandler: jest.fn(),
};

export const app = {
  getPath: jest.fn(() => '/tmp'),
  getVersion: jest.fn(() => '0.0.0'),
};

export const safeStorage = {
  isEncryptionAvailable: jest.fn(() => false),
  encryptString: jest.fn((s: string) => Buffer.from(s)),
  decryptString: jest.fn((b: Buffer) => b.toString()),
};

export const BrowserWindow = jest.fn();
export const shell = { openExternal: jest.fn() };
export const net = { request: jest.fn() };
export const desktopCapturer = {
  getSources: jest.fn(() => Promise.resolve([])),
};
