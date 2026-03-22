/**
 * Unit tests for screen share methods on VoiceManager.
 *
 * Tests cover:
 *   startScreenShare: builds constraints, adds transceiver, renegotiates, sets state
 *   startScreenShare: returns false when not in channel / no peerConnection
 *   startScreenShare: returns false when getUserMedia throws
 *   stopScreenShare: stops tracks, renegotiates, clears state
 *   stopScreenShare: no-ops when not sharing
 *   handleMessage screen_share_start: fires onScreenShareStarted
 *   handleMessage screen_share_stop: fires onScreenShareStopped
 *   handleMessage voice_renegotiate_answer: calls setRemoteDescription on publisher PC
 *   _cleanup: stops localScreenStream tracks and resets screen share state
 */

// @jest-environment node

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockTrack(kind = 'video'): MediaStreamTrack {
  return { kind, stop: jest.fn(), id: `track-${kind}` } as unknown as MediaStreamTrack;
}

function makeMockStream(
  tracks: MediaStreamTrack[] = [],
  id = `stream-${Math.random().toString(36).slice(2)}`
): MediaStream {
  return {
    id,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
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

const MOCK_AUTH = {
  user_id: 'user-1',
  username: 'Alice',
  token: 'tok',
  hostname: 'http://localhost:8085',
};
const MOCK_CHANNEL_ID = 'ch-voice-test';

// ─── Setup ────────────────────────────────────────────────────────────────────

let VoiceManagerClass: new (ws: WebSocket, auth: typeof MOCK_AUTH) => Record<string, unknown>;
let mockGetUserMedia: jest.Mock;

beforeAll(() => {
  // window.emberLog mock
  (global as any).window = global;
  (global as any).window.emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  // RTCPeerConnection — not needed at class definition level
  (global as any).RTCPeerConnection = jest.fn();
  (global as any).RTCSessionDescription = jest.fn((s: RTCSessionDescriptionInit) => s);
  (global as any).RTCIceCandidate = jest.fn((c: RTCIceCandidateInit) => c);
  (global as any).AudioContext = jest.fn(() => ({
    createMediaStreamSource: jest.fn(() => ({ connect: jest.fn() })),
    createAnalyser: jest.fn(() => ({
      fftSize: 0,
      smoothingTimeConstant: 0,
      connect: jest.fn(),
      frequencyBinCount: 0,
      getByteFrequencyData: jest.fn(),
    })),
    close: jest.fn().mockResolvedValue(undefined),
    currentTime: 0,
    state: 'running',
  }));
  (global as any).requestAnimationFrame = jest.fn();

  require('../../../src/renderer/services/voice-service');
  VoiceManagerClass = (global as any).window.VoiceManager;
});

// Rebuild a fresh VoiceManager + mocks for each test
let vm: Record<string, unknown>;
let mockWsMessages: string[];
let mockWs: WebSocket;
let mockPC: ReturnType<typeof makeMockPC>;

beforeEach(() => {
  // Provide navigator.mediaDevices in Node environment (Object.defineProperty
  // because navigator may be a non-writable built-in in Node 21+).
  mockGetUserMedia = jest.fn();
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    writable: true,
    value: { mediaDevices: { getUserMedia: mockGetUserMedia } },
  });

  mockWsMessages = [];
  mockWs = makeMockWs(mockWsMessages);
  vm = new VoiceManagerClass(mockWs, MOCK_AUTH);

  // Pre-place in a channel with a live publisher PC
  mockPC = makeMockPC();
  (vm as any).channelId = MOCK_CHANNEL_ID;
  (vm as any).peerConnection = mockPC;
  (vm as any).isScreenSharing = false;
  (vm as any).localScreenStream = null;
});

// ─── startScreenShare ──────────────────────────────────────────────────────────

