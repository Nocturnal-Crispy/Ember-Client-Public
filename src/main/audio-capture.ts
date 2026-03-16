/**
 * audio-capture.ts — Main-process audio capture orchestration.
 *
 * Owns platform support detection, IPC handler registration, and
 * the lifecycle of per-platform audio capture sessions.
 *
 * Platform dispatch:
 *   win32   → WASAPI application loopback (native N-API addon, Phase 9)
 *   linux   → PipeWire pw_stream capture  (native N-API addon, Phase 9)
 *   linux*  → PulseAudio combined sink    (pactl shell commands, Phase 9)
 *   other   → unsupported
 *
 * Phase 2 note: startXxxCapture / readXxxFrames / stopXxxCapture are stubs
 * returning { success: false, reason: 'not-implemented' }. They will be
 * replaced by native addon calls in Phase 9.
 */

import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from './logger';

const execFileAsync = promisify(execFile);
const log = createLogger('AudioCapture');

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AudioCaptureSupport {
  supported: boolean;
  platform: 'win32-wasapi' | 'linux-pipewire' | 'linux-pulseaudio' | 'none';
  reason?: string;
}

/** Injectable command runner — used for platform probing and in unit tests. */
export type CommandRunner = (
  cmd: string,
  args?: string[]
) => Promise<{ stdout: string; stderr: string }>;

// ─── Default command runner (wraps execFile) ──────────────────────────────────

const defaultRunner: CommandRunner = async (cmd, args = []) => {
  const result = await execFileAsync(cmd, args);
  return { stdout: result.stdout, stderr: result.stderr };
};

// ─── Support detection ────────────────────────────────────────────────────────

/** Cached at first call — platform support does not change during a session. */
let cachedSupport: AudioCaptureSupport | null = null;

/**
 * checkAudioCaptureSupportWith — pure, testable version of the support check.
 * Accepts an explicit platform string and command runner so tests can exercise
 * every branch without mocking Node built-ins.
 */
export async function checkAudioCaptureSupportWith(
  platform: string,
  runner: CommandRunner
): Promise<AudioCaptureSupport> {
  if (platform === 'win32') {
    try {
      const { stdout } = await runner('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion',
        '/v',
        'CurrentBuildNumber',
      ]);
      const m = stdout.match(/CurrentBuildNumber\s+REG_SZ\s+(\d+)/);
      const build = m ? parseInt(m[1], 10) : 0;
      if (build >= 19041) {
        return { supported: true, platform: 'win32-wasapi' };
      }
      return {
        supported: false,
        platform: 'none',
        reason: `Windows build ${build} is too old. Version 2004 (build 19041) or later required.`,
      };
    } catch {
      return { supported: false, platform: 'none', reason: 'registry-query-failed' };
    }
  }

  if (platform === 'linux') {
    try {
      await runner('pw-cli', ['--version']);
      return { supported: true, platform: 'linux-pipewire' };
    } catch { /* fall through */ }

    try {
      await runner('pactl', ['--version']);
      return { supported: true, platform: 'linux-pulseaudio' };
    } catch { /* fall through */ }

    return {
      supported: false,
      platform: 'none',
      reason: 'Neither PipeWire nor PulseAudio was found.',
    };
  }

  return { supported: false, platform: 'none', reason: 'unsupported-platform' };
}

/**
 * checkAudioCaptureSupport — production entry point.
 * Uses the real platform and real command runner; result is cached.
 */
export async function checkAudioCaptureSupport(): Promise<AudioCaptureSupport> {
  if (cachedSupport) return cachedSupport;
  cachedSupport = await checkAudioCaptureSupportWith(process.platform, defaultRunner);
  return cachedSupport;
}

// ─── Capture stubs (Phase 9 will replace these with native addon calls) ───────

async function startWasapiCapture(
  _mainPid: number
): Promise<{ success: boolean; platform?: string; reason?: string }> {
  log.warn('WASAPI capture not yet implemented (Phase 9)');
  return { success: false, reason: 'not-implemented' };
}

async function startPipeWireCapture(
  _mainPid: number
): Promise<{ success: boolean; platform?: string; reason?: string }> {
  log.warn('PipeWire capture not yet implemented (Phase 9)');
  return { success: false, reason: 'not-implemented' };
}

async function startPulseCapture(
  _mainPid: number
): Promise<{ success: boolean; platform?: string; reason?: string }> {
  log.warn('PulseAudio capture not yet implemented (Phase 9)');
  return { success: false, reason: 'not-implemented' };
}

function readWasapiFrames(): null {
  return null;
}

function readLinuxFrames(): null {
  return null;
}

function stopWasapiCapture(): void { /* Phase 9 */ }

async function stopLinuxCapture(): Promise<void> { /* Phase 9 */ }

// ─── IPC handler registration ─────────────────────────────────────────────────

export function registerAudioCaptureHandlers(mainPid: number): void {
  ipcMain.handle('audio-capture-check-support', () => checkAudioCaptureSupport());

  ipcMain.handle('audio-capture-setup', async () => {
    const support = await checkAudioCaptureSupport();
    if (!support.supported) return { success: false, reason: support.reason };

    if (support.platform === 'win32-wasapi') return startWasapiCapture(mainPid);
    if (support.platform === 'linux-pipewire') return startPipeWireCapture(mainPid);
    if (support.platform === 'linux-pulseaudio') return startPulseCapture(mainPid);
    return { success: false, reason: 'no-supported-platform' };
  });

  ipcMain.handle('audio-capture-frames', () => {
    if (process.platform === 'win32') return readWasapiFrames();
    if (process.platform === 'linux') return readLinuxFrames();
    return null;
  });

  ipcMain.handle('audio-capture-teardown', async () => {
    if (process.platform === 'win32') stopWasapiCapture();
    if (process.platform === 'linux') await stopLinuxCapture();
  });

  log.info('Audio capture IPC handlers registered', { mainPid });
}

/**
 * cleanOrphanedAudioModules — Linux crash recovery.
 * On Linux, a previous Ember process may have left a combined PulseAudio sink
 * behind. This function removes it so a fresh capture session can be created.
 * Phase 9 will implement the actual pactl cleanup; this is a no-op stub.
 */
export async function cleanOrphanedAudioModules(): Promise<void> {
  if (process.platform !== 'linux') return;
  // Phase 9: pactl unload-module ember-capture-sink (if loaded)
}
