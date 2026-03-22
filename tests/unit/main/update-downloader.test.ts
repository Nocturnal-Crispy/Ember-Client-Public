/**
 * Unit tests for update-downloader.ts
 *
 * Covers launchInstaller() behaviour including:
 * - chmod applied before shell.openPath on Linux
 * - KIO / shell errors surfaced correctly
 * - Non-Linux paths pass through without chmod
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('electron', () => ({
  shell: {
    openPath: jest.fn(),
  },
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  chmodSync: jest.fn(),
}));

// Import after mocks are in place
import { shell } from 'electron';
import { launchInstaller } from '../../../src/main/update-downloader';

const mockOpenPath = shell.openPath as jest.MockedFunction<typeof shell.openPath>;
const mockChmodSync = fs.chmodSync as jest.MockedFunction<typeof fs.chmodSync>;

describe('launchInstaller', () => {
  const savedPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: savedPlatform });
  });

  function setPlatform(platform: string): void {
    Object.defineProperty(process, 'platform', { value: platform });
  }

  describe('on Linux', () => {
    beforeEach(() => setPlatform('linux'));

    it('sets executable permission on AppImage before opening', async () => {
      mockOpenPath.mockResolvedValue('');
      await launchInstaller('/tmp/Ember-1.0.AppImage');
      expect(mockChmodSync).toHaveBeenCalledWith('/tmp/Ember-1.0.AppImage', 0o755);
      expect(mockOpenPath).toHaveBeenCalledWith('/tmp/Ember-1.0.AppImage');
    });

    it('sets executable permission on deb package before opening', async () => {
      mockOpenPath.mockResolvedValue('');
      await launchInstaller('/tmp/ember_1.0_amd64.deb');
      expect(mockChmodSync).toHaveBeenCalledWith('/tmp/ember_1.0_amd64.deb', 0o755);
      expect(mockOpenPath).toHaveBeenCalledWith('/tmp/ember_1.0_amd64.deb');
    });

    it('still calls openPath even when chmod throws', async () => {
      mockChmodSync.mockImplementation(() => {
        throw new Error('permission denied');
      });
      mockOpenPath.mockResolvedValue('');
      await launchInstaller('/tmp/Ember-1.0.AppImage');
      expect(mockOpenPath).toHaveBeenCalledWith('/tmp/Ember-1.0.AppImage');
    });

    it('throws when shell.openPath returns a KIO security error', async () => {
      const kioError =
        'KIO Client: For security reasons, launching executables is not allowed in this context';
      mockOpenPath.mockResolvedValue(kioError);
      await expect(launchInstaller('/tmp/Ember-1.0.AppImage')).rejects.toThrow(kioError);
    });

    it('throws when shell.openPath returns any non-empty error string', async () => {
      mockOpenPath.mockResolvedValue('Could not open file');
      await expect(launchInstaller('/tmp/ember_1.0.deb')).rejects.toThrow('Could not open file');
    });
  });

  describe('on Windows', () => {
    beforeEach(() => setPlatform('win32'));

    it('does not call chmod on Windows', async () => {
      mockOpenPath.mockResolvedValue('');
      await launchInstaller(path.join(os.tmpdir(), 'Ember-Setup.exe'));
      expect(mockChmodSync).not.toHaveBeenCalled();
    });

    it('opens the installer without error', async () => {
      mockOpenPath.mockResolvedValue('');
      await expect(
        launchInstaller(path.join(os.tmpdir(), 'Ember-Setup.exe'))
      ).resolves.toBeUndefined();
    });
  });

  describe('on macOS', () => {
    beforeEach(() => setPlatform('darwin'));

    it('does not call chmod on macOS', async () => {
      mockOpenPath.mockResolvedValue('');
      await launchInstaller(path.join(os.tmpdir(), 'Ember-1.0.dmg'));
      expect(mockChmodSync).not.toHaveBeenCalled();
    });
  });
});
