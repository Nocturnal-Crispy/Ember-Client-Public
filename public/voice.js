'use strict';

const _voiceLog = window.emberLog ? window.emberLog.createLogger('Voice') : {
  debug: () => {}, info: () => {}, warn: (m, d) => console.warn('[Voice]', m, d || ''), error: (m, d) => console.error('[Voice]', m, d || ''),
};

class VoiceManager {
  constructor(wsConnection, authObj) {
    _voiceLog.info('VoiceManager created');
    this.ws = wsConnection;
    this.auth = authObj;
    this.channelId = null;
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStreams = new Map(); // userID → MediaStream
    this.audioElements = new Map(); // userID → HTMLAudioElement
    this.isMuted = false;
    this.isDeafened = false;
    this.speakingStates = new Map(); // userID → bool
    this.onSpeakingChanged = null; // callback(userId, isSpeaking)
    this.onParticipantsChanged = null; // callback(participants)
    this.iceServers = [];
    this._iceQueue = []; // ICE candidates queued before remote description
    this._remoteDescSet = false;
    this.localVideoStream = null;
    this.remoteVideoStreams = new Map(); // streamId → MediaStream (video tracks)
    this.isCameraOn = false;
    this.onCameraStateChanged = null; // callback(userId, isOn)
    this.onVideoStreamAdded = null;   // callback(streamId, stream)
    this._lastAudioSettings = {};
  }

  async fetchICEServers() {
    _voiceLog.debug('Fetching ICE servers');
    try {
      const res = await fetch(`${this.auth.hostname}/api/v1/voice/ice-servers`, {
        headers: { 'Authorization': `Bearer ${this.auth.token}` }
      });
      if (res.ok) {
        const data = await res.json();
        this.iceServers = data.ice_servers || [];
        _voiceLog.debug('ICE servers fetched', { count: this.iceServers.length });
      } else {
        _voiceLog.warn('ICE server fetch returned non-OK status', { status: res.status });
      }
    } catch (e) {
      _voiceLog.warn('Failed to fetch ICE servers, using STUN fallback');
      console.warn('[Voice] Failed to fetch ICE servers, using defaults:', e);
      this.iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    }
  }

  async joinChannel(channelId, audioSettings, withVideo = false, cameraDeviceId = null) {
    if (this.channelId === channelId) {
      _voiceLog.debug('joinChannel: already in this channel', { channel_id: channelId });
      return;
    }
    if (this.channelId) {
      _voiceLog.info('Leaving current voice channel before joining new one', { channel_id: this.channelId });
      await this.leaveChannel();
    }

    _voiceLog.info('Joining voice channel', { channel_id: channelId });
    this.channelId = channelId;
    await this.fetchICEServers();

    const s = audioSettings || {};
    this._lastAudioSettings = audioSettings || {};
    this._sensitivityThreshold = (s.autoSensitivity === false)
      ? (s.sensitivityThreshold != null ? s.sensitivityThreshold / 100 : 0.08)
      : 0.08;

    // Request microphone access
    try {
      _voiceLog.debug('Requesting microphone access');
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: s.echoCancellation !== false,
          noiseSuppression: s.noiseSuppression !== false,
          autoGainControl: s.autoGainControl !== false,
          ...(s.inputDevice && s.inputDevice !== 'default' ? { deviceId: { exact: s.inputDevice } } : {}),
        },
        video: withVideo
          ? (cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true)
          : false
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

    // Set up local audio level detection
    this._setupLocalAudioMonitor();

    // Tell server we're joining
    _voiceLog.debug('Sending voice_join to server', { channel_id: channelId });
    this.ws.send(JSON.stringify({
      type: 'voice_join',
      channel_id: channelId
    }));

    _voiceLog.info('Voice channel join complete', { channel_id: channelId });
    return true;
  }

  async leaveChannel() {
    if (!this.channelId) return;

    _voiceLog.info('Leaving voice channel', { channel_id: this.channelId });
    this.ws.send(JSON.stringify({ type: 'voice_leave' }));

    this._cleanup();
    _voiceLog.info('Voice channel left and resources cleaned up');
  }

