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

    try {
      const auth = await window.getValidAuth?.();
      if (!auth || !auth.token || !auth.hostname || !auth.userId || !auth.deviceId) {
        throw new Error('Not authenticated - cannot initialize SignalSessionManager');
      }

      // Import and initialize SignalSessionManager using global reference
      // Since dependencies are loaded in order, SignalSessionManager should be available globally
      if (typeof (window as any).SignalSessionManager === 'undefined') {
        console.warn('[App] SignalSessionManager not yet available, deferring initialization...');
        this.signalSessionManager = null;
        return; // Don't throw - just defer initialization
      }

      this.signalSessionManager = new (window as any).SignalSessionManager(auth);
      console.log('[App] SignalSessionManager initialized successfully');
    } catch (error) {
      console.error('[App] Failed to initialize SignalSessionManager:', error);
      this.signalSessionManager = null;
      console.warn('[App] Continuing without Signal encryption - messages will not be encrypted');
    }

    // Initialize HistoryCryptoService for Layer 2 history key encryption.
    // Independent of SignalSessionManager — uses its own auth handling.
    try {
      const auth = await window.getValidAuth?.();
      if (auth && typeof (window as any).HistoryCryptoService !== 'undefined') {
        this.historyCryptoService = new (window as any).HistoryCryptoService(auth);
        (window as any).historyCryptoService = this.historyCryptoService;
        console.log('[App] HistoryCryptoService initialized successfully');
      }
    } catch (historyError) {
      console.warn('[App] HistoryCryptoService initialization failed:', historyError);
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
