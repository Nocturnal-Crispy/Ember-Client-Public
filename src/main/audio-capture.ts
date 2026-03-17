/**
 * audio-capture.ts — Main-process audio capture orchestration.
 *
 * Owns platform support detection, IPC handler registration, and
 * the lifecycle of per-platform audio capture sessions.
 *
 * Platform dispatch:
 *   win32   → WASAPI application loopback (native N-API addon)
 *   linux   → PipeWire pw_stream capture  (native N-API addon)
 *   linux*  → PulseAudio combined sink    (pactl shell commands)
 *   other   → unsupported
 */

import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import { createLogger } from './logger';

const execFileAsync = promisify(execFile);
const log = createLogger('AudioCapture');

const CAPTURE_SINK = 'ember_screen_capture';

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

/** PulseAudio capture session token. */
export interface PulseToken {
  combineModuleId: string;
  movedInputs: Array<{ id: string; originalSink: string }>;
}

/** Native N-API addon interface (Windows WASAPI or Linux PipeWire). */
interface NativeAddon {
  startCapture(cfg: { pid: number; exclude: boolean }): boolean;
  readFrames(): { pcm: Float32Array; sampleRate: number; channels: number } | null;
  stopCapture(): void;
}

interface PactlSinkInput {
  index: number;
  properties?: Record<string, string>;
  sink?: string;
}

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

// ─── Windows: WASAPI N-API Addon ──────────────────────────────────────────────

let winAddon: NativeAddon | null = null;

function loadWinAddon(): NativeAddon | null {
  try {
    return require(
      path.join(
        __dirname,
        '../../native/windows-audio-capture/build/Release/windows_audio_capture.node'
      )
    ) as NativeAddon;
  } catch (err) {
    log.warn('windows-audio-capture addon load failed', { error: String(err) });
    return null;
  }
}

function startWasapiCapture(
  mainPid: number
): { success: boolean; platform?: string; reason?: string } {
  winAddon = winAddon ?? loadWinAddon();
  if (!winAddon) return { success: false, reason: 'win-addon-unavailable' };
  const ok = winAddon.startCapture({ pid: mainPid, exclude: true });
  if (!ok) return { success: false, reason: 'wasapi-activate-failed' };
  log.info('WASAPI process loopback started', { mainPid });
  return { success: true, platform: 'win32-wasapi' };
}

function readWasapiFrames(): { pcm: Float32Array; sampleRate: number; channels: number } | null {
  return winAddon?.readFrames() ?? null;
}

function stopWasapiCapture(): void {
  if (winAddon) {
    winAddon.stopCapture();
    log.info('WASAPI capture stopped');
  }
}

// ─── Linux: PipeWire N-API Addon ─────────────────────────────────────────────

let linuxAddon: NativeAddon | null = null;

function loadLinuxAddon(): NativeAddon | null {
  try {
    return require(
      path.join(
        __dirname,
        '../../native/linux-audio-capture/build/Release/linux_audio_capture.node'
      )
    ) as NativeAddon;
  } catch (err) {
    log.warn('linux-audio-capture addon load failed', { error: String(err) });
    return null;
  }
}

function startPipeWireCapture(
  mainPid: number
): { success: boolean; platform?: string; reason?: string } {
  linuxAddon = linuxAddon ?? loadLinuxAddon();
  if (!linuxAddon) return { success: false, reason: 'linux-addon-unavailable' };
  const ok = linuxAddon.startCapture({ pid: mainPid, exclude: true });
  if (!ok) return { success: false, reason: 'pw-stream-connect-failed' };
  log.info('PipeWire capture started', { mainPid });
  return { success: true, platform: 'linux-pipewire' };
}

function readLinuxFrames(): { pcm: Float32Array; sampleRate: number; channels: number } | null {
  return linuxAddon?.readFrames() ?? null;
}

// ─── Linux: PulseAudio combined-sink capture ──────────────────────────────────

let pulseToken: PulseToken | null = null;

/**
 * startPulseCaptureWith — testable pure function.
 * Moves all non-Ember sink-inputs to a combined capture sink.
 * Ember's own audio stays on the original sink so the sharer can still hear voice.
 */