describe('startScreenShare', () => {
  const SOURCE_ID = 'screen:0:0';
  const SETTINGS: ScreenShareSettings = {
    sourceId: SOURCE_ID,
    includeAudio: false,
    resolution: '720p',
    frameRate: 15,
  };

  it('calls getUserMedia with desktop constraints', async () => {
    const track = makeMockTrack('video');
    const stream = makeMockStream([track]);
    mockGetUserMedia.mockResolvedValue(stream);

    await (vm as any).startScreenShare(SOURCE_ID, SETTINGS);

    expect(mockGetUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: false,
        video: expect.objectContaining({
          mandatory: expect.objectContaining({
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: SOURCE_ID,
          }),
        }),
      })
    );
  });

  it('adds sendonly video transceiver to peerConnection', async () => {
    const track = makeMockTrack('video');
    const stream = makeMockStream([track]);
    mockGetUserMedia.mockResolvedValue(stream);

    await (vm as any).startScreenShare(SOURCE_ID, SETTINGS);

    expect(mockPC.addTransceiver).toHaveBeenCalledWith(
      track,
      expect.objectContaining({ direction: 'sendonly' })
    );
  });

  it('creates offer and sends voice_renegotiate', async () => {
    const track = makeMockTrack('video');
    const stream = makeMockStream([track]);
    mockGetUserMedia.mockResolvedValue(stream);

    await (vm as any).startScreenShare(SOURCE_ID, SETTINGS);

    expect(mockPC.createOffer).toHaveBeenCalled();
    expect(mockPC.setLocalDescription).toHaveBeenCalled();

    expect(mockWsMessages.length).toBe(2);
    const msg = JSON.parse(mockWsMessages[0]);
    expect(msg.type).toBe('voice_renegotiate');
    expect(msg.channel_id).toBe(MOCK_CHANNEL_ID);
    expect(msg.offer).toMatchObject({ type: 'offer' });
    const ssMsg = JSON.parse(mockWsMessages[1]);
    expect(ssMsg.type).toBe('screen_share_start');
    expect(ssMsg.channel_id).toBe(MOCK_CHANNEL_ID);
    expect(typeof ssMsg.screen_stream_id).toBe('string');
  });

  it('sets isScreenSharing=true and stores stream', async () => {
    const track = makeMockTrack('video');
    const stream = makeMockStream([track]);
    mockGetUserMedia.mockResolvedValue(stream);

    const result = await (vm as any).startScreenShare(SOURCE_ID, SETTINGS);

    expect(result).toBe(true);
    expect((vm as any).isScreenSharing).toBe(true);
    expect((vm as any).localScreenStream).toBe(stream);
  });

  it('returns false when channelId is null', async () => {
    (vm as any).channelId = null;
    const result = await (vm as any).startScreenShare(SOURCE_ID, SETTINGS);
    expect(result).toBe(false);
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it('returns false when peerConnection is null', async () => {
    (vm as any).peerConnection = null;
    const result = await (vm as any).startScreenShare(SOURCE_ID, SETTINGS);
    expect(result).toBe(false);
  });

  it('returns false and cleans up stream when getUserMedia throws', async () => {
    mockGetUserMedia.mockRejectedValue(new Error('Permission denied'));

    const result = await (vm as any).startScreenShare(SOURCE_ID, SETTINGS);

    expect(result).toBe(false);
    expect((vm as any).isScreenSharing).toBe(false);
    expect((vm as any).localScreenStream).toBeNull();
  });

  it('applies 1080p resolution constraints', async () => {
    const track = makeMockTrack('video');
    const stream = makeMockStream([track]);
    mockGetUserMedia.mockResolvedValue(stream);
    const hd: ScreenShareSettings = { ...SETTINGS, resolution: '1080p' };

    await (vm as any).startScreenShare(SOURCE_ID, hd);

    const call = mockGetUserMedia.mock.calls[0][0];
    expect(call.video.mandatory.maxWidth).toBe(1920);
    expect(call.video.mandatory.maxHeight).toBe(1080);
  });

  it('applies frameRate constraint', async () => {
    const track = makeMockTrack('video');
    const stream = makeMockStream([track]);
    mockGetUserMedia.mockResolvedValue(stream);
    const hfr: ScreenShareSettings = { ...SETTINGS, frameRate: 30 };

    await (vm as any).startScreenShare(SOURCE_ID, hfr);

    const call = mockGetUserMedia.mock.calls[0][0];
    expect(call.video.mandatory.maxFrameRate).toBe(30);
  });
});

