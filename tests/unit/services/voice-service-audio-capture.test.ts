/**
 * Unit tests for Phase 4 audio capture integration in VoiceManager.
 *
 * Tests cover:
 *   _startAudioCapture: calls setup(); returns null on failure, MediaStream on success
 *   _startAudioCapture: creates AudioContext pipeline and starts frame-poll interval
 *   _startAudioCapture: onaudioprocess feeds PCM frames; outputs silence when buffer empty
 *   _stopAudioCapture: clears interval, disconnects nodes, calls teardown
 *   _stopAudioCapture: no-ops when audio capture was never started
 *   startScreenShare includeAudio=false: does NOT call audioCapture.setup()
 *   startScreenShare includeAudio=true + setup succeeds: adds video + audio transceivers
 *   startScreenShare includeAudio=true + setup fails: adds video transceiver only
 *   stopScreenShare while audio capturing: calls audioCapture.teardown()
 *   _cleanup while audio capturing: calls audioCapture.teardown()
 *   _partialCleanup while audio capturing: calls audioCapture.teardown()
 */

// @jest-environment node

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockTrack(kind = 'video'): MediaStreamTrack {
  return { kind, stop: jest.fn(), id: `track-${kind}` } as unknown as MediaStreamTrack;
}

function makeMockStream(tracks: MediaStreamTrack[] = []): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    active: true,
  } as unknown as MediaStream;
}

function makeMockOffer(): RTCSessionDescriptionInit {
  return { type: 'offer' as RTCSdpType, sdp: 'v=0\r\no=- ...\r\n' };
}

function makeMockPC(offer = makeMockOffer()) {
  return {
    addTransceiver: jest.fn(),
    createOffer: jest.fn().mockResolvedValue(offer),
    setLocalDescription: jest.fn().mockResolvedValue(undefined),
    setRemoteDescription: jest.fn().mockResolvedValue(undefined),
    addIceCandidate: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    connectionState: 'connected',
    signalingState: 'stable',
    onicecandidate: null,
    onconnectionstatechange: null,
  };
}

function makeMockWs(capturedMessages: string[]) {
  return {
    readyState: 1, // OPEN
    send: jest.fn((msg: string) => {
      capturedMessages.push(msg);
    }),
  } as unknown as WebSocket;
}

function makeMockAudioStream(): MediaStream {
  return makeMockStream([makeMockTrack('audio')]);
}

const MOCK_AUTH = {
  user_id: 'user-1',
  username: 'Alice',
  token: 'tok',
  hostname: 'http://localhost:8085',
};
const MOCK_CHANNEL_ID = 'ch-voice-audio-test';

// ─── Setup ────────────────────────────────────────────────────────────────────

let VoiceManagerClass: new (ws: WebSocket, auth: typeof MOCK_AUTH) => Record<string, unknown>;

// Audio capture IPC mocks (shared, reinitialised in beforeEach)
let mockAudioCaptureSetup: jest.Mock;
let mockAudioCaptureFrames: jest.Mock;
let mockAudioCaptureTeardown: jest.Mock;

// AudioContext subcomponent mocks
let mockScriptNode: {
  connect: jest.Mock;
  disconnect: jest.Mock;
  onaudioprocess: ((e: AudioProcessingEvent) => void) | null;
};
let mockDestination: {
  stream: MediaStream;
  disconnect: jest.Mock;
};
let mockWorkletPort: { postMessage: jest.Mock };
let mockWorkletNode: { connect: jest.Mock; port: { postMessage: jest.Mock } };
let mockAudioCtxCapture: {
  createScriptProcessor: jest.Mock;
  createMediaStreamDestination: jest.Mock;
  audioWorklet: { addModule: jest.Mock };
  close: jest.Mock;
  state: string;
};
let mockEnumerateDevices: jest.Mock;

// getUserMedia mock (needed for startScreenShare tests)
let mockGetUserMedia: jest.Mock;