export async function startPulseCaptureWith(
  emberPid: number,
  runner: CommandRunner
): Promise<{ success: boolean; platform?: string; reason?: string }> {
  let inputs: PactlSinkInput[];
  try {
    const { stdout } = await runner('pactl', ['--format=json', 'list', 'sink-inputs']);
    inputs = JSON.parse(stdout) as PactlSinkInput[];
  } catch (err) {
    return { success: false, reason: `pactl-list-failed: ${String(err)}` };
  }

  // Only move non-Ember apps
  const others = inputs.filter(
    (i) => Number(i.properties?.['application.process.id']) !== emberPid
  );
  if (others.length === 0) {
    return { success: false, reason: 'no-other-audio-sources' };
  }

  let combineModuleId: string;
  try {
    const { stdout: modStr } = await runner('pactl', [
      'load-module',
      'module-null-sink',
      `sink_name=${CAPTURE_SINK}`,
      'sink_properties=device.description=Ember_Screen_Capture',
    ]);
    combineModuleId = modStr.trim();
  } catch (err) {
    return { success: false, reason: `pactl-load-module-failed: ${String(err)}` };
  }

  const movedInputs: PulseToken['movedInputs'] = [];
  for (const inp of others) {
    try {
      const originalSink = inp.sink ?? 'default';
      await runner('pactl', ['move-sink-input', String(inp.index), CAPTURE_SINK]);
      movedInputs.push({ id: String(inp.index), originalSink });
    } catch { /* skip inputs that fail to move */ }
  }

  pulseToken = { combineModuleId, movedInputs };
  log.info('PulseAudio capture started', { capturedApps: movedInputs.length });
  return { success: true, platform: 'linux-pulseaudio' };
}

/**
 * stopPulseCaptureWith — testable pure function.
 * Restores moved inputs to their original sinks and unloads the capture module.
 */
export async function stopPulseCaptureWith(
  token: PulseToken,
  runner: CommandRunner
): Promise<void> {
  for (const { id, originalSink } of token.movedInputs) {
    await runner('pactl', ['move-sink-input', id, originalSink]).catch(() => {});
  }
  await runner('pactl', ['unload-module', token.combineModuleId]).catch(() => {});
  log.info('PulseAudio capture stopped');
}

async function startPulseCapture(
  mainPid: number
): Promise<{ success: boolean; platform?: string; reason?: string }> {
  return startPulseCaptureWith(mainPid, defaultRunner);
}

async function stopLinuxCapture(): Promise<void> {
  if (linuxAddon) {
    linuxAddon.stopCapture();
    log.info('PipeWire capture stopped');
    linuxAddon = null;
  }
  if (pulseToken) {
    await stopPulseCaptureWith(pulseToken, defaultRunner);
    pulseToken = null;
  }
}

// ─── Startup orphan cleanup ───────────────────────────────────────────────────

/**
 * cleanOrphanedAudioModulesWith — testable pure function.
 * Removes any leftover ember_screen_capture PulseAudio module from a prior crash.
 */
export async function cleanOrphanedAudioModulesWith(
  platform: string,
  runner: CommandRunner
): Promise<void> {
  if (platform !== 'linux') return;
  try {
    const { stdout } = await runner('pactl', ['list', 'modules', 'short']);
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes(CAPTURE_SINK)) {
        const modId = line.trim().split('\t')[0];
        await runner('pactl', ['unload-module', modId]).catch(() => {});
        log.info('Cleaned orphaned audio capture module', { modId });
        break;
      }
    }
  } catch { /* pactl not available — ignore */ }
}

/**
 * cleanOrphanedAudioModules — production entry point.
 * On Linux, removes any leftover capture sink from a prior Ember crash.
 */
export async function cleanOrphanedAudioModules(): Promise<void> {
  await cleanOrphanedAudioModulesWith(process.platform, defaultRunner);
}

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
 * registerBeforeQuitCleanup — registers the before-quit audio cleanup handler.
 * Called once from main process startup.
 */
export function registerBeforeQuitCleanup(app: Electron.App): void {
  app.on('before-quit', () => {
    stopWasapiCapture();
    stopLinuxCapture().catch(() => {});
  });
}