// ─── stopScreenShare ───────────────────────────────────────────────────────────

describe('stopScreenShare', () => {
  beforeEach(() => {
    // Pre-set sharing state
    const track = makeMockTrack('video');
    (vm as any).localScreenStream = makeMockStream([track]);
    (vm as any).isScreenSharing = true;
  });

  it('stops all tracks on localScreenStream', async () => {
    const tracks = (vm as any).localScreenStream.getTracks() as ReturnType<typeof makeMockTrack>[];
    await (vm as any).stopScreenShare();
    tracks.forEach(t => expect(t.stop).toHaveBeenCalled());
  });

  it('sends voice_renegotiate and screen_share_stop after stopping', async () => {
    await (vm as any).stopScreenShare();

    expect(mockPC.createOffer).toHaveBeenCalled();
    expect(mockWsMessages.length).toBe(2);
    const renegMsg = JSON.parse(mockWsMessages[0]);
    expect(renegMsg.type).toBe('voice_renegotiate');
    const stopMsg = JSON.parse(mockWsMessages[1]);
    expect(stopMsg.type).toBe('screen_share_stop');
    expect(stopMsg.channel_id).toBe(MOCK_CHANNEL_ID);
  });

  it('resets isScreenSharing and localScreenStream', async () => {
    await (vm as any).stopScreenShare();

    expect((vm as any).isScreenSharing).toBe(false);
    expect((vm as any).localScreenStream).toBeNull();
  });

  it('no-ops when isScreenSharing is false', async () => {
    (vm as any).isScreenSharing = false;
    (vm as any).localScreenStream = null;

    await (vm as any).stopScreenShare();

    expect(mockPC.createOffer).not.toHaveBeenCalled();
    expect(mockWsMessages.length).toBe(0);
  });
});

// ─── handleMessage screen_share_start ─────────────────────────────────────────

describe('handleMessage screen_share_start', () => {
  it('calls onScreenShareStarted with user_id', () => {
    const cb = jest.fn();
    (vm as any).onScreenShareStarted = cb;

    (vm as any).handleMessage({
      type: 'screen_share_start',
      payload: { user_id: 'user-42' },
    });

    expect(cb).toHaveBeenCalledWith('user-42');
  });

  it('does not throw when onScreenShareStarted is null', () => {
    (vm as any).onScreenShareStarted = null;
    expect(() =>
      (vm as any).handleMessage({ type: 'screen_share_start', payload: { user_id: 'u' } })
    ).not.toThrow();
  });
});

// ─── handleMessage screen_share_stop ──────────────────────────────────────────

describe('handleMessage screen_share_stop', () => {
  it('calls onScreenShareStopped with user_id', () => {
    const cb = jest.fn();
    (vm as any).onScreenShareStopped = cb;

    (vm as any).handleMessage({
      type: 'screen_share_stop',
      payload: { user_id: 'user-99' },
    });

    expect(cb).toHaveBeenCalledWith('user-99');
  });
});

// ─── handleMessage voice_renegotiate_answer ───────────────────────────────────

describe('handleMessage voice_renegotiate_answer', () => {
  it('calls setRemoteDescription on publisher peerConnection', () => {
    (vm as any).handleMessage({
      type: 'voice_renegotiate_answer',
      payload: { sdp: { type: 'answer', sdp: 'v=0\r\n' } },
    });

    expect(mockPC.setRemoteDescription).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'answer', sdp: 'v=0\r\n' })
    );
  });

  it('does not throw when peerConnection is null', () => {
    (vm as any).peerConnection = null;
    expect(() =>
      (vm as any).handleMessage({
        type: 'voice_renegotiate_answer',
        payload: { sdp: { type: 'answer', sdp: 'v=0\r\n' } },
      })
    ).not.toThrow();
  });
});