  _cleanup() {
    this.channelId = null;
    this._remoteDescSet = false;
    this._iceQueue = [];

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    this.remoteStreams.forEach((stream, uid) => {
      stream.getTracks().forEach(t => t.stop());
    });
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

    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
      this._analyser = null;
      this._localMonitorInterval = null;
    }
  }

  // Called when the server sends a voice_offer (SFU → server → client)
  async handleOffer(sdp) {
    if (!this.channelId) return;

    _voiceLog.info('Received WebRTC offer from server, creating peer connection');
    this.peerConnection = new RTCPeerConnection({ iceServers: this.iceServers });

    // Add local audio tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle incoming tracks from SFU (audio and video)
    this.peerConnection.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      if (event.track.kind === 'audio') {
        const streamId = stream.id;
        if (!this.remoteStreams.has(streamId)) {
          this.remoteStreams.set(streamId, stream);
          if (!this.isDeafened) {
            this._playRemoteStream(streamId, stream);
          }
        }
      } else if (event.track.kind === 'video') {
        this.remoteVideoStreams.set(stream.id, stream);
        if (this.onVideoStreamAdded) this.onVideoStreamAdded(stream.id, stream);
      }
    };

    // ICE candidate handler - send to server → ion-sfu
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws.send(JSON.stringify({
          type: 'voice_ice_candidate',
          channel_id: this.channelId,
          candidate: event.candidate
        }));
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      _voiceLog.info('Peer connection state changed', { state });
      console.log('[Voice] Connection state:', state);
    };

    // Set remote description (SFU's offer)
    _voiceLog.debug('Setting remote description from SFU offer');
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    this._remoteDescSet = true;

    // Flush queued ICE candidates
    if (this._iceQueue.length > 0) {
      _voiceLog.debug('Flushing queued ICE candidates', { count: this._iceQueue.length });
      for (const c of this._iceQueue) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
      }
    }
    this._iceQueue = [];

    // Create and send answer
    _voiceLog.debug('Creating WebRTC answer');
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    _voiceLog.info('WebRTC answer created and sent to server');
    this.ws.send(JSON.stringify({
      type: 'voice_answer',
      channel_id: this.channelId,
      sdp: answer
    }));
  }

  // Called when the server sends a voice_ice_candidate (SFU → server → client)
  async handleRemoteICECandidate(candidate) {
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
      _voiceLog.warn('Failed to add remote ICE candidate', { error: String(e) });
      console.warn('[Voice] Failed to add ICE candidate:', e);
    }
  }

  // Called when server sends voice_speaking
  handleSpeakingEvent(userId, level, isSpeaking) {
    const was = this.speakingStates.get(userId) || false;
    if (was !== isSpeaking) {
      this.speakingStates.set(userId, isSpeaking);
      if (this.onSpeakingChanged) {
        this.onSpeakingChanged(userId, isSpeaking);
      }
    }
  }

  // Called when server sends voice_participants
  handleParticipants(participants) {
    if (this.onParticipantsChanged) {
      this.onParticipantsChanged(participants);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    _voiceLog.info('Microphone toggled', { muted: this.isMuted });
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => {
        t.enabled = !this.isMuted;
      });
    }
    return this.isMuted;
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    _voiceLog.info('Deafen toggled', { deafened: this.isDeafened });
    // Mute all remote audio elements
    this.audioElements.forEach(el => {
      el.muted = this.isDeafened;
    });
    return this.isDeafened;
  }

  _playRemoteStream(id, stream) {
    if (this.audioElements.has(id)) return;
    _voiceLog.debug('Playing remote audio stream', { stream_id: id });
    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.muted = this.isDeafened;
    audio.play().catch(e => {
      _voiceLog.warn('Remote audio play failed', { stream_id: id, error: String(e) });
      console.warn('[Voice] Audio play failed:', e);
    });
    this.audioElements.set(id, audio);
  }

  // Monitor local mic audio level and emit speaking events locally
  _setupLocalAudioMonitor() {
    _voiceLog.debug('Setting up local audio monitor');
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaStreamSource(this.localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      this._audioCtx = ctx;
      this._analyser = analyser;

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
          // Emit local speaking indicator immediately (don't wait for server)
          if (this.onSpeakingChanged && this.auth) {
            this.onSpeakingChanged(this.auth.userId, speaking);
          }
        }
        if (this.channelId) {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame(check);
    } catch (e) {
      _voiceLog.warn('Local audio monitor setup failed', { error: String(e) });
      console.warn('[Voice] Audio monitor setup failed:', e);
    }
  }

  // Partial cleanup (no voice_leave) then rejoin with camera enabled
  async enableCamera(cameraDeviceId) {
    if (!this.channelId) return false;
    const channelId = this.channelId;
    _voiceLog.info('Enabling camera, rejoining channel', { channel_id: channelId });
    this._partialCleanup();
    return await this.joinChannel(channelId, this._lastAudioSettings, true, cameraDeviceId);
  }

  // Partial cleanup (no voice_leave) then rejoin without camera
  async disableCamera() {
    if (!this.channelId) return false;
    const channelId = this.channelId;
    _voiceLog.info('Disabling camera, rejoining channel', { channel_id: channelId });
    this._partialCleanup();
    return await this.joinChannel(channelId, this._lastAudioSettings, false);
  }

  // Close WebRTC and streams without sending voice_leave
  _partialCleanup() {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
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
    this.audioElements.forEach(el => { el.pause(); el.srcObject = null; el.remove(); });
    this.audioElements.clear();
    this._remoteDescSet = false;
    this._iceQueue = [];
    this.isCameraOn = false;
    const channelId = this.channelId;
    this.channelId = null; // allow joinChannel to re-run
    return channelId;
  }

  // Handle incoming WS messages related to voice
  handleMessage(msg) {
    _voiceLog.debug('WebSocket voice message received', { type: msg.type });
    switch (msg.type) {
      case 'voice_offer':
        this.handleOffer(msg.payload.sdp);
        break;
      case 'voice_ice_candidate':
        this.handleRemoteICECandidate(msg.payload.candidate);
        break;
      case 'voice_speaking':
        this.handleSpeakingEvent(msg.payload.user_id, msg.payload.level, msg.payload.is_speaking);
        break;
      case 'voice_participants':
        _voiceLog.debug('Voice participants update', { count: (msg.payload.participants || []).length });
        this.handleParticipants(msg.payload.participants);
        break;
      case 'voice_camera_on':
        if (this.onCameraStateChanged) this.onCameraStateChanged(msg.payload.user_id, true);
        break;
      case 'voice_camera_off':
        if (this.onCameraStateChanged) this.onCameraStateChanged(msg.payload.user_id, false);
        break;
    }
  }

  // Apply saved Voice & Video settings to an active session
  applySettings(settings) {
    if (!settings) return;

    // Output volume
    if (typeof settings.outputVolume === 'number') {
      const vol = settings.outputVolume / 100;
      this.audioElements.forEach(el => { el.volume = vol; });
    }

    // Input gain via Web Audio (if monitor context exists)
    if (this._gainNode && typeof settings.inputVolume === 'number') {
      this._gainNode.gain.value = settings.inputVolume / 100;
    }

    // Audio processing constraints on the live mic track
    if (this.localStream) {
      const constraints = {
        echoCancellation: settings.echoCancellation !== false,
        noiseSuppression: settings.noiseSuppression !== false,
        autoGainControl: settings.autoGainControl !== false,
      };
      this.localStream.getAudioTracks().forEach(t => {
        t.applyConstraints(constraints).catch(e => console.warn('[Voice] applyConstraints failed:', e));
      });
    }

    // Input sensitivity threshold
    this._sensitivityThreshold = (settings.autoSensitivity === false)
      ? (settings.sensitivityThreshold != null ? settings.sensitivityThreshold / 100 : 0.08)
      : 0.08;

    // Push-to-talk
    if (typeof settings.pushToTalk === 'boolean') {
      this.setPushToTalk(settings.pushToTalk, settings.pttKey || 'Backquote');
    }
  }

  // Set the output device on all current audio elements
  setSpeakerDevice(deviceId) {
    if (!deviceId || deviceId === 'default') return;
    this.audioElements.forEach(el => {
      if (typeof el.setSinkId === 'function') {
        el.setSinkId(deviceId).catch(e => console.warn('[Voice] setSinkId failed:', e));
      }
    });
  }

  // Configure push-to-talk mode
  setPushToTalk(enabled, key) {
    // Remove existing PTT listeners
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

    // When PTT is active, mute mic until key is held
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => { t.enabled = false; });
      this.isMuted = true;
    }

    this._pttKeydownHandler = (e) => {
      if (e.code === this._pttKey && this.localStream) {
        this.localStream.getAudioTracks().forEach(t => { t.enabled = true; });
        this.isMuted = false;
      }
    };
    this._pttKeyupHandler = (e) => {
      if (e.code === this._pttKey && this.localStream) {
        this.localStream.getAudioTracks().forEach(t => { t.enabled = false; });
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

const _soundDefs = {
  mute: { type: 'sine', freq: [440, 330], dur: [0.08, 0.12], vol: 0.25 },
  unmute: { type: 'sine', freq: [330, 440], dur: [0.08, 0.12], vol: 0.25 },
  deafen: { type: 'sine', freq: [880, 660, 440], dur: [0.07, 0.07, 0.1], vol: 0.22 },
  undeafen: { type: 'sine', freq: [440, 660, 880], dur: [0.07, 0.07, 0.1], vol: 0.22 },
  userJoin: { type: 'triangle', freq: [523, 659, 784], dur: [0.06, 0.06, 0.12], vol: 0.2 },
  userLeave: { type: 'triangle', freq: [784, 523], dur: [0.07, 0.13], vol: 0.18 },
  disconnect: { type: 'sawtooth', freq: [300, 200], dur: [0.1, 0.15], vol: 0.2 },
};

function generateNotificationSound(type) {
  const def = _soundDefs[type];
  if (!def) return;

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const freqs = def.freq;
    const durs = def.dur;
    let t = ctx.currentTime + 0.01;

    freqs.forEach(function(freq, i) {
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

    // Close context after all tones finish
    const totalDur = durs.reduce(function(a, b) { return a + b; }, 0);
    setTimeout(function() { ctx.close(); }, (totalDur + 0.1) * 1000);
  } catch (e) {
    console.warn('[Voice] generateNotificationSound failed:', e);
  }
}
