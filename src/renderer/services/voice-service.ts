/**
 * Voice service — TypeScript conversion of public/voice.js.
 * Provides the VoiceManager class and notification sound generation.
 */
"use strict";

const _voiceLog: EmberLogger = window.emberLog
  ? window.emberLog.createLogger("Voice")
  : {
      debug: () => {
        /* noop */
      },
      info: () => {
        /* noop */
      },
      warn: (m: string, d?: Record<string, unknown>) =>
        console.warn("[Voice]", m, d ?? ""),
      error: (m: string, d?: Record<string, unknown>) =>
        console.error("[Voice]", m, d ?? ""),
    };

class VoiceManager {
  ws: WebSocket;
  auth: AuthForVoice;
  channelId: string | null;
  peerConnection: RTCPeerConnection | null;
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  audioElements: Map<string, HTMLAudioElement>;
  isMuted: boolean;
  isDeafened: boolean;
  speakingStates: Map<string, boolean>;
  onSpeakingChanged: ((userId: string, isSpeaking: boolean) => void) | null;
  onParticipantsChanged:
    | ((participants: { user_id: string; username: string }[]) => void)
    | null;
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

  constructor(wsConnection: WebSocket, authObj: AuthForVoice) {
    _voiceLog.info("VoiceManager created");
    this.ws = wsConnection;
    this.auth = authObj;
    this.channelId = null;
    this.peerConnection = null;
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
    this._pttKey = "Backquote";
    this._pttKeydownHandler = null;
    this._pttKeyupHandler = null;
  }

  async fetchICEServers(): Promise<void> {
    _voiceLog.debug("Fetching ICE servers");
    try {
      const res = await fetch(
        `${this.auth.hostname}/api/v1/voice/ice-servers`,
        {
          headers: { Authorization: `Bearer ${this.auth.token}` },
        }
      );
      if (res.ok) {
        const data = (await res.json()) as { ice_servers?: ICEServer[] };
        this.iceServers = data.ice_servers ?? [];
        _voiceLog.debug("ICE servers fetched", {
          count: this.iceServers.length,
        });
      } else {
        _voiceLog.warn("ICE server fetch returned non-OK status", {
          status: res.status,
        });
      }
    } catch (e) {
      _voiceLog.warn("Failed to fetch ICE servers, using STUN fallback");
      console.warn("[Voice] Failed to fetch ICE servers, using defaults:", e);
      this.iceServers = [{ urls: ["stun:stun.l.google.com:19302"] }];
    }
  }