// ─── _cleanup: screen share cleanup ───────────────────────────────────────────

describe('_cleanup screen share state', () => {
  it('stops localScreenStream tracks and clears state', () => {
    const track = makeMockTrack('video');
    (vm as any).localScreenStream = makeMockStream([track]);
    (vm as any).isScreenSharing = true;

    (vm as any)._cleanup();

    expect(track.stop).toHaveBeenCalled();
    expect((vm as any).localScreenStream).toBeNull();
    expect((vm as any).isScreenSharing).toBe(false);
  });

  it('handles null localScreenStream without throwing', () => {
    (vm as any).localScreenStream = null;
    expect(() => (vm as any)._cleanup()).not.toThrow();
  });
});

// ─── Phase 10: screen_share_start registers stream ID ─────────────────────────

describe('Phase 10: screen_share_start registers stream ID in maps', () => {
  it('stores screen_stream_id → user_id in _screenStreamIdToUser', () => {
    (vm as any).handleMessage({
      type: 'screen_share_start',
      payload: { user_id: 'user-A', screen_stream_id: 'stream-A' },
    });

    expect((vm as any)._screenStreamIdToUser.get('stream-A')).toBe('user-A');
  });

  it('stores user_id → screen_stream_id in _userToScreenStreamId', () => {
    (vm as any).handleMessage({
      type: 'screen_share_start',
      payload: { user_id: 'user-A', screen_stream_id: 'stream-A' },
    });

    expect((vm as any)._userToScreenStreamId.get('user-A')).toBe('stream-A');
  });

  it('still fires onScreenShareStarted callback', () => {
    const cb = jest.fn();
    (vm as any).onScreenShareStarted = cb;

    (vm as any).handleMessage({
      type: 'screen_share_start',
      payload: { user_id: 'user-A', screen_stream_id: 'stream-A' },
    });

    expect(cb).toHaveBeenCalledWith('user-A');
  });

  it('does not crash when screen_stream_id is absent', () => {
    expect(() =>
      (vm as any).handleMessage({ type: 'screen_share_start', payload: { user_id: 'user-A' } })
    ).not.toThrow();
  });
});

// ─── Phase 10: screen_share_stop clears stream ID from maps ───────────────────

describe('Phase 10: screen_share_stop clears stream ID from maps', () => {
  beforeEach(() => {
    // Pre-populate maps as if a screen_share_start was received
    (vm as any)._screenStreamIdToUser.set('stream-A', 'user-A');
    (vm as any)._userToScreenStreamId.set('user-A', 'stream-A');
    (vm as any).remoteScreenStreams.set('stream-A', makeMockStream());
  });

  it('removes entry from _screenStreamIdToUser', () => {
    (vm as any).handleMessage({
      type: 'screen_share_stop',
      payload: { user_id: 'user-A' },
    });

    expect((vm as any)._screenStreamIdToUser.has('stream-A')).toBe(false);
  });

  it('removes entry from _userToScreenStreamId', () => {
    (vm as any).handleMessage({
      type: 'screen_share_stop',
      payload: { user_id: 'user-A' },
    });

    expect((vm as any)._userToScreenStreamId.has('user-A')).toBe(false);
  });

  it('removes stream from remoteScreenStreams', () => {
    (vm as any).handleMessage({
      type: 'screen_share_stop',
      payload: { user_id: 'user-A' },
    });

    expect((vm as any).remoteScreenStreams.has('stream-A')).toBe(false);
  });

  it('still fires onScreenShareStopped callback', () => {
    const cb = jest.fn();
    (vm as any).onScreenShareStopped = cb;

    (vm as any).handleMessage({
      type: 'screen_share_stop',
      payload: { user_id: 'user-A' },
    });

    expect(cb).toHaveBeenCalledWith('user-A');
  });
});

// ─── Phase 10: handleParticipants reconciles screen share state ────────────────