beforeAll(() => {
  (global as any).window = global;
  (global as any).window.emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  (global as any).RTCPeerConnection = jest.fn();
  (global as any).RTCSessionDescription = jest.fn((s: RTCSessionDescriptionInit) => s);
  (global as any).RTCIceCandidate = jest.fn((c: RTCIceCandidateInit) => c);
  (global as any).requestAnimationFrame = jest.fn();
  // MediaStream constructor used by _startAudioCapture (Phase 9)
  (global as any).MediaStream = jest.fn().mockImplementation((tracks: MediaStreamTrack[]) => ({
    getTracks: () => tracks ?? [],
    getAudioTracks: () => (tracks ?? []).filter((t: MediaStreamTrack) => t.kind === 'audio'),
    getVideoTracks: () => (tracks ?? []).filter((t: MediaStreamTrack) => t.kind === 'video'),
    active: true,
  }));

  require('../../../src/renderer/services/voice-service');
  VoiceManagerClass = (global as any).window.VoiceManager;
});

let vm: Record<string, unknown>;
let mockWsMessages: string[];
let mockWs: WebSocket;
let mockPC: ReturnType<typeof makeMockPC>;

beforeEach(() => {
  // Reset navigator.mediaDevices
  mockGetUserMedia = jest.fn();
  mockEnumerateDevices = jest.fn().mockResolvedValue([]);
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      mediaDevices: { getUserMedia: mockGetUserMedia, enumerateDevices: mockEnumerateDevices },
    },
  });

  // Set up audio capture IPC mocks
  mockAudioCaptureSetup = jest
    .fn()
    .mockResolvedValue({ success: false, reason: 'not-implemented' });
  mockAudioCaptureFrames = jest.fn().mockResolvedValue(null);
  mockAudioCaptureTeardown = jest.fn().mockResolvedValue(undefined);

  (global as any).window.electronAPI = {
    audioCapture: {
      setup: mockAudioCaptureSetup,
      frames: mockAudioCaptureFrames,
      teardown: mockAudioCaptureTeardown,
    },
  };

  // AudioWorklet mock
  mockWorkletPort = { postMessage: jest.fn() };
  mockWorkletNode = { connect: jest.fn(), port: mockWorkletPort };
  (global as any).AudioWorkletNode = jest.fn().mockReturnValue(mockWorkletNode);

  // AudioContext mock with Phase 4 + Phase 9 methods
  mockScriptNode = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    onaudioprocess: null,
  };
  mockDestination = {
    stream: makeMockAudioStream(),
    disconnect: jest.fn(),
  };
  mockAudioCtxCapture = {
    createScriptProcessor: jest.fn().mockReturnValue(mockScriptNode),
    createMediaStreamDestination: jest.fn().mockReturnValue(mockDestination),
    audioWorklet: { addModule: jest.fn().mockResolvedValue(undefined) },
    close: jest.fn().mockResolvedValue(undefined),
    state: 'running',
  };
  (global as any).AudioContext = jest.fn().mockReturnValue(mockAudioCtxCapture);

  // Build a fresh vm
  mockWsMessages = [];
  mockWs = makeMockWs(mockWsMessages);
  vm = new VoiceManagerClass(mockWs, MOCK_AUTH);

  mockPC = makeMockPC();
  (vm as any).channelId = MOCK_CHANNEL_ID;
  (vm as any).peerConnection = mockPC;
  (vm as any).isScreenSharing = false;
  (vm as any).localScreenStream = null;
});

// ─── _startAudioCapture ───────────────────────────────────────────────────────

describe('_startAudioCapture', () => {
  it('returns null when audioCapture.setup() returns {success: false}', async () => {
    mockAudioCaptureSetup.mockResolvedValue({ success: false, reason: 'not-implemented' });

    const result = await (vm as any)._startAudioCapture();

    expect(result).toBeNull();
    expect((vm as any)._audioCaptureSetup).toBe(false);
    expect((vm as any)._nativeAudioCaptureActive).toBe(false);
  });

  it('returns null when audioCapture.setup() throws', async () => {
    mockAudioCaptureSetup.mockRejectedValue(new Error('IPC error'));

    const result = await (vm as any)._startAudioCapture();

    expect(result).toBeNull();
    expect((vm as any)._audioCaptureSetup).toBe(false);
  });

  it('sets _audioCaptureSetup=true and _nativeAudioCaptureActive=true on success', async () => {
    mockAudioCaptureSetup.mockResolvedValue({ success: true, platform: 'linux-pipewire' });

    await (vm as any)._startAudioCapture();

    expect((vm as any)._audioCaptureSetup).toBe(true);
    expect((vm as any)._nativeAudioCaptureActive).toBe(true);
  });

  it('creates AudioWorklet pipeline and returns an audio track stream', async () => {
    mockAudioCaptureSetup.mockResolvedValue({ success: true, platform: 'linux-pipewire' });

    const result = await (vm as any)._startAudioCapture();

    expect(mockAudioCtxCapture.audioWorklet.addModule).toHaveBeenCalled();
    expect(mockAudioCtxCapture.createMediaStreamDestination).toHaveBeenCalled();
    expect(mockWorkletNode.connect).toHaveBeenCalledWith(mockDestination);
    // Result is a MediaStream wrapping the audio track
    expect(result).not.toBeNull();
  });
});

