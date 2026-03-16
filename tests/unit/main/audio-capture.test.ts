/**
 * Unit tests for src/main/audio-capture.ts
 *
 * Tests platform detection via the injectable CommandRunner interface.
 * No child_process mocking needed — the runner is passed as a parameter.
 */

// @jest-environment node

import {
  checkAudioCaptureSupportWith,
  registerAudioCaptureHandlers,
} from '../../../src/main/audio-capture';
import type { CommandRunner } from '../../../src/main/audio-capture';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Runner that succeeds for the listed commands and throws for all others. */
function runnerSucceedsFor(...cmds: string[]): CommandRunner {
  return async (cmd: string) => {
    if (cmds.includes(cmd)) return { stdout: '1', stderr: '' };
    throw new Error(`command not found: ${cmd}`);
  };
}

/** Runner that always throws. */
function runnerAlwaysFails(): CommandRunner {
  return async () => { throw new Error('command not found'); };
}

/** Runner that returns a specific Windows build number for 'reg'. */
function runnerReturnsBuild(build: number): CommandRunner {
  return async (cmd: string) => {
    if (cmd === 'reg') {
      return {
        stdout: `CurrentBuildNumber    REG_SZ    ${build}\n`,
        stderr: '',
      };
    }
    throw new Error(`command not found: ${cmd}`);
  };
}

// ─── Unsupported platform ─────────────────────────────────────────────────────

describe('checkAudioCaptureSupportWith — unsupported platform', () => {
  it('returns supported: false on macOS', async () => {
    const result = await checkAudioCaptureSupportWith('darwin', runnerAlwaysFails());

    expect(result.supported).toBe(false);
    expect(result.platform).toBe('none');
    expect(result.reason).toBe('unsupported-platform');
  });

  it('returns supported: false on unknown platform', async () => {
    const result = await checkAudioCaptureSupportWith('freebsd', runnerAlwaysFails());

    expect(result.supported).toBe(false);
    expect(result.platform).toBe('none');
    expect(result.reason).toBe('unsupported-platform');
  });
});

// ─── Windows ──────────────────────────────────────────────────────────────────

describe('checkAudioCaptureSupportWith — Windows', () => {
  it('returns win32-wasapi when build >= 19041', async () => {
    const result = await checkAudioCaptureSupportWith('win32', runnerReturnsBuild(19041));

    expect(result.supported).toBe(true);
    expect(result.platform).toBe('win32-wasapi');
  });

  it('returns supported: false when build === 19040 (one below threshold)', async () => {
    const result = await checkAudioCaptureSupportWith('win32', runnerReturnsBuild(19040));

    expect(result.supported).toBe(false);
    expect(result.platform).toBe('none');
    expect(result.reason).toContain('19040');
  });

  it('returns supported: false when build < 19041', async () => {
    const result = await checkAudioCaptureSupportWith('win32', runnerReturnsBuild(18362));

    expect(result.supported).toBe(false);
    expect(result.platform).toBe('none');
    expect(result.reason).toContain('18362');
  });

  it('returns supported: false when registry query fails', async () => {
    const result = await checkAudioCaptureSupportWith('win32', runnerAlwaysFails());

    expect(result.supported).toBe(false);
    expect(result.platform).toBe('none');
    expect(result.reason).toBe('registry-query-failed');
  });
});

// ─── Linux — PipeWire ─────────────────────────────────────────────────────────

describe('checkAudioCaptureSupportWith — Linux PipeWire', () => {
  it('returns linux-pipewire when pw-cli is available', async () => {
    const result = await checkAudioCaptureSupportWith(
      'linux',
      runnerSucceedsFor('pw-cli')
    );

    expect(result.supported).toBe(true);
    expect(result.platform).toBe('linux-pipewire');
  });

  it('does not call pactl when pw-cli succeeds', async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async (cmd) => {
      calls.push(cmd);
      if (cmd === 'pw-cli') return { stdout: '1', stderr: '' };
      throw new Error('not found');
    };

    await checkAudioCaptureSupportWith('linux', runner);
    expect(calls).not.toContain('pactl');
  });
});

// ─── Linux — PulseAudio ───────────────────────────────────────────────────────

describe('checkAudioCaptureSupportWith — Linux PulseAudio fallback', () => {
  it('returns linux-pulseaudio when pw-cli is absent but pactl is present', async () => {
    const result = await checkAudioCaptureSupportWith(
      'linux',
      runnerSucceedsFor('pactl')
    );

    expect(result.supported).toBe(true);
    expect(result.platform).toBe('linux-pulseaudio');
  });

  it('returns supported: false when neither pw-cli nor pactl is found', async () => {
    const result = await checkAudioCaptureSupportWith('linux', runnerAlwaysFails());

    expect(result.supported).toBe(false);
    expect(result.platform).toBe('none');
    expect(result.reason).toContain('PipeWire');
  });
});

// ─── registerAudioCaptureHandlers ─────────────────────────────────────────────

describe('registerAudioCaptureHandlers', () => {
  it('does not throw when called with a valid PID', () => {
    // ipcMain.handle is a no-op in the Node test environment
    expect(() => registerAudioCaptureHandlers(12345)).not.toThrow();
  });
});