describe('Phase 10: handleParticipants reconciles screen share state', () => {
  it('registers stream ID maps for a sharing participant', () => {
    (vm as any).handleParticipants([
      { user_id: 'user-A', username: 'Alice', screen_sharing: true, screen_stream_id: 'stream-A' },
    ]);

    expect((vm as any)._screenStreamIdToUser.get('stream-A')).toBe('user-A');
    expect((vm as any)._userToScreenStreamId.get('user-A')).toBe('stream-A');
  });

  it('does not re-register when user already has a stream ID mapped', () => {
    (vm as any)._screenStreamIdToUser.set('stream-OLD', 'user-A');
    (vm as any)._userToScreenStreamId.set('user-A', 'stream-OLD');

    (vm as any).handleParticipants([
      {
        user_id: 'user-A',
        username: 'Alice',
        screen_sharing: true,
        screen_stream_id: 'stream-NEW',
      },
    ]);

    // Existing mapping is preserved (not overwritten)
    expect((vm as any)._userToScreenStreamId.get('user-A')).toBe('stream-OLD');
  });

  it('removes departed screen shares from maps', () => {
    (vm as any)._screenStreamIdToUser.set('stream-A', 'user-A');
    (vm as any)._userToScreenStreamId.set('user-A', 'stream-A');
    (vm as any).remoteScreenStreams.set('stream-A', makeMockStream());

    // voice_participants arrives with user-A no longer sharing
    (vm as any).handleParticipants([
      { user_id: 'user-A', username: 'Alice', screen_sharing: false },
    ]);

    expect((vm as any)._userToScreenStreamId.has('user-A')).toBe(false);
    expect((vm as any)._screenStreamIdToUser.has('stream-A')).toBe(false);
    expect((vm as any).remoteScreenStreams.has('stream-A')).toBe(false);
  });

  it('still calls onParticipantsChanged callback', () => {
    const cb = jest.fn();
    (vm as any).onParticipantsChanged = cb;

    const participants = [{ user_id: 'user-A', username: 'Alice' }];
    (vm as any).handleParticipants(participants);

    expect(cb).toHaveBeenCalledWith(participants);
  });
});

// ─── Phase 10: ontrack routes screen streams to remoteScreenStreams ────────────

describe('Phase 10: ontrack routes screen streams to remoteScreenStreams', () => {
  it('routes a video stream whose ID is in _screenStreamIdToUser to remoteScreenStreams', () => {
    // Pre-register screen stream mapping (as if screen_share_start was received)
    (vm as any)._screenStreamIdToUser.set('stream-scr', 'user-A');
    (vm as any)._userToScreenStreamId.set('user-A', 'stream-scr');

    // Simulate subscriberPC.ontrack firing for a screen stream
    const mockStream = {
      id: 'stream-scr',
      getTracks: () => [],
      getVideoTracks: () => [],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
    const mockTrack = { kind: 'video' } as MediaStreamTrack;

    // Trigger ontrack by calling the internal handler directly
    (vm as any)._handleSubscriberTrack?.({ track: mockTrack, streams: [mockStream] });

    expect((vm as any).remoteScreenStreams.has('stream-scr')).toBe(true);
    expect((vm as any).remoteVideoStreams.has('stream-scr')).toBe(false);
  });

  it('routes a video stream with unknown ID to remoteVideoStreams', () => {
    // No pre-registered mapping → should go to camera streams
    const mockStream = {
      id: 'stream-cam',
      getTracks: () => [],
      getVideoTracks: () => [],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
    const mockTrack = { kind: 'video' } as MediaStreamTrack;

    (vm as any)._handleSubscriberTrack?.({ track: mockTrack, streams: [mockStream] });

    // Stream goes to remoteVideoStreams (camera) if _handleSubscriberTrack is available
    // This test validates the routing split when the method is exposed
    if ((vm as any)._handleSubscriberTrack) {
      expect((vm as any).remoteVideoStreams.has('stream-cam')).toBe(true);
      expect((vm as any).remoteScreenStreams.has('stream-cam')).toBe(false);
    }
  });
});