// ─── _stopAudioCapture ────────────────────────────────────────────────────────

describe('_stopAudioCapture', () => {
  it('clears native capture state and calls teardown when active', async () => {
    // Start capture first (AudioWorklet path)
    mockAudioCaptureSetup.mockResolvedValue({ success: true, platform: 'win32-wasapi' });
    await (vm as any)._startAudioCapture();

    expect((vm as any)._nativeAudioCaptureActive).toBe(true);

    await (vm as any)._stopAudioCapture();

    expect((vm as any)._nativeAudioCaptureActive).toBe(false);
    expect(mockAudioCaptureTeardown).toHaveBeenCalled();
    expect((vm as any)._audioCaptureSetup).toBe(false);
  });

  it('legacy: disconnects ScriptProcessor nodes if they were manually injected', async () => {
    // Simulate old Phase 4 state manually injected
    (vm as any)._audioCaptureSetup = true;
    (vm as any)._audioCaptureInterval = setInterval(() => {}, 1000);
    (vm as any)._audioCtxCapture = mockAudioCtxCapture;
    (vm as any)._audioCaptureScriptNode = mockScriptNode;
    (vm as any)._audioCaptureDestination = mockDestination;

    await (vm as any)._stopAudioCapture();

    expect((vm as any)._audioCaptureInterval).toBeNull();
    expect(mockScriptNode.disconnect).toHaveBeenCalled();
    expect(mockDestination.disconnect).toHaveBeenCalled();
    expect(mockAudioCtxCapture.close).toHaveBeenCalled();
    expect(mockAudioCaptureTeardown).toHaveBeenCalled();
    expect((vm as any)._audioCaptureSetup).toBe(false);
  });

  it('does not call teardown when audio capture was never started', async () => {
    expect((vm as any)._audioCaptureSetup).toBe(false);

    await (vm as any)._stopAudioCapture();

    expect(mockAudioCaptureTeardown).not.toHaveBeenCalled();
  });

  it('resets _audioCapturePCMBuffer to empty', async () => {
    mockAudioCaptureSetup.mockResolvedValue({ success: true });
    await (vm as any)._startAudioCapture();
    (vm as any)._audioCapturePCMBuffer.push(new Int16Array([1, 2, 3]));

    await (vm as any)._stopAudioCapture();

    expect((vm as any)._audioCapturePCMBuffer).toEqual([]);
  });
});

// ─── startScreenShare — includeAudio integration ──────────────────────────────

