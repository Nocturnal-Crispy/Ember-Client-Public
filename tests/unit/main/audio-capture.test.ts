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
  cleanOrphanedAudioModulesWith,
  startPulseCaptureWith,
  stopPulseCaptureWith,
} from '../../../src/main/audio-capture';
import type { CommandRunner, PulseToken } from '../../../src/main/audio-capture';

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
  return async () => {
    throw new Error('command not found');
  };
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
    const result = await checkAudioCaptureSupportWith('linux', runnerSucceedsFor('pw-cli'));

    expect(result.supported).toBe(true);
    expect(result.platform).toBe('linux-pipewire');
  });

  it('does not call pactl when pw-cli succeeds', async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async cmd => {
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
    const result = await checkAudioCaptureSupportWith('linux', runnerSucceedsFor('pactl'));

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

// ─── Phase 9: cleanOrphanedAudioModulesWith ───────────────────────────────────

describe('cleanOrphanedAudioModulesWith', () => {
  it('calls pactl unload-module when ember capture sink is found', async () => {
    const calls: Array<[string, string[]]> = [];
    const runner: CommandRunner = async (cmd, args = []) => {
      calls.push([cmd, args]);
      if (cmd === 'pactl' && args[0] === 'list') {
        return {
          stdout: '42\tmodule-null-sink\tsink_name=ember_screen_capture\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    };

    await cleanOrphanedAudioModulesWith('linux', runner);

    expect(
      calls.some(([c, a]) => c === 'pactl' && a.includes('unload-module') && a.includes('42'))
    ).toBe(true);
  });

  it('does nothing when no ember capture sink is found', async () => {
    const calls: Array<[string, string[]]> = [];
    const runner: CommandRunner = async (cmd, args = []) => {
      calls.push([cmd, args]);
      return { stdout: '1\tmodule-bluetooth-policy\t\n', stderr: '' };
    };

    await cleanOrphanedAudioModulesWith('linux', runner);

    expect(calls.every(([c, a]) => !(c === 'pactl' && a.includes('unload-module')))).toBe(true);
  });

  it('is a no-op on non-linux platforms', async () => {
    const calls: Array<[string, string[]]> = [];
    const runner: CommandRunner = async (cmd, args = []) => {
      calls.push([cmd, args]);
      return { stdout: '', stderr: '' };
    };

    await cleanOrphanedAudioModulesWith('win32', runner);

    expect(calls.length).toBe(0);
  });
});

// ─── Phase 9: startPulseCaptureWith ──────────────────────────────────────────

describe('startPulseCaptureWith', () => {
  const EMBER_PID = 1234;

  /** JSON representing two active sink inputs — one Ember, one Firefox */
  function makeSinkInputsJson(emberPid: number): string {
    return JSON.stringify([
      {
        index: 10,
        properties: { 'application.process.id': String(emberPid) },
        sink: 'alsa_output.default',
      },
      {
        index: 20,
        properties: { 'application.process.id': '9999' },
        sink: 'alsa_output.default',
      },
    ]);
  }

  it('returns success and platform linux-pulseaudio when pactl works', async () => {
    const runner: CommandRunner = async (cmd, args = []) => {
      if (cmd === 'pactl' && args.includes('sink-inputs')) {
        return { stdout: makeSinkInputsJson(EMBER_PID), stderr: '' };
      }
      if (cmd === 'pactl' && args.includes('load-module')) {
        return { stdout: '55\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };

    const result = await startPulseCaptureWith(EMBER_PID, runner);

    expect(result.success).toBe(true);
    expect(result.platform).toBe('linux-pulseaudio');
  });

  it('returns failure when there are no non-Ember audio sources', async () => {
    const emberOnlyJson = JSON.stringify([
      {
        index: 10,
        properties: { 'application.process.id': String(EMBER_PID) },
        sink: 'alsa_output.default',
      },
    ]);
    const runner: CommandRunner = async () => ({ stdout: emberOnlyJson, stderr: '' });

    const result = await startPulseCaptureWith(EMBER_PID, runner);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('no-other-audio-sources');
  });

  it('returns failure when pactl list sink-inputs fails', async () => {
    const runner: CommandRunner = async () => {
      throw new Error('pactl not found');
    };

    const result = await startPulseCaptureWith(EMBER_PID, runner);

    expect(result.success).toBe(false);
  });
});

// ─── Phase 9: stopPulseCaptureWith ───────────────────────────────────────────

describe('stopPulseCaptureWith', () => {
  it('restores moved inputs and unloads module', async () => {
    const calls: Array<[string, string[]]> = [];
    const runner: CommandRunner = async (cmd, args = []) => {
      calls.push([cmd, args]);
      return { stdout: '', stderr: '' };
    };

    const token: PulseToken = {
      combineModuleId: '55',
      movedInputs: [{ id: '20', originalSink: 'alsa_output.default' }],
    };

    await stopPulseCaptureWith(token, runner);

    const moveCalls = calls.filter(([c, a]) => c === 'pactl' && a.includes('move-sink-input'));
    expect(moveCalls.length).toBe(1);
    expect(moveCalls[0][1]).toContain('alsa_output.default');

    const unloadCalls = calls.filter(([c, a]) => c === 'pactl' && a.includes('unload-module'));
    expect(unloadCalls.length).toBe(1);
    expect(unloadCalls[0][1]).toContain('55');
  });
});
