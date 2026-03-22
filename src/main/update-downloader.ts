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
import * as crypto from 'crypto';
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

// ─── Path validation ──────────────────────────────────────────────────────────

/**
 * Validate that `assetName` is a plain filename (no directory separators or
 * traversal sequences) and return the resolved destination path inside tmpdir.
 * Throws if the name or resolved path would escape the temp directory.
 */
function buildSafeDestPath(assetName: string): string {
  const base = path.basename(assetName);
  if (base !== assetName || base === '' || base === '.' || base === '..') {
    throw new Error(`Unsafe asset name rejected: ${JSON.stringify(assetName)}`);
  }
  const dest = path.resolve(path.join(os.tmpdir(), base));
  const tmpdir = path.resolve(os.tmpdir());
  if (path.dirname(dest) !== tmpdir) {
    throw new Error(`Resolved download path escapes tmpdir: ${dest}`);
  }
  return dest;
}

/**
 * Validate that `filePath` resolves to a direct child of the system temp
 * directory. Called before chmod and shell.openPath to prevent a compromised
 * renderer from pointing the launcher at an arbitrary system path.
 */
export function validateInstallerPath(filePath: string): void {
  const resolved = path.resolve(filePath);
  const tmpdir = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== tmpdir) {
    throw new Error(`Installer path is not inside tmpdir: ${resolved}`);
  }
}

// ─── Checksum verification ────────────────────────────────────────────────────

/**
 * Return the companion checksum asset for `primary` if one exists in the
 * release assets list. Looks for `<name>.sha256` first, then `checksums.txt`.
 */
export function findChecksumAsset(
  assets: readonly GitHubAsset[],
  primary: GitHubAsset
): GitHubAsset | null {
  return (
    assets.find(a => a.name === `${primary.name}.sha256`) ??
    assets.find(a => a.name === 'checksums.txt') ??
    null
  );
}

/** Compute the SHA-256 hex digest of a local file. */
export function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** Download a small text file (e.g. checksums.txt) over HTTPS. */
export function downloadChecksumText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error(`Invalid checksum URL: ${url}`));
      return;
    }
    if (parsedUrl.protocol !== 'https:') {
      reject(new Error(`Checksum URL must use HTTPS: ${url}`));
      return;
    }

    function makeRequest(requestUrl: string): void {
      https
        .get(requestUrl, { headers: { 'User-Agent': 'ember-client' } }, res => {
          const { statusCode, headers } = res;

          if (
            (statusCode === 301 ||
              statusCode === 302 ||
              statusCode === 307 ||
              statusCode === 308) &&
            headers.location
          ) {
            // Enforce HTTPS-only redirects to prevent TLS-stripping attacks.
            let redirectUrl: URL;
            try {
              redirectUrl = new URL(headers.location);
            } catch {
              reject(new Error(`Invalid redirect URL: ${headers.location}`));
              return;
            }
            if (redirectUrl.protocol !== 'https:') {
              reject(new Error(`Redirect to non-HTTPS URL rejected: ${headers.location}`));
              return;
            }
            res.resume();
            makeRequest(headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Checksum fetch failed: HTTP ${res.statusCode}`));
            return;
          }
          let data = '';
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => resolve(data));
          res.on('error', reject);
        })
        .on('error', reject);
    }

    makeRequest(url);
  });
}

/**
 * Compute the SHA-256 of `filePath` and compare it against the expected hash
 * found in `checksumContent`. Supports two formats:
 *   - Raw: a single 64-character hex string (e.g. from `<asset>.sha256`)
 *   - GNU coreutils: `<hash>  <filename>` lines (e.g. from `checksums.txt`)
 * Throws if the hash is missing from the file or does not match.
 */
export async function verifyAssetChecksum(
  filePath: string,
  assetName: string,
  checksumContent: string
): Promise<void> {
  const actualHash = await computeFileSha256(filePath);
  const trimmed = checksumContent.trim();

  let expectedHash: string | null = null;

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    // Raw single-hash file
    expectedHash = trimmed.toLowerCase();
  } else {
    // GNU-style checksums.txt: find the line for this asset
    for (const line of trimmed.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[parts.length - 1] === assetName) {
        expectedHash = parts[0].toLowerCase();
        break;
      }
    }
  }

  if (!expectedHash) {
    throw new Error(`No checksum entry found for "${assetName}" in checksum file`);
  }
  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch for "${assetName}": expected ${expectedHash}, got ${actualHash}`
    );
  }
  log.info('Checksum verified', { assetName, sha256: actualHash });
}

// ─── Asset selection ──────────────────────────────────────────────────────────

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

  // Linux — prefer the format that matches the current installation.
  // AppImages set the APPIMAGE env var; .deb installs do not.
  if (process.env.APPIMAGE) {
    return (
      assets.find(a => a.name.endsWith('.AppImage')) ??
      assets.find(a => a.name.endsWith('.deb')) ??
      null
    );
  }
  return (
    assets.find(a => a.name.endsWith('.deb')) ??
    assets.find(a => a.name.endsWith('.AppImage')) ??
    null
  );
}

// ─── Download ─────────────────────────────────────────────────────────────────

/** Download a release asset to the system temp directory, reporting progress. */
export function downloadAsset(
  asset: GitHubAsset,
  onProgress: (progress: DownloadProgress) => void
): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    let destPath: string;
    try {
      destPath = buildSafeDestPath(asset.name);
    } catch (err) {
      reject(err);
      return;
    }

    const writeStream = fs.createWriteStream(destPath);
    let bytesDownloaded = 0;
    const totalBytes = asset.size;

    function makeRequest(url: string): void {
      const parsedUrl = new URL(url);
      const mod = parsedUrl.protocol === 'https:' ? https : http;

      const req = mod.get(url, { headers: { 'User-Agent': 'ember-client' } }, response => {
        const { statusCode, headers } = response;

        if (
          (statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) &&
          headers.location
        ) {
          // Enforce HTTPS-only redirects to prevent TLS-stripping attacks.
          let redirectUrl: URL;
          try {
            redirectUrl = new URL(headers.location);
          } catch {
            writeStream.destroy();
            reject(new Error(`Invalid redirect URL: ${headers.location}`));
            return;
          }
          if (redirectUrl.protocol !== 'https:') {
            writeStream.destroy();
            reject(new Error(`Redirect to non-HTTPS URL rejected: ${headers.location}`));
            return;
          }
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

        writeStream.on('error', err => {
          activeRequest = null;
          reject(err);
        });

        response.on('error', err => {
          activeRequest = null;
          reject(err);
        });
      });

      req.on('error', err => {
        activeRequest = null;
        reject(err);
      });

      activeRequest = req;
    }

    makeRequest(asset.browser_download_url);
  });
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

/** Cancel any active download. */
export function cancelActiveDownload(): void {
  if (activeRequest) {
    activeRequest.destroy();
    activeRequest = null;
    log.info('Download cancelled');
  }
}

// ─── Install ──────────────────────────────────────────────────────────────────

/** Open the downloaded file using the OS default handler (installer, package manager, etc.). */
export async function launchInstaller(filePath: string): Promise<void> {
  validateInstallerPath(filePath);
  log.info('Launching installer', { platform: process.platform });

  if (process.platform === 'linux') {
    try {
      fs.chmodSync(filePath, 0o755);
    } catch {
      log.warn('Failed to set executable permission on installer', { filePath });
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
  validateInstallerPath(filePath);
  installOnExitPath = filePath;
  log.info('Update scheduled for installation on exit');
}

/** Returns the path scheduled for install-on-exit (if any). */
export function getInstallOnExitPath(): string | null {
  return installOnExitPath;
}