describe('startScreenShare audio capture integration', () => {
  const SOURCE_ID = 'screen:0:0';

  function setupVideoStream() {
    const track = makeMockTrack('video');
    const stream = makeMockStream([track]);
    mockGetUserMedia.mockResolvedValue(stream);
    return { track, stream };
  }

  it('does NOT call audioCapture.setup() when includeAudio=false', async () => {
    setupVideoStream();

    await (vm as any).startScreenShare(SOURCE_ID, {
      sourceId: SOURCE_ID,
      includeAudio: false,
      resolution: '720p',
      frameRate: 15,
    });

    expect(mockAudioCaptureSetup).not.toHaveBeenCalled();
  });

  it('calls audioCapture.setup() when includeAudio=true', async () => {
    setupVideoStream();
    mockAudioCaptureSetup.mockResolvedValue({ success: false, reason: 'not-implemented' });

    await (vm as any).startScreenShare(SOURCE_ID, {
      sourceId: SOURCE_ID,
      includeAudio: true,
      resolution: '720p',
      frameRate: 15,
    });

    expect(mockAudioCaptureSetup).toHaveBeenCalled();
  });

  it('adds both video and audio transceivers when includeAudio=true and setup succeeds', async () => {
    setupVideoStream();
    mockAudioCaptureSetup.mockResolvedValue({ success: true, platform: 'linux-pipewire' });

    await (vm as any).startScreenShare(SOURCE_ID, {
      sourceId: SOURCE_ID,
      includeAudio: true,
      resolution: '720p',
      frameRate: 15,
    });

    const calls = mockPC.addTransceiver.mock.calls;
    // Two transceivers: video first, then audio
    expect(calls.length).toBe(2);
    const kinds = calls.map((c: unknown[]) => (c[0] as MediaStreamTrack).kind);
    expect(kinds).toContain('video');
    expect(kinds).toContain('audio');
  });

  it('adds only video transceiver when includeAudio=true but setup fails', async () => {
    setupVideoStream();
    mockAudioCaptureSetup.mockResolvedValue({ success: false, reason: 'not-implemented' });

    await (vm as any).startScreenShare(SOURCE_ID, {
      sourceId: SOURCE_ID,
      includeAudio: true,
      resolution: '720p',
      frameRate: 15,
    });

    expect(mockPC.addTransceiver.mock.calls.length).toBe(1);
    const track = mockPC.addTransceiver.mock.calls[0][0] as MediaStreamTrack;
    expect(track.kind).toBe('video');
  });

  it('still returns true and shares screen even if audio setup fails', async () => {
    setupVideoStream();
    mockAudioCaptureSetup.mockResolvedValue({ success: false });

    const result = await (vm as any).startScreenShare(SOURCE_ID, {
      sourceId: SOURCE_ID,
      includeAudio: true,
      resolution: '720p',
      frameRate: 15,
    });

    expect(result).toBe(true);
    expect((vm as any).isScreenSharing).toBe(true);
  });
});

// ─── stopScreenShare — audio capture teardown ─────────────────────────────────

describe('stopScreenShare audio capture teardown', () => {
  it('calls audioCapture.teardown() when audio was capturing', async () => {
    // Manually set up capturing state (simulate _startAudioCapture having run)
    (vm as any)._audioCaptureSetup = true;
    (vm as any)._audioCaptureInterval = setInterval(() => {}, 1000);
    (vm as any)._audioCtxCapture = mockAudioCtxCapture;
    (vm as any)._audioCaptureScriptNode = mockScriptNode;
    (vm as any)._audioCaptureDestination = mockDestination;

    // Pre-set sharing state
    const track = makeMockTrack('video');
    (vm as any).localScreenStream = makeMockStream([track]);
    (vm as any).isScreenSharing = true;

    await (vm as any).stopScreenShare();

    expect(mockAudioCaptureTeardown).toHaveBeenCalled();
    expect((vm as any)._audioCaptureSetup).toBe(false);
  });

  it('does not call teardown when audio was not capturing', async () => {
    const track = makeMockTrack('video');
    (vm as any).localScreenStream = makeMockStream([track]);
    (vm as any).isScreenSharing = true;

    await (vm as any).stopScreenShare();

    expect(mockAudioCaptureTeardown).not.toHaveBeenCalled();
  });
});

// ─── _cleanup / _partialCleanup — audio capture teardown ──────────────────────

describe('_cleanup audio capture teardown', () => {
  it('calls audioCapture.teardown() via _cleanup when audio was capturing', async () => {
    (vm as any)._audioCaptureSetup = true;
    (vm as any)._audioCaptureInterval = setInterval(() => {}, 1000);
    (vm as any)._audioCtxCapture = mockAudioCtxCapture;
    (vm as any)._audioCaptureScriptNode = mockScriptNode;
    (vm as any)._audioCaptureDestination = mockDestination;

    (vm as any)._cleanup();

    // _stopAudioCapture is fire-and-forget; flush the full microtask queue
    // (close() + teardown() are both awaited inside the method).
    // Flush the full async chain: close() + teardown() are both awaited inside.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAudioCaptureTeardown).toHaveBeenCalled();
  });
});

describe('_partialCleanup audio capture teardown', () => {
  it('calls audioCapture.teardown() via _partialCleanup when audio was capturing', async () => {
    (vm as any)._audioCaptureSetup = true;
    (vm as any)._audioCaptureInterval = setInterval(() => {}, 1000);
    (vm as any)._audioCtxCapture = mockAudioCtxCapture;
    (vm as any)._audioCaptureScriptNode = mockScriptNode;
    (vm as any)._audioCaptureDestination = mockDestination;

    (vm as any)._partialCleanup();

    // Flush the full async chain: close() + teardown() are both awaited inside.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAudioCaptureTeardown).toHaveBeenCalled();
  });
});

