/**
 * Voice service — TypeScript conversion of public/voice.js.
 * Provides the VoiceManager class and notification sound generation.
 */
'use strict';

const _voiceLog: EmberLogger = window.emberLog
  ? window.emberLog.createLogger('Voice')
  : {
      debug: () => {
        /* noop */
      },
      info: () => {
        /* noop */
      },
      warn: (m: string, d?: Record<string, unknown>) => console.warn('[Voice]', m, d ?? ''),
      error: (m: string, d?: Record<string, unknown>) => console.error('[Voice]', m, d ?? ''),
    };

class VoiceManager {
  ws: WebSocket;
  auth: AuthForVoice;
  channelId: string | null;
  peerConnection: RTCPeerConnection | null;
  subscriberPC: RTCPeerConnection | null;
  _subscriberIceQueue: RTCIceCandidateInit[];
  _subscriberRemoteDescSet: boolean;
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  audioElements: Map<string, HTMLAudioElement>;
  isMuted: boolean;
  isDeafened: boolean;
  speakingStates: Map<string, boolean>;
  onSpeakingChanged: ((userId: string, isSpeaking: boolean) => void) | null;
  onParticipantsChanged: ((participants: { user_id: string; username: string }[]) => void) | null;
  iceServers: ICEServer[];
  _iceQueue: RTCIceCandidateInit[];
  _remoteDescSet: boolean;
  localVideoStream: MediaStream | null;
  remoteVideoStreams: Map<string, MediaStream>;
  isCameraOn: boolean;
  onCameraStateChanged: ((userId: string, isOn: boolean) => void) | null;
  onVideoStreamAdded: ((streamId: string, stream: MediaStream) => void) | null;
  onConnected: (() => void) | null;
  _lastAudioSettings: VoiceSettings;
  _sensitivityThreshold: number;
  _audioCtx: AudioContext | null;
  _analyser: AnalyserNode | null;
  _localMonitorInterval: number | null;
  _gainNode: GainNode | null;
  _pttEnabled: boolean;
  _pttKey: string;
  _pttKeydownHandler: ((e: KeyboardEvent) => void) | null;
  _pttKeyupHandler: ((e: KeyboardEvent) => void) | null;

  // ─── Screen share ───────────────────────────────────────────────────────────
  localScreenStream: MediaStream | null;
  isScreenSharing: boolean;
  onScreenShareStarted: ((userId: string) => void) | null;
  onScreenShareStopped: ((userId: string) => void) | null;
  // Phase 10: stream ID routing for multiple simultaneous screen shares
  _screenStreamIdToUser: Map<string, string>;
  _userToScreenStreamId: Map<string, string>;
  remoteScreenStreams: Map<string, MediaStream>;

  // ─── Audio capture ────────────────────────────────────────────────────────
  _audioCaptureSetup: boolean;
  _audioCaptureInterval: ReturnType<typeof setInterval> | null;
  _audioCapturePCMBuffer: Int16Array[];
  _audioCtxCapture: AudioContext | null;
  _audioCaptureScriptNode: ScriptProcessorNode | null;
  _audioCaptureDestination: MediaStreamAudioDestinationNode | null;
  // Phase 9: native capture via AudioWorklet or PulseAudio
  _nativeAudioCaptureActive: boolean;
  _screenAudioCtx: AudioContext | null;

  constructor(wsConnection: WebSocket, authObj: AuthForVoice) {
    _voiceLog.info('VoiceManager created');
    this.ws = wsConnection;
    this.auth = authObj;
    this.channelId = null;
    this.peerConnection = null;
    this.subscriberPC = null;
    this._subscriberIceQueue = [];
    this._subscriberRemoteDescSet = false;
    this.localStream = null;
    this.remoteStreams = new Map();
    this.audioElements = new Map();
    this.isMuted = false;
    this.isDeafened = false;
    this.speakingStates = new Map();
    this.onSpeakingChanged = null;
    this.onParticipantsChanged = null;
    this.iceServers = [];
    this._iceQueue = [];
    this._remoteDescSet = false;
    this.localVideoStream = null;
    this.remoteVideoStreams = new Map();
    this.isCameraOn = false;
    this.onCameraStateChanged = null;
    this.onVideoStreamAdded = null;
    this.onConnected = null;
    this._lastAudioSettings = {};
    this._sensitivityThreshold = 0.08;
    this._audioCtx = null;
    this._analyser = null;
    this._localMonitorInterval = null;
    this._gainNode = null;
    this._pttEnabled = false;
    this._pttKey = 'Backquote';
    this._pttKeydownHandler = null;
    this._pttKeyupHandler = null;

    // Screen share
    this.localScreenStream = null;
    this.isScreenSharing = false;
    this.onScreenShareStarted = null;
    this.onScreenShareStopped = null;
    this._screenStreamIdToUser = new Map();
    this._userToScreenStreamId = new Map();
    this.remoteScreenStreams = new Map();

    // Audio capture
    this._audioCaptureSetup = false;
    this._audioCaptureInterval = null;
    this._audioCapturePCMBuffer = [];
    this._audioCtxCapture = null;
    this._audioCaptureScriptNode = null;
    this._audioCaptureDestination = null;
    this._nativeAudioCaptureActive = false;
    this._screenAudioCtx = null;
  }

