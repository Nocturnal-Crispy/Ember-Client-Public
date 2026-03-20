/**
 * App state manager — TypeScript conversion of public/app-state.js.
 * Shared mutable state for the Ember renderer.
 * Loaded before all feature modules so each module can reference App.X.
 */
window.App = {
  // ── Messaging / channel ──────────────────────────────────────────────────
  activeChannelId: null,
  activeEmberId: null,
  emberKeyCache: new Map<string, Uint8Array>(),
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
  activeView: "text" as "text" | "voice",

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
  currentIconSource: "upload",

  // ── Invite ───────────────────────────────────────────────────────────────
  pendingInvite: null,

  // ── Ember metadata ──────────────────────────────────────────────────────
  emberMetadata: new Map<string, { protocol_version: number }>(),

  // ── Signal Protocol ───────────────────────────────────────────────────────
  signalSessionReady: new Map<string, boolean>(),
  signalSessionManager: null as any,
  protocolVersion: 0 as number,
  migrationStatus: 'idle' as 'idle' | 'in-progress' | 'complete' | 'failed',

  // ── Signal Session Manager Initialization ───────────────────────────────
  initializeSignalSessionManager: async function(): Promise<void> {
    if (this.signalSessionManager) {
      console.warn('[App] SignalSessionManager already initialized');
      return;
    }

    try {
      const auth = await window.getValidAuth?.();
      if (!auth || !auth.token || !auth.hostname || !auth.user_id || !auth.device_id) {
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
      // Don't throw - allow app to continue without Signal functionality
      console.warn('[App] Continuing without Signal encryption - messages will not be encrypted');
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
