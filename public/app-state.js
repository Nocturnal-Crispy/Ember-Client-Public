// Shared mutable state for the Ember renderer.
// Loaded before all feature modules so each module can reference App.X.
// No logic here — just declarations.

window.App = {
  // ── Messaging / channel ──────────────────────────────────────────────────
  activeChannelId: null,
  activeEmberId: null,
  emberKeyCache: new Map(),     // ember_id → Uint8Array symmetric key

  // ── Server list ──────────────────────────────────────────────────────────
  currentEmbers: [],            // [{id, name, icon_data, …}]
  currentMembers: [],           // [{user_id, username, status, role}]

  // ── WebSocket ────────────────────────────────────────────────────────────
  wsConnection: null,           // WebSocket instance
  wsReconnectTimer: null,       // setTimeout handle

  // ── Voice ────────────────────────────────────────────────────────────────
  voiceManager: null,           // VoiceManager instance
  activeVoiceChannelId: null,
  voiceParticipants: new Map(), // user_id → username

  // ── Camera / video ───────────────────────────────────────────────────────
  videoParticipants: new Set(), // user_ids with camera on (+ '__self__')
  localCameraOn: false,
  videoGridVisible: false,

  // ── Health check / reconnection ──────────────────────────────────────────
  healthcheckInterval: null,
  reconnectionTimeout: null,
  reconnectionStartTime: null,
  reconnectionTimerInterval: null,

  // ── Channel context menu / modal ─────────────────────────────────────────
  dragItem: null,               // {type: 'channel'|'category', id}
  contextMenuTarget: null,      // target object for the context menu
  channelModalMode: null,       // 'create-text' | 'create-voice' | 'edit-channel' | etc.
  channelModalTargetId: null,
  channelModalCategoryId: null,

  // ── Create-server modal ──────────────────────────────────────────────────
  currentIconData: null,        // base64 data URL or remote URL string
  currentIconSource: 'upload',  // 'upload' | 'url'

  // ── Invite ───────────────────────────────────────────────────────────────
  pendingInvite: null,          // invite info object shown in accept modal

  // ── Voice & Video settings ───────────────────────────────────────────────
  _vvSounds: null,              // sounds config object (cached from store)
  _micTestStream: null,         // MediaStream for mic test
  _micTestAnimFrame: null,      // requestAnimationFrame handle
  _cameraPreviewStream: null,   // MediaStream for camera preview
  _pttListening: false,         // true while capturing PTT keybind
};
