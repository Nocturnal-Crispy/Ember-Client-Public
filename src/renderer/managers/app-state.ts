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
