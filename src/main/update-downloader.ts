/**
 * update-downloader.ts
 *
 * Handles downloading and installing application updates from GitHub releases.
 * Runs in the main process only.
 */
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { shell } from 'electron';
import { createLogger } from './logger';

const log = createLogger('UpdateDownloader');

export interface GitHubAsset {
  readonly name: string;
  readonly browser_download_url: string;
  readonly size: number;
}

export interface DownloadProgress {
  readonly bytesDownloaded: number;
  readonly totalBytes: number;
  readonly percentage: number;
}

export interface DownloadResult {
  readonly filePath: string;
}

let activeRequest: http.ClientRequest | null = null;
let installOnExitPath: string | null = null;

/** Select the best asset for the current platform from a GitHub release's asset list. */
export function selectAssetForPlatform(assets: readonly GitHubAsset[]): GitHubAsset | null {
  const platform = process.platform;

  if (platform === 'win32') {
    return (
      assets.find(a => /Setup.*\.exe$/i.test(a.name)) ??
      assets.find(a => a.name.endsWith('.exe') && !a.name.endsWith('.blockmap')) ??
      null
    );
  }

  if (platform === 'darwin') {
    return (
      assets.find(a => a.name.endsWith('.dmg')) ??
      assets.find(a => a.name.endsWith('-mac.zip')) ??
      null
    );
  }

  // Linux
  return (
    assets.find(a => a.name.endsWith('.AppImage')) ??
    assets.find(a => a.name.endsWith('.deb')) ??
    null
  );
}

/** Download a release asset to the system temp directory, reporting progress. */
export function downloadAsset(
  asset: GitHubAsset,
  onProgress: (progress: DownloadProgress) => void
): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    const destPath = path.join(os.tmpdir(), asset.name);
    const writeStream = fs.createWriteStream(destPath);
    let bytesDownloaded = 0;
    const totalBytes = asset.size;

    function makeRequest(url: string): void {
      const parsedUrl = new URL(url);
      const mod = parsedUrl.protocol === 'https:' ? https : http;

      const req = mod.get(url, { headers: { 'User-Agent': 'ember-client' } }, (response) => {
        const { statusCode, headers } = response;

        if (
          (statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) &&
          headers.location
        ) {
          response.resume();
          makeRequest(headers.location);
          return;
        }

        if (statusCode !== 200) {
          writeStream.destroy();
          reject(new Error(`HTTP ${statusCode}`));
          return;
        }

        response.on('data', (chunk: Buffer) => {
          bytesDownloaded += chunk.length;
          const percentage = totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 100) : 0;
          onProgress({ bytesDownloaded, totalBytes, percentage });
        });

        response.pipe(writeStream);

        writeStream.on('finish', () => {
          activeRequest = null;
          log.info('Download complete', { assetName: asset.name });
          resolve({ filePath: destPath });
        });

        writeStream.on('error', (err) => {
          activeRequest = null;
          reject(err);
        });

        response.on('error', (err) => {
          activeRequest = null;
          reject(err);
        });
      });

      req.on('error', (err) => {
        activeRequest = null;
        reject(err);
      });

      activeRequest = req;
    }

    makeRequest(asset.browser_download_url);
  });
}

/** Cancel any active download. */
export function cancelActiveDownload(): void {
  if (activeRequest) {
    activeRequest.destroy();
    activeRequest = null;
    log.info('Download cancelled');
  }
}

/** Open the downloaded file using the OS default handler (installer, package manager, etc.). */
export async function launchInstaller(filePath: string): Promise<void> {
  log.info('Launching installer', { platform: process.platform });

  if (process.platform === 'linux' && filePath.endsWith('.AppImage')) {
    try {
      fs.chmodSync(filePath, 0o755);
    } catch {
      log.warn('Failed to chmod AppImage');
    }
  }

  const errorMsg = await shell.openPath(filePath);
  if (errorMsg) {
    log.warn('shell.openPath returned an error', { errorMsg });
    throw new Error(errorMsg);
  }
}

/** Store a downloaded installer path to launch on next app quit. */
export function scheduleInstallOnExit(filePath: string): void {
  installOnExitPath = filePath;
  log.info('Update scheduled for installation on exit');
}

/** Returns the path scheduled for install-on-exit (if any). */
export function getInstallOnExitPath(): string | null {
  return installOnExitPath;
}