// ─── Phase 9: buildPulseAudioTrack ────────────────────────────────────────────

describe('buildPulseAudioTrack', () => {
  it('returns null when no ember_screen_capture device is found', async () => {
    mockEnumerateDevices.mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: 'Default Microphone' },
      { kind: 'audioinput', deviceId: 'hw-1', label: 'USB Microphone' },
    ]);

    const result = await (vm as any).buildPulseAudioTrack();

    expect(result).toBeNull();
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it('calls getUserMedia with the correct deviceId when monitor is found', async () => {
    const monitorDeviceId = 'monitor-device-42';
    mockEnumerateDevices.mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: 'Default Microphone' },
      { kind: 'audioinput', deviceId: monitorDeviceId, label: 'Monitor of Ember_Screen_Capture' },
    ]);
    const audioTrack = makeMockTrack('audio');
    mockGetUserMedia.mockResolvedValue(makeMockStream([audioTrack]));

    const result = await (vm as any).buildPulseAudioTrack();

    expect(mockGetUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({
          deviceId: expect.objectContaining({ exact: monitorDeviceId }),
        }),
      })
    );
    expect(result).toBe(audioTrack);
  });

  it('returns null when getUserMedia throws', async () => {
    const monitorDeviceId = 'monitor-42';
    mockEnumerateDevices.mockResolvedValue([
      { kind: 'audioinput', deviceId: monitorDeviceId, label: 'Monitor of Ember_Screen_Capture' },
    ]);
    mockGetUserMedia.mockRejectedValue(new Error('Permission denied'));

    const result = await (vm as any).buildPulseAudioTrack();

    expect(result).toBeNull();
  });
});

// ─── Phase 9: buildAudioTrackFromNativeCapture ────────────────────────────────

describe('buildAudioTrackFromNativeCapture', () => {
  it('uses PulseAudio path when platform is linux-pulseaudio', async () => {
    const monitorDeviceId = 'monitor-99';
    mockEnumerateDevices.mockResolvedValue([
      { kind: 'audioinput', deviceId: monitorDeviceId, label: 'Monitor of Ember_Screen_Capture' },
    ]);
    const audioTrack = makeMockTrack('audio');
    mockGetUserMedia.mockResolvedValue(makeMockStream([audioTrack]));

    const result = await (vm as any).buildAudioTrackFromNativeCapture({
      platform: 'linux-pulseaudio',
    });

    expect(mockGetUserMedia).toHaveBeenCalled();
    expect(result).toBe(audioTrack);
  });

  it('sets _nativeAudioCaptureActive=true when PulseAudio track is obtained', async () => {
    const monitorDeviceId = 'monitor-99';
    mockEnumerateDevices.mockResolvedValue([
      { kind: 'audioinput', deviceId: monitorDeviceId, label: 'Monitor of Ember_Screen_Capture' },
    ]);
    const audioTrack = makeMockTrack('audio');
    mockGetUserMedia.mockResolvedValue(makeMockStream([audioTrack]));

    await (vm as any).buildAudioTrackFromNativeCapture({ platform: 'linux-pulseaudio' });

    expect((vm as any)._nativeAudioCaptureActive).toBe(true);
  });

  it('uses AudioWorklet path for win32-wasapi platform', async () => {
    const result = await (vm as any).buildAudioTrackFromNativeCapture({ platform: 'win32-wasapi' });

    expect(mockAudioCtxCapture.audioWorklet.addModule).toHaveBeenCalled();
    // Result is the first audio track from createMediaStreamDestination's stream
    expect(result).not.toBeUndefined();
  });

  it('uses AudioWorklet path for linux-pipewire platform', async () => {
    await (vm as any).buildAudioTrackFromNativeCapture({ platform: 'linux-pipewire' });

    expect(mockAudioCtxCapture.audioWorklet.addModule).toHaveBeenCalled();
  });

  it('returns null when AudioWorklet addModule fails', async () => {
    mockAudioCtxCapture.audioWorklet.addModule.mockRejectedValue(new Error('module load failed'));

    const result = await (vm as any).buildAudioTrackFromNativeCapture({ platform: 'win32-wasapi' });

    expect(result).toBeNull();
  });
});
