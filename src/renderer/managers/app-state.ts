/**
 * App state manager — TypeScript conversion of public/app-state.js.
 * Shared mutable state for the Ember renderer.
 * Loaded before all feature modules so each module can reference App.X.
 */
window.App = {
  // ── Messaging / channel ──────────────────────────────────────────────────
  activeChannelId: null,
  activeEmberId: null,
  ownedMessageIds: new Set<string>(),

  // ── Server list ──────────────────────────────────────────────────────────
  currentEmbers: [],
  currentMembers: [],

  // ── Permission system ──────────────────────────────────────────────────
  currentRoles: [] as import('../../shared/types/permission').Role[],
  myPermissions: 0n,

  // ── WebSocket ────────────────────────────────────────────────────────────
  wsConnection: null,
  wsReconnectTimer: null,

  // ── Voice ────────────────────────────────────────────────────────────────
  voiceManager: null,
  activeVoiceChannelId: null,
  activeVoiceChannelName: null,
  voiceParticipants: new Map<string, string>(),
  voiceChannelPresence: new Map<string, Map<string, string>>(),

  // ── Camera / video ───────────────────────────────────────────────────────
  videoParticipants: new Set<string>(),
  localCameraOn: false,
  videoGridVisible: false,
  activeView: 'text' as 'text' | 'voice',

  // ── Screen share ─────────────────────────────────────────────────────────
  localScreenShareOn: false,
  screenShareParticipants: new Set<string>(),
  videoPopoutOpen: false,
  focusedTileId: null,
  lastScreenShareUserId: null,

  // ── Health check / reconnection ──────────────────────────────────────────
  healthcheckInterval: null,
  reconnectionTimeout: null,
  reconnectionStartTime: null,
  reconnectionTimerInterval: null,

  // ── Channel context menu / modal ─────────────────────────────────────────
  dragItem: null,
  contextMenuTarget: null,
  channelModalMode: null,
  channelModalTargetId: null,
  channelModalCategoryId: null,

  // ── Create-server modal ──────────────────────────────────────────────────
  currentIconData: null,
  currentIconSource: 'upload',

  // ── Invite ───────────────────────────────────────────────────────────────
  pendingInvite: null,

  // ── Signal Protocol ───────────────────────────────────────────────────────
  signalSessionReady: new Map<string, boolean>(),
  signalSessionManager: null as any,
  historyCryptoService: null as any,

  // ── Signal Session Manager Initialization ───────────────────────────────
  async initializeSignalSessionManager(): Promise<void> {
    if (this.signalSessionManager) {
      console.warn('[App] SignalSessionManager already initialized');
      return;
    }

    const ssmLog = window.emberLog?.createLogger('AppSSM');
    try {
      const auth = await window.getValidAuth?.();
      if (!auth || !auth.token || !auth.hostname || !auth.userId || !auth.deviceId) {
        throw new Error('Not authenticated - cannot initialize SignalSessionManager');
      }

      if (typeof (window as any).SignalSessionManager === 'undefined') {
        ssmLog?.warn('SignalSessionManager class not yet available');
        this.signalSessionManager = null;
        return;
      }

      this.signalSessionManager = new (window as any).SignalSessionManager(auth);
      ssmLog?.info('SignalSessionManager initialized successfully');

      // Upload signed prekey + one-time prekeys if not already on server
      try {
        const countResp = await fetch(`${auth.hostname}/api/v1/prekeys/one-time/count`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        const countData = countResp.ok ? await countResp.json() : { count: 0 };
        if (countData.count === 0) {
          ssmLog?.debug('No prekeys on server, uploading...');
          const identity = (await window.electronAPI.ipc.invoke('get-device-identity')) as any;
          if (identity?.signedPreKey) {
            const spk = identity.signedPreKey;
            await fetch(`${auth.hostname}/api/v1/prekeys/signed`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${auth.token}`,
              },
              body: JSON.stringify({
                id: spk.id,
                publicKey: btoa(String.fromCharCode(...new Uint8Array(spk.keyPair.publicKey))),
                signature: btoa(String.fromCharCode(...new Uint8Array(spk.signature))),
                timestamp: spk.timestamp,
              }),
            });
            ssmLog?.info('Signed prekey uploaded');
          }
          if (identity?.oneTimePreKeys?.length > 0) {
            const otpks = identity.oneTimePreKeys.map((pk: any) => ({
              id: pk.id,
              publicKey: btoa(String.fromCharCode(...new Uint8Array(pk.keyPair.publicKey))),
            }));
            await fetch(`${auth.hostname}/api/v1/prekeys/one-time`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${auth.token}`,
              },
              body: JSON.stringify(otpks),
            });
            ssmLog?.info('One-time prekeys uploaded', { count: otpks.length });
          }
        } else {
          ssmLog?.debug('Prekeys already on server', { count: countData.count });
        }
      } catch (prekeyErr) {
        ssmLog?.warn('Prekey upload failed', { error: (prekeyErr as Error).message });
      }
    } catch (error) {
      ssmLog?.error('Failed to initialize SignalSessionManager', {
        error: (error as Error).message,
      });
      this.signalSessionManager = null;
    }

    try {
      const auth = await window.getValidAuth?.();
      if (auth && typeof (window as any).HistoryCryptoService !== 'undefined') {
        this.historyCryptoService = new (window as any).HistoryCryptoService(auth);
        (window as any).historyCryptoService = this.historyCryptoService;
        ssmLog?.info('HistoryCryptoService initialized successfully');
      } else {
        ssmLog?.warn('HistoryCryptoService not initialized', {
          hasAuth: !!auth,
          hasClass: typeof (window as any).HistoryCryptoService,
        });
      }
    } catch (historyError) {
      ssmLog?.warn('HistoryCryptoService init failed', { error: (historyError as Error).message });
    }
  },

  // ── Attachment composer ───────────────────────────────────────────────────
  pendingAttachment: null,

  // ── GIF favorites ────────────────────────────────────────────────────────
  gifFavorites: [] as GifFavorite[],

  // ── Voice & Video settings ───────────────────────────────────────────────
  _vvSounds: null,
  _micTestStream: null,
  _micTestAnimFrame: null,
  _cameraPreviewStream: null,
  _pttListening: false,
};