  async joinChannel(
    channelId: string,
    audioSettings?: VoiceSettings | null,
    withVideo = false,
    cameraDeviceId: string | null = null
  ): Promise<boolean> {
    if (this.channelId === channelId) {
      _voiceLog.debug("joinChannel: already in this channel", {
        channel_id: channelId,
      });
      return false;
    }
    if (this.channelId) {
      _voiceLog.info("Leaving current voice channel before joining new one", {
        channel_id: this.channelId,
      });
      await this.leaveChannel();
    }

    _voiceLog.info("Joining voice channel", { channel_id: channelId });
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
      _voiceLog.debug("Requesting microphone access");
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: s.echoCancellation !== false,
          noiseSuppression: s.noiseSuppression !== false,
          autoGainControl: s.autoGainControl !== false,
          ...(s.inputDevice && s.inputDevice !== "default"
            ? { deviceId: { exact: s.inputDevice } }
            : {}),
        },
        video: withVideo
          ? cameraDeviceId
            ? { deviceId: { exact: cameraDeviceId } }
            : true
          : false,
      });
      _voiceLog.info("Microphone access granted");
      if (withVideo) {
        this.localVideoStream = this.localStream;
        this.isCameraOn = true;
      }
    } catch (e) {
      _voiceLog.error("Microphone access denied", { error: String(e) });
      console.error("[Voice] Microphone access denied:", e);
      this.channelId = null;
      return false;
    }

    this._setupLocalAudioMonitor();

    // Create peer connection before sending voice_join so we can include the
    // offer in the join message. ion-SFU requires the client to be the offerer.
    _voiceLog.debug("Creating RTCPeerConnection");
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection!.addTrack(track, this.localStream!);
      });
    }

    this.peerConnection.ontrack = (event: RTCTrackEvent) => {
      const stream = event.streams[0];
      if (!stream) return;
      if (event.track.kind === "audio") {
        if (!this.remoteStreams.has(stream.id)) {
          this.remoteStreams.set(stream.id, stream);
          if (!this.isDeafened) this._playRemoteStream(stream.id, stream);
        }
      } else if (event.track.kind === "video") {
        this.remoteVideoStreams.set(stream.id, stream);
        if (this.onVideoStreamAdded) this.onVideoStreamAdded(stream.id, stream);
      }
    };

    this.peerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        this.ws.send(
          JSON.stringify({
            type: "voice_ice_candidate",
            channel_id: this.channelId,
            candidate: event.candidate,
          })
        );
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      _voiceLog.info("Peer connection state changed", {
        state: state ?? "unknown",
      });
      console.log("[Voice] Connection state:", state);
      if (state === "connected" && this.onConnected) {
        const cb = this.onConnected;
        this.onConnected = null;
        cb();
      }
    };

    let offer: RTCSessionDescriptionInit;
    try {
      _voiceLog.debug("Creating WebRTC offer");
      offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
    } catch (e) {
      _voiceLog.error("Failed to create WebRTC offer", { error: String(e) });
      console.error("[Voice] Failed to create offer:", e);
      this._cleanup();
      return false;
    }

    _voiceLog.debug("Sending voice_join to server", { channel_id: channelId });
    this.ws.send(
      JSON.stringify({
        type: "voice_join",
        channel_id: channelId,
        offer: { type: offer.type, sdp: offer.sdp },
      })
    );

    _voiceLog.info("Voice channel join initiated, offer sent", {
      channel_id: channelId,
    });
    return true;
  }

  async leaveChannel(): Promise<void> {
    if (!this.channelId) return;
    _voiceLog.info("Leaving voice channel", { channel_id: this.channelId });
    this.ws.send(JSON.stringify({ type: "voice_leave" }));
    this._cleanup();
    _voiceLog.info("Voice channel left and resources cleaned up");
  }

  _cleanup(): void {
    this.channelId = null;
    this._remoteDescSet = false;
    this._iceQueue = [];
    this.onConnected = null;

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    this.remoteStreams.forEach((stream) =>
      stream.getTracks().forEach((t) => t.stop())
    );
    this.remoteStreams.clear();

    this.audioElements.forEach((el) => {
      el.pause();
      el.srcObject = null;
      el.remove();
    });
    this.audioElements.clear();
    this.speakingStates.clear();

    if (this.localVideoStream) {
      this.localVideoStream.getTracks().forEach((t) => t.stop());
      this.localVideoStream = null;
    }
    this.remoteVideoStreams.forEach((s) =>
      s.getTracks().forEach((t) => t.stop())
    );
    this.remoteVideoStreams.clear();
    this.isCameraOn = false;

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
    _voiceLog.info("Received SFU answer for initial offer");
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(sdp)
    );
    this._remoteDescSet = true;
    if (this._iceQueue.length > 0) {
      _voiceLog.debug("Flushing queued ICE candidates", {
        count: this._iceQueue.length,
      });
      for (const c of this._iceQueue) {
        await this.peerConnection
          .addIceCandidate(new RTCIceCandidate(c))
          .catch(console.warn);
      }
      this._iceQueue = [];
    }
  }

  // handleOffer handles SFU renegotiation offers (sent when another participant
  // joins or leaves). The peer connection already exists at this point.
  async handleOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.channelId || !this.peerConnection) return;
    _voiceLog.info("Received SFU renegotiation offer");
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(sdp)
    );
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    _voiceLog.info("Renegotiation answer sent to server");
    this.ws.send(
      JSON.stringify({
        type: "voice_answer",
        channel_id: this.channelId,
        sdp: answer,
      })
    );
  }

  async handleRemoteICECandidate(
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    if (!this.peerConnection) return;
    if (!this._remoteDescSet) {
      _voiceLog.debug("Queuing ICE candidate (remote description not yet set)");
      this._iceQueue.push(candidate);
      return;
    }
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      _voiceLog.debug("Remote ICE candidate added");
    } catch (e) {
      _voiceLog.warn("Failed to add remote ICE candidate", {
        error: String(e),
      });
      console.warn("[Voice] Failed to add ICE candidate:", e);
    }
  }

  handleSpeakingEvent(
    userId: string,
    _level: number,
    isSpeaking: boolean
  ): void {
    const was = this.speakingStates.get(userId) ?? false;
    if (was !== isSpeaking) {
      this.speakingStates.set(userId, isSpeaking);
      if (this.onSpeakingChanged) this.onSpeakingChanged(userId, isSpeaking);
    }
  }

  handleParticipants(
    participants: { user_id: string; username: string }[]
  ): void {
    if (this.onParticipantsChanged) this.onParticipantsChanged(participants);
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    _voiceLog.info("Microphone toggled", { muted: this.isMuted });
    if (this.localStream)
      this.localStream.getAudioTracks().forEach((t) => {
        t.enabled = !this.isMuted;
      });
    return this.isMuted;
  }

  toggleDeafen(): boolean {
    this.isDeafened = !this.isDeafened;
    _voiceLog.info("Deafen toggled", { deafened: this.isDeafened });
    this.audioElements.forEach((el) => {
      el.muted = this.isDeafened;
    });
    return this.isDeafened;
  }

  _playRemoteStream(id: string, stream: MediaStream): void {
    if (this.audioElements.has(id)) return;
    _voiceLog.debug("Playing remote audio stream", { stream_id: id });
    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.muted = this.isDeafened;
    audio.play().catch((e) => {
      _voiceLog.warn("Remote audio play failed", {
        stream_id: id,
        error: String(e),
      });
      console.warn("[Voice] Audio play failed:", e);
    });
    this.audioElements.set(id, audio);
  }

  _setupLocalAudioMonitor(): void {
    _voiceLog.debug("Setting up local audio monitor");
    try {
      const ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();
      const source = ctx.createMediaStreamSource(this.localStream!);
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
        const speaking =
          level > (this._sensitivityThreshold || 0.08) && !this.isMuted;
        if (speaking !== isSpeakingLocal) {
          isSpeakingLocal = speaking;
          if (this.onSpeakingChanged && this.auth) {
            this.onSpeakingChanged(this.auth.user_id, speaking);
          }
        }
        if (this.channelId) requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    } catch (e) {
      _voiceLog.warn("Local audio monitor setup failed", { error: String(e) });
      console.warn("[Voice] Audio monitor setup failed:", e);
    }
  }

  async enableCamera(cameraDeviceId: string | null): Promise<boolean> {
    if (!this.channelId) return false;
    const channelId = this.channelId;
    _voiceLog.info("Enabling camera, rejoining channel", {
      channel_id: channelId,
    });
    this._partialCleanup();
    return this.joinChannel(
      channelId,
      this._lastAudioSettings,
      true,
      cameraDeviceId
    );
  }

  async disableCamera(): Promise<boolean> {
    if (!this.channelId) return false;
    const channelId = this.channelId;
    _voiceLog.info("Disabling camera, rejoining channel", {
      channel_id: channelId,
    });
    this._partialCleanup();
    return this.joinChannel(channelId, this._lastAudioSettings, false);
  }

  _partialCleanup(): string | null {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.localVideoStream) {
      this.localVideoStream.getTracks().forEach((t) => t.stop());
      this.localVideoStream = null;
    }
    this.remoteVideoStreams.forEach((s) =>
      s.getTracks().forEach((t) => t.stop())
    );
    this.remoteVideoStreams.clear();
    this.remoteStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.remoteStreams.clear();
    this.audioElements.forEach((el) => {
      el.pause();
      el.srcObject = null;
      el.remove();
    });
    this.audioElements.clear();
    this._remoteDescSet = false;
    this._iceQueue = [];
    this.isCameraOn = false;
    const channelId = this.channelId;
    this.channelId = null;
    return channelId;
  }

  handleMessage(msg: { type: string; payload: Record<string, unknown> }): void {
    _voiceLog.debug("WebSocket voice message received", { type: msg.type });
    switch (msg.type) {
      case "voice_answer": {
        // Answer from SFU to our initial join offer — set remote description.
        const raw = msg.payload["sdp"] as Record<string, unknown>;
        if (
          raw &&
          typeof raw["type"] === "string" &&
          typeof raw["sdp"] === "string"
        ) {
          this.handleJoinAnswer({
            type: raw["type"] as RTCSdpType,
            sdp: raw["sdp"],
          });
        } else {
          _voiceLog.error("voice_answer received with invalid sdp payload", {
            payload: JSON.stringify(raw),
          });
        }
        break;
      }
      case "voice_offer": {
        // Renegotiation offer from SFU (another participant joined/left).
        const raw = msg.payload["sdp"] as Record<string, unknown>;
        if (
          raw &&
          typeof raw["type"] === "string" &&
          typeof raw["sdp"] === "string"
        ) {
          this.handleOffer({
            type: raw["type"] as RTCSdpType,
            sdp: raw["sdp"],
          });
        } else {
          _voiceLog.error("voice_offer received with invalid sdp payload", {
            payload: JSON.stringify(raw),
          });
        }
        break;
      }
      case "voice_ice_candidate":
        this.handleRemoteICECandidate(
          msg.payload["candidate"] as RTCIceCandidateInit
        );
        break;
      case "voice_speaking":
        this.handleSpeakingEvent(
          String(msg.payload["user_id"] ?? ""),
          Number(msg.payload["level"] ?? 0),
          Boolean(msg.payload["is_speaking"])
        );
        break;
      case "voice_participants":
        _voiceLog.debug("Voice participants update", {
          count: ((msg.payload["participants"] as unknown[]) ?? []).length,
        });
        this.handleParticipants(
          msg.payload["participants"] as { user_id: string; username: string }[]
        );
        break;
      case "voice_camera_on":
        if (this.onCameraStateChanged)
          this.onCameraStateChanged(String(msg.payload["user_id"] ?? ""), true);
        break;
      case "voice_camera_off":
        if (this.onCameraStateChanged)
          this.onCameraStateChanged(
            String(msg.payload["user_id"] ?? ""),
            false
          );
        break;
    }
  }

  applySettings(settings: VoiceSettings): void {
    if (!settings) return;

    if (typeof settings.outputVolume === "number") {
      const vol = settings.outputVolume / 100;
      this.audioElements.forEach((el) => {
        el.volume = vol;
      });
    }

    if (this._gainNode && typeof settings.inputVolume === "number") {
      this._gainNode.gain.value = settings.inputVolume / 100;
    }

    if (this.localStream) {
      const constraints = {
        echoCancellation: settings.echoCancellation !== false,
        noiseSuppression: settings.noiseSuppression !== false,
        autoGainControl: settings.autoGainControl !== false,
      };
      this.localStream.getAudioTracks().forEach((t) => {
        t.applyConstraints(constraints).catch((e) =>
          console.warn("[Voice] applyConstraints failed:", e)
        );
      });
    }

    this._sensitivityThreshold =
      settings.autoSensitivity === false
        ? settings.sensitivityThreshold != null
          ? settings.sensitivityThreshold / 100
          : 0.08
        : 0.08;

    if (typeof settings.pushToTalk === "boolean") {
      this.setPushToTalk(settings.pushToTalk, settings.pttKey ?? "Backquote");
    }
  }

  setSpeakerDevice(deviceId: string): void {
    if (!deviceId || deviceId === "default") return;
    this.audioElements.forEach((el) => {
      if (
        typeof (
          el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
        ).setSinkId === "function"
      ) {
        (el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
          .setSinkId(deviceId)
          .catch((e) => console.warn("[Voice] setSinkId failed:", e));
      }
    });
  }

  setPushToTalk(enabled: boolean, key: string): void {
    if (this._pttKeydownHandler) {
      document.removeEventListener("keydown", this._pttKeydownHandler, true);
      this._pttKeydownHandler = null;
    }
    if (this._pttKeyupHandler) {
      document.removeEventListener("keyup", this._pttKeyupHandler, true);
      this._pttKeyupHandler = null;
    }

    this._pttEnabled = enabled;
    this._pttKey = key || "Backquote";

    if (!enabled) return;

    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((t) => {
        t.enabled = false;
      });
      this.isMuted = true;
    }

    this._pttKeydownHandler = (e: KeyboardEvent) => {
      if (e.code === this._pttKey && this.localStream) {
        this.localStream.getAudioTracks().forEach((t) => {
          t.enabled = true;
        });
        this.isMuted = false;
      }
    };
    this._pttKeyupHandler = (e: KeyboardEvent) => {
      if (e.code === this._pttKey && this.localStream) {
        this.localStream.getAudioTracks().forEach((t) => {
          t.enabled = false;
        });
        this.isMuted = true;
      }
    };

    document.addEventListener("keydown", this._pttKeydownHandler, true);
    document.addEventListener("keyup", this._pttKeyupHandler, true);
  }
}

