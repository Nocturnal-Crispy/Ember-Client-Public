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
  return { kind, stop: jest.fn(), id: 'track-' + kind } as unknown as MediaStreamTrack;
}

function makeMockStream(tracks: MediaStreamTrack[] = []): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
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
    send: jest.fn((msg: string) => { capturedMessages.push(msg); }),
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
let mockAudioCtxCapture: {
  createScriptProcessor: jest.Mock;
  createMediaStreamDestination: jest.Mock;
  close: jest.Mock;
  state: string;
};

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
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    writable: true,
    value: { mediaDevices: { getUserMedia: mockGetUserMedia } },
  });

  // Set up audio capture IPC mocks
  mockAudioCaptureSetup = jest.fn().mockResolvedValue({ success: false, reason: 'not-implemented' });
  mockAudioCaptureFrames = jest.fn().mockResolvedValue(null);
  mockAudioCaptureTeardown = jest.fn().mockResolvedValue(undefined);

  (global as any).window.electronAPI = {
    audioCapture: {
      setup: mockAudioCaptureSetup,
      frames: mockAudioCaptureFrames,
      teardown: mockAudioCaptureTeardown,
    },
  };

  // AudioContext mock with Phase 4 methods
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
    expect((vm as any)._audioCaptureInterval).toBeNull();
  });

  it('returns null when audioCapture.setup() throws', async () => {
    mockAudioCaptureSetup.mockRejectedValue(new Error('IPC error'));

    const result = await (vm as any)._startAudioCapture();

    expect(result).toBeNull();
    expect((vm as any)._audioCaptureSetup).toBe(false);
  });

  it('sets _audioCaptureSetup=true and starts interval on success', async () => {
    mockAudioCaptureSetup.mockResolvedValue({ success: true, platform: 'linux-pipewire' });

    await (vm as any)._startAudioCapture();

    expect((vm as any)._audioCaptureSetup).toBe(true);
    expect((vm as any)._audioCaptureInterval).not.toBeNull();
  });

  it('creates AudioContext pipeline and returns the destination stream', async () => {
    mockAudioCaptureSetup.mockResolvedValue({ success: true, platform: 'linux-pipewire' });

    const result = await (vm as any)._startAudioCapture();

    expect(mockAudioCtxCapture.createScriptProcessor).toHaveBeenCalled();
    expect(mockAudioCtxCapture.createMediaStreamDestination).toHaveBeenCalled();
    expect(mockScriptNode.connect).toHaveBeenCalledWith(mockDestination);
    expect(result).toBe(mockDestination.stream);
  });

  it('onaudioprocess fills output buffer from queued PCM frame', async () => {
    mockAudioCaptureSetup.mockResolvedValue({ success: true });

    await (vm as any)._startAudioCapture();

    // Enqueue a PCM frame (Int16: value 16384 → float32: 0.5)
    const pcmFrame = new Int16Array([16384, -16384, 0]);
    (vm as any)._audioCapturePCMBuffer.push(pcmFrame);

    const outData = new Float32Array(3);
    const mockEvent = {
      outputBuffer: { getChannelData: jest.fn().mockReturnValue(outData) },
    } as unknown as AudioProcessingEvent;

    mockScriptNode.onaudioprocess!(mockEvent);

    expect(outData[0]).toBeCloseTo(0.5, 3);
    expect(outData[1]).toBeCloseTo(-0.5, 3);
    expect(outData[2]).toBeCloseTo(0, 5);
    // Frame was consumed
    expect((vm as any)._audioCapturePCMBuffer.length).toBe(0);
  });

  it('onaudioprocess outputs silence when PCM buffer is empty', async () => {
    mockAudioCaptureSetup.mockResolvedValue({ success: true });

    await (vm as any)._startAudioCapture();

    const outData = new Float32Array(4); // all zeros by default
    const mockEvent = {
      outputBuffer: { getChannelData: jest.fn().mockReturnValue(outData) },
    } as unknown as AudioProcessingEvent;

    // No frames queued
    mockScriptNode.onaudioprocess!(mockEvent);

    // Output should remain all zeros
    expect(Array.from(outData)).toEqual([0, 0, 0, 0]);
  });
});

// ─── _stopAudioCapture ────────────────────────────────────────────────────────

describe('_stopAudioCapture', () => {
  it('clears interval, disconnects nodes, and calls teardown when active', async () => {
    // Start capture first
    mockAudioCaptureSetup.mockResolvedValue({ success: true });
    await (vm as any)._startAudioCapture();

    expect((vm as any)._audioCaptureInterval).not.toBeNull();

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
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

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
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(mockAudioCaptureTeardown).toHaveBeenCalled();
  });
});