  async fetchICEServers(): Promise<void> {
    _voiceLog.debug('Fetching ICE servers');
    try {
      const res = await fetch(`${this.auth.hostname}/api/v1/voice/ice-servers`, {
        headers: { Authorization: `Bearer ${this.auth.token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { ice_servers?: ICEServer[] };
        this.iceServers = data.ice_servers ?? [];
        _voiceLog.debug('ICE servers fetched', {
          count: this.iceServers.length,
        });
      } else {
        _voiceLog.warn('ICE server fetch returned non-OK status', {
          status: res.status,
        });
      }
    } catch (e) {
      _voiceLog.warn('Failed to fetch ICE servers, using STUN fallback');
      console.warn('[Voice] Failed to fetch ICE servers, using defaults:', e);
      this.iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    }
  }

  async joinChannel(
    channelId: string,
    audioSettings?: VoiceSettings | null,
    withVideo = false,
    cameraDeviceId: string | null = null
  ): Promise<boolean> {
    if (this.channelId === channelId) {
      _voiceLog.debug('joinChannel: already in this channel', {
        channel_id: channelId,
      });
      return false;
    }
    if (this.channelId) {
      _voiceLog.info('Leaving current voice channel before joining new one', {
        channel_id: this.channelId,
      });
      await this.leaveChannel();
    }

    _voiceLog.info('Joining voice channel', { channel_id: channelId });
    this.channelId = channelId;
    await this.fetchICEServers();

    const s = audioSettings ?? {};
    this._lastAudioSettings = audioSettings ?? {};
    this._sensitivityThreshold =
      s.autoSensitivity === false
        ? s.sensitivityThreshold != null
          ? s.sensitivityThreshold / 100
          : 0.08
        : 0.08;

    try {
      _voiceLog.debug('Requesting microphone access');
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: s.echoCancellation !== false,
          noiseSuppression: s.noiseSuppression !== false,
          autoGainControl: s.autoGainControl !== false,
          ...(s.inputDevice && s.inputDevice !== 'default'
            ? { deviceId: { exact: s.inputDevice } }
            : {}),
        },
        video: withVideo
          ? cameraDeviceId
            ? { deviceId: { exact: cameraDeviceId } }
            : true
          : false,
      });
      _voiceLog.info('Microphone access granted');
      if (withVideo) {
        this.localVideoStream = this.localStream;
        this.isCameraOn = true;
      }
    } catch (e) {
      _voiceLog.error('Microphone access denied', { error: String(e) });
      console.error('[Voice] Microphone access denied:', e);
      this.channelId = null;
      return false;
    }

    this._setupLocalAudioMonitor();

    // Create peer connection before sending voice_join so we can include the
    // offer in the join message. ion-SFU requires the client to be the offerer.
    _voiceLog.debug('Creating RTCPeerConnection');
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    if (this.localStream) {
      const tracks = this.localStream.getTracks();
      _voiceLog.info('Local stream created', {
        trackCount: tracks.length,
        audioTracks: this.localStream.getAudioTracks().length,
        videoTracks: this.localStream.getVideoTracks().length,
      });

      tracks.forEach(track => {
        // Use addTransceiver with sendonly so the SFU appends recvonly m-lines
        // for remote participants at the end rather than reordering existing ones.
        // addTrack (sendrecv) causes ion-SFU renegotiation offers to reorder
        // m-lines, which Chrome rejects with an InvalidAccessError.
        this.peerConnection!.addTransceiver(track, {
          direction: 'sendonly',
          streams: [this.localStream!],
        });
        _voiceLog.debug('Local track added to peer connection', {
          kind: track.kind,
          id: track.id,
          enabled: track.enabled,
        });
      });
    } else {
      _voiceLog.error('No local stream created - microphone access may have failed');
    }

    // ontrack lives on subscriberPC (created in handleOffer) — the publisher PC
    // only sends local audio; remote tracks arrive on the subscriber PC.

    this.peerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        this.ws.send(
          JSON.stringify({
            type: 'voice_ice_candidate',
            channelId: this.channelId,
            candidate: event.candidate,
            target: 0, // publisher PC
          })
        );
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      _voiceLog.info('Peer connection state changed', {
        state: state ?? 'unknown',
      });
      console.log('[Voice] Connection state:', state);
      if (state === 'connected' && this.onConnected) {
        const cb = this.onConnected;
        this.onConnected = null;
        cb();
      }
    };

    let offer: RTCSessionDescriptionInit;
    try {
      _voiceLog.debug('Creating WebRTC offer');
      offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
    } catch (e) {
      _voiceLog.error('Failed to create WebRTC offer', { error: String(e) });
      console.error('[Voice] Failed to create offer:', e);
      this._cleanup();
      return false;
    }

    _voiceLog.debug('Sending voice_join to server', { channel_id: channelId });
    this.ws.send(
      JSON.stringify({
        type: 'voice_join',
        channelId,
        offer: { type: offer.type, sdp: offer.sdp },
      })
    );

    _voiceLog.info('Voice channel join initiated, offer sent', {
      channel_id: channelId,
    });
    return true;
  }

  async leaveChannel(): Promise<void> {
    if (!this.channelId) return;
    _voiceLog.info('Leaving voice channel', { channel_id: this.channelId });
    this.ws.send(JSON.stringify({ type: 'voice_leave' }));
    this._cleanup();
    _voiceLog.info('Voice channel left and resources cleaned up');
  }

  _cleanup(): void {
    this.channelId = null;
    this._remoteDescSet = false;
    this._iceQueue = [];
    this._subscriberRemoteDescSet = false;
    this._subscriberIceQueue = [];
    this.onConnected = null;

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.subscriberPC) {
      this.subscriberPC.close();
      this.subscriberPC = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    this.remoteStreams.forEach(stream => stream.getTracks().forEach(t => t.stop()));
    this.remoteStreams.clear();

    this.audioElements.forEach(el => {
      el.pause();
      el.srcObject = null;
      el.remove();
    });
    this.audioElements.clear();
    this.speakingStates.clear();

    if (this.localVideoStream) {
      this.localVideoStream.getTracks().forEach(t => t.stop());
      this.localVideoStream = null;
    }
    this.remoteVideoStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    this.remoteVideoStreams.clear();
    this.isCameraOn = false;

    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach(t => t.stop());
      this.localScreenStream = null;
    }
    this.isScreenSharing = false;
    this._stopAudioCapture().catch(() => {
      /* ignore */
    });

    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {
        /* ignore */
      });
      this._audioCtx = null;
      this._analyser = null;
      this._localMonitorInterval = null;
    }
  }

  // handleJoinAnswer is called when the SFU sends the answer to our initial
  // join offer. Sets remote description and flushes any queued ICE candidates.
  async handleJoinAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.channelId || !this.peerConnection) return;
    _voiceLog.info('Received SFU answer for initial offer');
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    this._remoteDescSet = true;
    if (this._iceQueue.length > 0) {
      _voiceLog.debug('Flushing queued ICE candidates', {
        count: this._iceQueue.length,
      });
      for (const c of this._iceQueue) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
      }
      this._iceQueue = [];
    }
  }

  // handleOffer handles SFU subscriber offers (sent when another participant
  // joins or leaves). ion-SFU uses a separate subscriber PeerConnection to push
  // remote tracks — applying this offer to the publisher PC causes m-line order
  // errors because the two PCs have independent SDP structures.
  async handleOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.channelId) return;

    // Create the subscriber PC on first offer.
    if (!this.subscriberPC) {
      _voiceLog.debug('Creating subscriber RTCPeerConnection');
      this.subscriberPC = new RTCPeerConnection({
        iceServers: this.iceServers,
      });

      this.subscriberPC.ontrack = (event: RTCTrackEvent) => {
        this._handleSubscriberTrack(event);
      };

      this.subscriberPC.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          _voiceLog.debug('Subscriber ICE candidate generated, sending to server', {
            protocol: event.candidate.protocol,
            type: event.candidate.type,
          });
          this.ws.send(
            JSON.stringify({
              type: 'voice_ice_candidate',
              channelId: this.channelId,
              candidate: event.candidate,
              target: 1, // subscriber PC
            })
          );
        } else {
          _voiceLog.debug('Subscriber ICE gathering complete (null candidate)');
        }
      };

      this.subscriberPC.onconnectionstatechange = () => {
        const state = this.subscriberPC?.connectionState;
        _voiceLog.info('Subscriber PC connection state changed', {
          state: state ?? 'unknown',
        });
      };

      this.subscriberPC.onicegatheringstatechange = () => {
        _voiceLog.debug('Subscriber PC ICE gathering state', {
          state: this.subscriberPC?.iceGatheringState ?? 'unknown',
        });
      };

      this.subscriberPC.oniceconnectionstatechange = () => {
        _voiceLog.debug('Subscriber PC ICE connection state', {
          state: this.subscriberPC?.iceConnectionState ?? 'unknown',
        });
      };
    }

    _voiceLog.info('Received SFU subscriber offer', {
      signalingState: this.subscriberPC.signalingState,
    });
    await this.subscriberPC.setRemoteDescription(new RTCSessionDescription(sdp));
    this._subscriberRemoteDescSet = true;

    if (this._subscriberIceQueue.length > 0) {
      _voiceLog.debug('Flushing queued subscriber ICE candidates', {
        count: this._subscriberIceQueue.length,
      });
      for (const c of this._subscriberIceQueue) {
        await this.subscriberPC.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
      }
      this._subscriberIceQueue = [];
    }

    _voiceLog.debug('Subscriber remote description set');
    const answer = await this.subscriberPC.createAnswer();
    await this.subscriberPC.setLocalDescription(answer);
    _voiceLog.debug('Subscriber local description set', {
      iceGatheringState: this.subscriberPC.iceGatheringState,
    });
    _voiceLog.info('Subscriber answer sent to server');
    this.ws.send(
      JSON.stringify({
        type: 'voice_answer',
        channelId: this.channelId,
        sdp: answer,
      })
    );
  }

  async handleRemoteICECandidate(
    candidate: RTCIceCandidateInit,
    target: number = 0
  ): Promise<void> {
    if (target === 1) {
      // Subscriber ICE candidate
      if (!this.subscriberPC || !this._subscriberRemoteDescSet) {
        _voiceLog.debug('Queuing subscriber ICE candidate (subscriber PC not ready)');
        this._subscriberIceQueue.push(candidate);
        return;
      }
      try {
        await this.subscriberPC.addIceCandidate(new RTCIceCandidate(candidate));
        _voiceLog.debug('Subscriber ICE candidate added');
      } catch (e) {
        _voiceLog.warn('Failed to add subscriber ICE candidate', {
          error: String(e),
        });
      }
      return;
    }

    // Publisher ICE candidate (target === 0)
    if (!this.peerConnection) return;
    if (!this._remoteDescSet) {
      _voiceLog.debug('Queuing ICE candidate (remote description not yet set)');
      this._iceQueue.push(candidate);
      return;
    }
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      _voiceLog.debug('Remote ICE candidate added');
    } catch (e) {
      _voiceLog.warn('Failed to add remote ICE candidate', {
        error: String(e),
      });
      console.warn('[Voice] Failed to add ICE candidate:', e);
    }
  }

  handleSpeakingEvent(userId: string, _level: number, isSpeaking: boolean): void {
    const was = this.speakingStates.get(userId) ?? false;
    if (was !== isSpeaking) {
      this.speakingStates.set(userId, isSpeaking);
      if (this.onSpeakingChanged) this.onSpeakingChanged(userId, isSpeaking);
    }
  }

  handleParticipants(
    participants: {
      user_id: string;
      username: string;
      screen_sharing?: boolean;
      screen_stream_id?: string;
    }[]
  ): void {
    // Phase 10: reconcile stream ID maps for late joiners.
    const activeScreenSids = new Set<string>();
    for (const p of participants) {
      if (p.screen_sharing && p.screen_stream_id) {
        activeScreenSids.add(p.user_id);
        if (!this._userToScreenStreamId.has(p.user_id)) {
          this._screenStreamIdToUser.set(p.screen_stream_id, p.user_id);
          this._userToScreenStreamId.set(p.user_id, p.screen_stream_id);
        }
      }
    }
    // Remove mappings for users who are no longer sharing.
    for (const [userId] of this._userToScreenStreamId) {
      if (!activeScreenSids.has(userId)) {
        const streamId = this._userToScreenStreamId.get(userId)!;
        this._screenStreamIdToUser.delete(streamId);
        this._userToScreenStreamId.delete(userId);
        this.remoteScreenStreams.delete(streamId);
      }
    }
    if (this.onParticipantsChanged) this.onParticipantsChanged(participants);
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    _voiceLog.info('Microphone toggled', { muted: this.isMuted });
    if (this.localStream)
      this.localStream.getAudioTracks().forEach(t => {
        t.enabled = !this.isMuted;
      });
    return this.isMuted;
  }

  toggleDeafen(): boolean {
    this.isDeafened = !this.isDeafened;
    _voiceLog.info('Deafen toggled', { deafened: this.isDeafened });
    this.audioElements.forEach(el => {
      el.muted = this.isDeafened;
    });
    return this.isDeafened;
  }

  // Phase 10: extracted from subscriberPC.ontrack for testability.
  _handleSubscriberTrack(event: RTCTrackEvent): void {
    const stream = event.streams[0];
    _voiceLog.debug('ontrack fired (subscriber)', {
      kind: event.track.kind,
      trackId: event.track.id,
      streamId: stream?.id ?? 'none',
    });
    if (!stream) return;
    if (event.track.kind === 'audio') {
      if (!this.remoteStreams.has(stream.id)) {
        this.remoteStreams.set(stream.id, stream);
        _voiceLog.info('Remote audio stream added', { streamId: stream.id });
        if (!this.isDeafened) this._playRemoteStream(stream.id, stream);
      } else {
        _voiceLog.debug('Remote audio stream already tracked, skipping', {
          streamId: stream.id,
        });
      }
    } else if (event.track.kind === 'video') {
      // Route screen streams to remoteScreenStreams, camera streams to remoteVideoStreams.
      if (this._screenStreamIdToUser.has(stream.id)) {
        this.remoteScreenStreams.set(stream.id, stream);
        _voiceLog.info('Remote screen stream added', { streamId: stream.id });
      } else {
        this.remoteVideoStreams.set(stream.id, stream);
        _voiceLog.info('Remote video stream added', { streamId: stream.id });
      }
      if (this.onVideoStreamAdded) this.onVideoStreamAdded(stream.id, stream);
    }
  }

  _playRemoteStream(id: string, stream: MediaStream): void {
    if (this.audioElements.has(id)) return;
    _voiceLog.debug('Playing remote audio stream', { stream_id: id });
    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.muted = this.isDeafened;
    audio.play().catch(e => {
      _voiceLog.warn('Remote audio play failed', {
        stream_id: id,
        error: String(e),
      });
      console.warn('[Voice] Audio play failed:', e);
    });
    this.audioElements.set(id, audio);
  }

  _setupLocalAudioMonitor(): void {
    _voiceLog.debug('Setting up local audio monitor');
    if (!this.localStream) {
      _voiceLog.error('Cannot setup audio monitor - no local stream');
      return;
    }

    try {
      const ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
      const source = ctx.createMediaStreamSource(this.localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      this._audioCtx = ctx;
      this._analyser = analyser;

      _voiceLog.info('Local audio monitor setup completed', {
        audioContext: ctx.state,
        streamActive: this.localStream.active,
        audioTracks: this.localStream.getAudioTracks().length,
      });

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let isSpeakingLocal = false;

      const check = () => {
        if (!this._analyser) return;
        this._analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
        const level = avg / 255;
        const speaking = level > (this._sensitivityThreshold || 0.08) && !this.isMuted;
        if (speaking !== isSpeakingLocal) {
          isSpeakingLocal = speaking;
          if (this.onSpeakingChanged && this.auth) {
            this.onSpeakingChanged(this.auth.userId, speaking);
          }
        }
        if (this.channelId) requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    } catch (e) {
      _voiceLog.warn('Local audio monitor setup failed', { error: String(e) });
      console.warn('[Voice] Audio monitor setup failed:', e);
    }
  }

  async enableCamera(cameraDeviceId: string | null): Promise<boolean> {
    if (!this.channelId) return false;
    const channelId = this.channelId;
    _voiceLog.info('Enabling camera, rejoining channel', {
      channel_id: channelId,
    });
    this._partialCleanup();
    return this.joinChannel(channelId, this._lastAudioSettings, true, cameraDeviceId);
  }

  async disableCamera(): Promise<boolean> {
    if (!this.channelId) return false;
    const channelId = this.channelId;
    _voiceLog.info('Disabling camera, rejoining channel', {
      channel_id: channelId,
    });
    this._partialCleanup();
    return this.joinChannel(channelId, this._lastAudioSettings, false);
  }

  _partialCleanup(): string | null {
    // Notify the server before tearing down local state so the server can
    // close the SFU connection cleanly rather than waiting for the next
    // voice_join to trigger an implicit voiceLeave.
    if (this.channelId && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'voice_leave' }));
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.subscriberPC) {
      this.subscriberPC.close();
      this.subscriberPC = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.localVideoStream) {
      this.localVideoStream.getTracks().forEach(t => t.stop());
      this.localVideoStream = null;
    }
    this.remoteVideoStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    this.remoteVideoStreams.clear();
    this.remoteStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    this.remoteStreams.clear();
    this.audioElements.forEach(el => {
      el.pause();
      el.srcObject = null;
      el.remove();
    });
    this.audioElements.clear();
    this._remoteDescSet = false;
    this._iceQueue = [];
    this._subscriberRemoteDescSet = false;
    this._subscriberIceQueue = [];
    this.isCameraOn = false;
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach(t => t.stop());
      this.localScreenStream = null;
    }
    this.isScreenSharing = false;
    this._stopAudioCapture().catch(() => {
      /* ignore */
    });
    const channelId = this.channelId;
    this.channelId = null;
    return channelId;
  }

  handleMessage(msg: { type: string; payload: Record<string, unknown> }): void {
    _voiceLog.debug('WebSocket voice message received', { type: msg.type });
    switch (msg.type) {
      case 'voice_error': {
        const errMsg = String(msg.payload['message'] ?? 'unknown SFU error');
        _voiceLog.error('SFU connection error — cleaning up voice session', {
          message: errMsg,
        });
        console.error('[Voice] SFU error:', errMsg);
        this._cleanup();
        break;
      }
      case 'voice_answer': {
        // Answer from SFU to our initial join offer — set remote description.
        const raw = msg.payload['sdp'] as Record<string, unknown>;
        if (raw && typeof raw['type'] === 'string' && typeof raw['sdp'] === 'string') {
          this.handleJoinAnswer({
            type: raw['type'] as RTCSdpType,
            sdp: raw['sdp'],
          });
        } else {
          _voiceLog.error('voice_answer received with invalid sdp payload', {
            payload: JSON.stringify(raw),
          });
        }
        break;
      }
      case 'voice_offer': {
        // Renegotiation offer from SFU (another participant joined/left).
        const raw = msg.payload['sdp'] as Record<string, unknown>;
        if (raw && typeof raw['type'] === 'string' && typeof raw['sdp'] === 'string') {
          this.handleOffer({
            type: raw['type'] as RTCSdpType,
            sdp: raw['sdp'],
          }).catch(err =>
            _voiceLog.error('Renegotiation handleOffer failed', { error: String(err) })
          );
        } else {
          _voiceLog.error('voice_offer received with invalid sdp payload', {
            payload: JSON.stringify(raw),
          });
        }
        break;
      }
      case 'voice_ice_candidate':
        this.handleRemoteICECandidate(
          msg.payload['candidate'] as RTCIceCandidateInit,
          typeof msg.payload['target'] === 'number' ? (msg.payload['target'] as number) : 0
        );
        break;
      case 'voice_speaking':
        this.handleSpeakingEvent(
          String(msg.payload['user_id'] ?? ''),
          Number(msg.payload['level'] ?? 0),
          Boolean(msg.payload['is_speaking'])
        );
        break;
      case 'voice_participants':
        _voiceLog.debug('Voice participants update', {
          count: ((msg.payload['participants'] as unknown[]) ?? []).length,
        });
        this.handleParticipants(
          msg.payload['participants'] as { user_id: string; username: string }[]
        );
        break;
      case 'voice_camera_on':
        if (this.onCameraStateChanged)
          this.onCameraStateChanged(String(msg.payload['user_id'] ?? ''), true);
        break;
      case 'voice_camera_off':
        if (this.onCameraStateChanged)
          this.onCameraStateChanged(String(msg.payload['user_id'] ?? ''), false);
        break;
      case 'screen_share_start': {
        const ssUserId = String(msg.payload['user_id'] ?? '');
        const ssStreamId = String(msg.payload['screen_stream_id'] ?? '');
        if (ssStreamId) {
          this._screenStreamIdToUser.set(ssStreamId, ssUserId);
          this._userToScreenStreamId.set(ssUserId, ssStreamId);
          _voiceLog.info('screen_share_start received, stream ID registered', {
            userId: ssUserId,
            screen_stream_id: ssStreamId,
          });
          // Fix race condition: if ontrack fired before this message arrived,
          // the stream was placed in remoteVideoStreams — move it now.
          const earlyStream = this.remoteVideoStreams.get(ssStreamId);
          if (earlyStream) {
            this.remoteVideoStreams.delete(ssStreamId);
            this.remoteScreenStreams.set(ssStreamId, earlyStream);
            _voiceLog.info('Reclassified early video track as screen share', {
              screen_stream_id: ssStreamId,
            });
          }
        }
        if (this.onScreenShareStarted) this.onScreenShareStarted(ssUserId);
        break;
      }
      case 'screen_share_stop': {
        const stopUserId = String(msg.payload['user_id'] ?? '');
        const stopStreamId = this._userToScreenStreamId.get(stopUserId);
        if (stopStreamId) {
          this._screenStreamIdToUser.delete(stopStreamId);
          this._userToScreenStreamId.delete(stopUserId);
          this.remoteScreenStreams.delete(stopStreamId);
        }
        if (this.onScreenShareStopped) this.onScreenShareStopped(stopUserId);
        break;
      }
      case 'voice_renegotiate_answer': {
        const raw = msg.payload['sdp'] as Record<string, unknown>;
        if (
          this.peerConnection &&
          raw &&
          typeof raw['type'] === 'string' &&
          typeof raw['sdp'] === 'string'
        ) {
          this.peerConnection
            .setRemoteDescription(
              new RTCSessionDescription({
                type: raw['type'] as RTCSdpType,
                sdp: raw['sdp'],
              })
            )
            .catch((err: unknown) =>
              _voiceLog.error('voice_renegotiate_answer setRemoteDescription failed', {
                error: String(err),
              })
            );
        }
        break;
      }
    }
  }

  // ─── Audio capture ────────────────────────────────────────────────────────

  /**
   * buildPulseAudioTrack — obtains audio from the PulseAudio combined-sink
   * monitor device that the main process created. The monitor appears as a
   * regular audioinput device in the renderer.
   */
  async buildPulseAudioTrack(): Promise<MediaStreamTrack | null> {
    let devices: MediaDeviceInfo[];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return null;
    }
    const monitor = devices.find(
      d => d.kind === 'audioinput' && d.label.toLowerCase().includes('ember_screen_capture')
    );
    if (!monitor) {
      _voiceLog.warn('PulseAudio capture sink monitor device not found');
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: monitor.deviceId } },
        video: false,
      });
      return stream.getAudioTracks()[0] ?? null;
    } catch (err) {
      _voiceLog.warn('getUserMedia for PulseAudio monitor failed', { error: String(err) });
      return null;
    }
  }

  /**
   * buildPcmInjectionTrack — AudioWorklet-based PCM injection track.
   * Used for Windows WASAPI and Linux PipeWire capture paths.
   * Loads pcm-injector.js, polls frames via requestAnimationFrame, and
   * feeds raw Float32 PCM into a MediaStreamDestinationNode.
   */
  async buildPcmInjectionTrack(): Promise<MediaStreamTrack | null> {
    const audioCtx = new AudioContext({ sampleRate: 48000 });
    this._screenAudioCtx = audioCtx;
    try {
      await audioCtx.audioWorklet.addModule('audio/pcm-injector.js');
    } catch (err) {
      _voiceLog.error('Failed to load pcm-injector AudioWorklet', { error: String(err) });
      audioCtx.close().catch(() => {});
      this._screenAudioCtx = null;
      return null;
    }
    const worklet = new AudioWorkletNode(audioCtx, 'pcm-injector');
    const dest = audioCtx.createMediaStreamDestination();
    worklet.connect(dest);

    this._nativeAudioCaptureActive = true;
    const poll = async () => {
      if (!this.isScreenSharing || !this._nativeAudioCaptureActive) return;
      try {
        const frames = await (
          window.electronAPI as unknown as {
            audioCapture: { frames(): Promise<{ pcm: Float32Array } | null> };
          }
        ).audioCapture.frames();
        if (frames && frames.pcm && frames.pcm.length > 0) {
          worklet.port.postMessage({ pcm: frames.pcm });
        }
      } catch {
        /* ignore transient frame errors */
      }
      requestAnimationFrame(poll);
    };
    poll();

    _voiceLog.info('PCM injection audio track created');
    return dest.stream.getAudioTracks()[0] ?? null;
  }

  /**
   * buildAudioTrackFromNativeCapture — dispatches to the correct audio
   * pipeline based on the platform reported by audio-capture-setup.
   */
  async buildAudioTrackFromNativeCapture(result: {
    platform?: string;
  }): Promise<MediaStreamTrack | null> {
    if (result.platform === 'linux-pulseaudio') {
      const track = await this.buildPulseAudioTrack();
      if (track) this._nativeAudioCaptureActive = true;
      return track;
    }
    // Windows WASAPI and Linux PipeWire: AudioWorklet PCM injection
    return this.buildPcmInjectionTrack();
  }

  /**
   * _startAudioCapture — attempt to start system audio capture via the
   * main-process IPC bridge. Returns the audio MediaStream on success,
   * or null if the platform does not support capture or setup fails.
   */
  async _startAudioCapture(): Promise<MediaStream | null> {
    let setupResult: { success: boolean; platform?: string; reason?: string };
    try {
      setupResult = await (
        window.electronAPI as unknown as {
          audioCapture: {
            setup(): Promise<{ success: boolean; platform?: string; reason?: string }>;
          };
        }
      ).audioCapture.setup();
    } catch (e) {
      _voiceLog.warn('Audio capture setup threw', { error: String(e) });
      return null;
    }

    if (!setupResult.success) {
      _voiceLog.warn('Audio capture setup failed', {
        reason: setupResult.reason ?? 'unknown',
      });
      return null;
    }

    this._audioCaptureSetup = true;

    const track = await this.buildAudioTrackFromNativeCapture(setupResult);
    if (!track) {
      this._audioCaptureSetup = false;
      return null;
    }

    _voiceLog.info('Audio capture pipeline started', { platform: setupResult.platform });
    return new MediaStream([track]);
  }

  /** _stopAudioCapture — tear down the audio capture pipeline. */
  async _stopAudioCapture(): Promise<void> {
    // Phase 9: stop rAF-based native capture loop
    this._nativeAudioCaptureActive = false;

    // Phase 9: close the AudioWorklet AudioContext
    if (this._screenAudioCtx) {
      await this._screenAudioCtx.close().catch(() => {});
      this._screenAudioCtx = null;
    }

    if (this._audioCaptureInterval !== null) {
      clearInterval(this._audioCaptureInterval);
      this._audioCaptureInterval = null;
    }
    this._audioCapturePCMBuffer = [];

    if (this._audioCaptureScriptNode) {
      this._audioCaptureScriptNode.disconnect();
      this._audioCaptureScriptNode = null;
    }
    if (this._audioCaptureDestination) {
      this._audioCaptureDestination.disconnect();
      this._audioCaptureDestination = null;
    }
    if (this._audioCtxCapture) {
      await this._audioCtxCapture.close().catch(() => {});
      this._audioCtxCapture = null;
    }

    if (this._audioCaptureSetup) {
      try {
        await (
          window.electronAPI as unknown as {
            audioCapture: { teardown(): Promise<void> };
          }
        ).audioCapture.teardown();
      } catch (e) {
        _voiceLog.warn('Audio capture teardown failed', { error: String(e) });
      }
      this._audioCaptureSetup = false;
    }
    _voiceLog.info('Audio capture pipeline stopped');
  }

  // ─── Screen share methods ──────────────────────────────────────────────────

  async startScreenShare(sourceId: string, settings: ScreenShareSettings): Promise<boolean> {
    if (!this.channelId || !this.peerConnection) {
      _voiceLog.warn('startScreenShare: not in a voice channel or no peerConnection');
      return false;
    }

    const resolutionMap: Record<string, { maxWidth: number; maxHeight: number }> = {
      '720p': { maxWidth: 1280, maxHeight: 720 },
      '1080p': { maxWidth: 1920, maxHeight: 1080 },
      '1440p': { maxWidth: 2560, maxHeight: 1440 },
    };
    const res = resolutionMap[settings.resolution] ?? resolutionMap['720p'];

    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: res.maxWidth,
          maxHeight: res.maxHeight,
          maxFrameRate: settings.frameRate,
        },
      },
    } as unknown as MediaStreamConstraints;

    let stream: MediaStream;
    try {
      _voiceLog.info('Requesting screen capture stream', { sourceId });
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      _voiceLog.error('Screen capture getUserMedia failed', { error: String(e) });
      return false;
    }

    this.localScreenStream = stream;

    // Attempt system audio capture when requested (Phase 4).
    // Gracefully degrades to video-only when setup() returns {success: false}
    // (as it always does before Phase 9 native addon integration).
    if (settings.includeAudio) {
      const audioStream = await this._startAudioCapture();
      if (audioStream) {
        const audioTrack = audioStream.getAudioTracks()[0];
        if (audioTrack) {
          this.peerConnection.addTransceiver(audioTrack, {
            direction: 'sendonly',
            streams: [audioStream],
          });
          _voiceLog.info('Audio track added for screen share');
        }
      }
    }

    const videoTrack = stream.getVideoTracks()[0];
    this.peerConnection.addTransceiver(videoTrack, {
      direction: 'sendonly',
      streams: [stream],
    });

    let offer: RTCSessionDescriptionInit;
    try {
      offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
    } catch (e) {
      _voiceLog.error('startScreenShare: createOffer failed', { error: String(e) });
      stream.getTracks().forEach(t => t.stop());
      this.localScreenStream = null;
      return false;
    }

    this.ws.send(
      JSON.stringify({
        type: 'voice_renegotiate',
        channelId: this.channelId,
        offer: { type: offer.type, sdp: offer.sdp },
      })
    );

    this.ws.send(
      JSON.stringify({
        type: 'screen_share_start',
        channelId: this.channelId,
        screenStreamId: stream.id,
      })
    );
    _voiceLog.info('screen_share_start sent to server', { screenStreamId: stream.id });

    this.isScreenSharing = true;
    _voiceLog.info('Screen share started, renegotiation offer sent');
    return true;
  }

  async stopScreenShare(): Promise<void> {
    if (!this.isScreenSharing || !this.localScreenStream) return;

    _voiceLog.info('Stopping screen share');
    this.localScreenStream.getTracks().forEach(t => t.stop());
    this.localScreenStream = null;
    this.isScreenSharing = false;

    await this._stopAudioCapture();

    if (this.peerConnection && this.channelId) {
      try {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        this.ws.send(
          JSON.stringify({
            type: 'voice_renegotiate',
            channelId: this.channelId,
            offer: { type: offer.type, sdp: offer.sdp },
          })
        );
      } catch (e) {
        _voiceLog.warn('stopScreenShare: renegotiation offer failed', { error: String(e) });
      }
    }

    if (this.channelId) {
      this.ws.send(
        JSON.stringify({
          type: 'screen_share_stop',
          channelId: this.channelId,
        })
      );
      _voiceLog.info('screen_share_stop sent to server');
    }
  }

  applySettings(settings: VoiceSettings): void {
    if (!settings) return;

    if (typeof settings.outputVolume === 'number') {
      const vol = settings.outputVolume / 100;
      this.audioElements.forEach(el => {
        el.volume = vol;
      });
    }

    if (this._gainNode && typeof settings.inputVolume === 'number') {
      this._gainNode.gain.value = settings.inputVolume / 100;
    }

    if (this.localStream) {
      const constraints = {
        echoCancellation: settings.echoCancellation !== false,
        noiseSuppression: settings.noiseSuppression !== false,
        autoGainControl: settings.autoGainControl !== false,
      };
      this.localStream.getAudioTracks().forEach(t => {
        t.applyConstraints(constraints).catch(e =>
          console.warn('[Voice] applyConstraints failed:', e)
        );
      });
    }

    this._sensitivityThreshold =
      settings.autoSensitivity === false
        ? settings.sensitivityThreshold != null
          ? settings.sensitivityThreshold / 100
          : 0.08
        : 0.08;

    if (typeof settings.pushToTalk === 'boolean') {
      this.setPushToTalk(settings.pushToTalk, settings.pttKey ?? 'Backquote');
    }
  }

  setSpeakerDevice(deviceId: string): void {
    if (!deviceId || deviceId === 'default') return;
    this.audioElements.forEach(el => {
      if (
        typeof (el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
          .setSinkId === 'function'
      ) {
        (el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
          .setSinkId(deviceId)
          .catch(e => console.warn('[Voice] setSinkId failed:', e));
      }
    });
  }

  setPushToTalk(enabled: boolean, key: string): void {
    if (this._pttKeydownHandler) {
      document.removeEventListener('keydown', this._pttKeydownHandler, true);
      this._pttKeydownHandler = null;
    }
    if (this._pttKeyupHandler) {
      document.removeEventListener('keyup', this._pttKeyupHandler, true);
      this._pttKeyupHandler = null;
    }

    this._pttEnabled = enabled;
    this._pttKey = key || 'Backquote';

    if (!enabled) return;

    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => {
        t.enabled = false;
      });
      this.isMuted = true;
    }

    this._pttKeydownHandler = (e: KeyboardEvent) => {
      if (e.code === this._pttKey && this.localStream) {
        this.localStream.getAudioTracks().forEach(t => {
          t.enabled = true;
        });
        this.isMuted = false;
      }
    };
    this._pttKeyupHandler = (e: KeyboardEvent) => {
      if (e.code === this._pttKey && this.localStream) {
        this.localStream.getAudioTracks().forEach(t => {
          t.enabled = false;
        });
        this.isMuted = true;
      }
    };

    document.addEventListener('keydown', this._pttKeydownHandler, true);
    document.addEventListener('keyup', this._pttKeyupHandler, true);
  }
}

// =====================================================
// Notification Sound Generation
// =====================================================

const _soundDefs: Record<string, SoundDef> = {
  mute: { type: 'sine', freq: [440, 330], dur: [0.08, 0.12], vol: 0.25 },
  unmute: { type: 'sine', freq: [330, 440], dur: [0.08, 0.12], vol: 0.25 },
  deafen: {
    type: 'sine',
    freq: [880, 660, 440],
    dur: [0.07, 0.07, 0.1],
    vol: 0.22,
  },
  undeafen: {
    type: 'sine',
    freq: [440, 660, 880],
    dur: [0.07, 0.07, 0.1],
    vol: 0.22,
  },
  userJoin: {
    type: 'triangle',
    freq: [523, 659, 784],
    dur: [0.06, 0.06, 0.12],
    vol: 0.2,
  },
  userLeave: {
    type: 'triangle',
    freq: [784, 523],
    dur: [0.07, 0.13],
    vol: 0.18,
  },
  disconnect: {
    type: 'sawtooth',
    freq: [300, 200],
    dur: [0.1, 0.15],
    vol: 0.2,
  },
  dmMessage: {
    type: 'sine',
    freq: [880, 1318, 1760],
    dur: [0.04, 0.04, 0.07],
    vol: 0.2,
  },
  channelMessage: {
    type: 'sine',
    freq: [880, 1318, 1760],
    dur: [0.04, 0.04, 0.07],
    vol: 0.2,
  },
};

function generateNotificationSound(type: string): void {
  const def = _soundDefs[type];
  if (!def) return;

  try {
    const ctx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )();
    const freqs = def.freq;
    const durs = def.dur;
    let t = ctx.currentTime + 0.01;

    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = def.type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(def.vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + durs[i]);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + durs[i]);
      t += durs[i];
    });

    const totalDur = durs.reduce((a, b) => a + b, 0);
    setTimeout(
      () => {
        ctx.close();
      },
      (totalDur + 0.1) * 1000
    );
  } catch (e) {
    console.warn('[Voice] generateNotificationSound failed:', e);
  }
}

// Export to window for use by voice-ui-manager and renderer
(window as unknown as { VoiceManager: typeof VoiceManager }).VoiceManager = VoiceManager;
(
  window as unknown as {
    generateNotificationSound: typeof generateNotificationSound;
  }
).generateNotificationSound = generateNotificationSound;