// =====================================================
// Notification Sound Generation
// =====================================================

const _soundDefs: Record<string, SoundDef> = {
  mute: { type: "sine", freq: [440, 330], dur: [0.08, 0.12], vol: 0.25 },
  unmute: { type: "sine", freq: [330, 440], dur: [0.08, 0.12], vol: 0.25 },
  deafen: {
    type: "sine",
    freq: [880, 660, 440],
    dur: [0.07, 0.07, 0.1],
    vol: 0.22,
  },
  undeafen: {
    type: "sine",
    freq: [440, 660, 880],
    dur: [0.07, 0.07, 0.1],
    vol: 0.22,
  },
  userJoin: {
    type: "triangle",
    freq: [523, 659, 784],
    dur: [0.06, 0.06, 0.12],
    vol: 0.2,
  },
  userLeave: {
    type: "triangle",
    freq: [784, 523],
    dur: [0.07, 0.13],
    vol: 0.18,
  },
  disconnect: {
    type: "sawtooth",
    freq: [300, 200],
    dur: [0.1, 0.15],
    vol: 0.2,
  },
};

function generateNotificationSound(type: string): void {
  const def = _soundDefs[type];
  if (!def) return;

  try {
    const ctx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
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
    console.warn("[Voice] generateNotificationSound failed:", e);
  }
}

// Export to window for use by voice-ui-manager and renderer
(window as unknown as { VoiceManager: typeof VoiceManager }).VoiceManager =
  VoiceManager;
(
  window as unknown as {
    generateNotificationSound: typeof generateNotificationSound;
  }
).generateNotificationSound = generateNotificationSound;
