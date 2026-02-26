/**
 * Global type declarations for the Ember renderer process.
 * Extends Window with custom APIs exposed by the preload bridge and module globals.
 * All domain types are declared here as globals so renderer scripts need no import statements
 * (which would cause TypeScript to emit CommonJS module boilerplate incompatible with plain <script> tags).
 */

// ─── Domain types (ember, channel, member) ────────────────────────────────────

interface Ember {
  id: string;
  name: string;
  icon_data?: string | null;
  owner_id?: string;
}

interface Channel {
  id: string;
  ember_id: string;
  name: string;
  type: 'text' | 'voice';
  category_id?: string | null;
  description?: string;
  position?: number;
}

interface Category {
  id: string;
  ember_id: string;
  name: string;
  position?: number;
}

interface Member {
  user_id: string;
  username: string;
  status: string;
  role: 'owner' | 'admin' | 'member';
}

interface ChannelReorderUpdate {
  id: string;
  position: number;
  category_id?: string | null;
}

interface CategoryReorderUpdate {
  id: string;
  position: number;
}

interface DragItem {
  type: 'channel' | 'category';
  id: string;
}

interface ContextMenuTarget {
  type: 'channel' | 'category' | 'empty';
  id: string | null;
  name: string | null;
  channelType: 'text' | 'voice' | null;
  categoryId: string | null;
  description?: string;
}

// ─── Auth types ───────────────────────────────────────────────────────────────

interface AuthData {
  token: string;
  user_id: string;
  device_id: string;
  hostname: string;
  username: string;
}

interface DeviceIdentity {
  device_id: string;
  public_key: string;
  private_key: string;
}

interface RegistrationPayload {
  username: string;
  password: string;
  device_id: string;
  public_key: string;
  encrypted_device_key: string;
  salt: string;
}

interface LoginPayload {
  username: string;
  password: string;
  device_id: string;
}

interface AuthResponse extends AuthData {
  _recoveryCode?: string;
}

interface RecoveryData {
  encrypted: string;
  salt: string;
}

// ─── Message types ────────────────────────────────────────────────────────────

interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_user_id: string;
  username?: string;
  ciphertext: string;
  created_at?: number;
}

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
  channel_id?: string;
  ember_id?: string;
  candidate?: RTCIceCandidateInit;
  sdp?: RTCSessionDescriptionInit;
}

interface PresenceUpdatePayload {
  user_id: string;
  username: string;
  status: string;
}

interface LogPayload {
  level: string;
  context: string;
  message: string;
  data: Record<string, unknown> | null;
}

// ─── Voice types ──────────────────────────────────────────────────────────────

type SoundType = 'mute' | 'unmute' | 'deafen' | 'undeafen' | 'userJoin' | 'userLeave' | 'disconnect';
type OscillatorType = 'sine' | 'triangle' | 'sawtooth' | 'square';

interface VoiceSettings {
  inputDevice?: string;
  outputDevice?: string;
  inputVolume?: number;
  outputVolume?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  autoSensitivity?: boolean;
  sensitivityThreshold?: number;
  pushToTalk?: boolean;
  pttKey?: string;
  cameraDevice?: string;
  alwaysPreviewVideo?: boolean;
  sounds?: Partial<Record<SoundType, boolean>>;
}

interface VoiceParticipant {
  user_id: string;
  username: string;
}

interface ICEServer {
  urls: string[];
  username?: string;
  credential?: string;
}

interface AuthForVoice {
  token: string;
  hostname: string;
  user_id: string;
  username: string;
}

interface SoundDef {
  type: OscillatorType;
  freq: number[];
  dur: number[];
  vol: number;
}

// ─── Electron bridge APIs ─────────────────────────────────────────────────────

interface EmberLogger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

interface EmberLogAPI {
  createLogger(context: string): EmberLogger;
}

interface NaClAPI {
  randomBytes(n: number): Uint8Array;
  box(msg: Uint8Array, nonce: Uint8Array, theirPk: Uint8Array, mysk: Uint8Array): Uint8Array;
  boxOpen(box: Uint8Array, nonce: Uint8Array, theirPk: Uint8Array, mysk: Uint8Array): Uint8Array | null;
  boxKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
  secretbox(msg: Uint8Array, nonce: Uint8Array, k: Uint8Array): Uint8Array;
  secretboxOpen(box: Uint8Array, nonce: Uint8Array, k: Uint8Array): Uint8Array | null;
  BOX_NONCE_LENGTH: number;
  SECRETBOX_NONCE_LENGTH: number;
  SECRETBOX_KEY_LENGTH: number;
}

interface NaClUtilAPI {
  encodeBase64(data: Uint8Array): string;
  decodeBase64(str: string): Uint8Array;
  encodeUTF8(data: Uint8Array): string;
  decodeUTF8(str: string): Uint8Array;
}

interface EmberCryptoAPI {
  generateRecoveryCode(): string;
  encryptPrivateKeyWithRecoveryCode(privateKey: Uint8Array, recoveryCode: string): Promise<{ encrypted: string; salt: string }>;
  decryptPrivateKeyWithRecoveryCode(encryptedBase64: string, recoveryCode: string, saltBase64: string): Promise<Uint8Array | null>;
  generateEmberKey(): Uint8Array;
  encryptEmberKeyForUser(emberKey: Uint8Array, recipientPublicKey: Uint8Array, senderPrivateKey: Uint8Array): string;
  decryptEmberKeyForUser(encryptedBase64: string, senderPublicKey: Uint8Array, recipientPrivateKey: Uint8Array): Uint8Array | null;
  encryptMessage(plaintext: string, emberKey: Uint8Array): string;
  decryptMessage(ciphertextBase64: string, emberKey: Uint8Array): string | null;
  encryptEmberKeyForInvite(emberKey: Uint8Array, inviteCode: string): Promise<{ encrypted: string; salt: string }>;
  decryptEmberKeyFromInvite(encryptedBase64: string, inviteCode: string, saltBase64: string): Promise<Uint8Array | null>;
}

interface IPCRenderer {
  send(channel: string, ...args: unknown[]): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

interface ElectronAPI {
  ipc: IPCRenderer;
  nacl: NaClAPI;
  naclUtil: NaClUtilAPI;
  crypto: EmberCryptoAPI;
}

// ─── App state ────────────────────────────────────────────────────────────────

interface AppState {
  activeChannelId: string | null;
  activeEmberId: string | null;
  emberKeyCache: Map<string, Uint8Array>;
  currentEmbers: Ember[];
  currentMembers: Member[];
  wsConnection: WebSocket | null;
  wsReconnectTimer: ReturnType<typeof setTimeout> | null;
  voiceManager: unknown | null;
  activeVoiceChannelId: string | null;
  voiceParticipants: Map<string, string>;
  videoParticipants: Set<string>;
  localCameraOn: boolean;
  videoGridVisible: boolean;
  healthcheckInterval: ReturnType<typeof setInterval> | null;
  reconnectionTimeout: ReturnType<typeof setTimeout> | null;
  reconnectionStartTime: number | null;
  reconnectionTimerInterval: ReturnType<typeof setInterval> | null;
  dragItem: DragItem | null;
  contextMenuTarget: ContextMenuTarget | null;
  channelModalMode: string | null;
  channelModalTargetId: string | null;
  channelModalCategoryId: string | null;
  currentIconData: string | null;
  currentIconSource: 'upload' | 'url';
  pendingInvite: Record<string, unknown> | null;
  _vvSounds: Partial<Record<string, boolean>> | null;
  _micTestStream: MediaStream | null;
  _micTestAnimFrame: number | null;
  _cameraPreviewStream: MediaStream | null;
  _pttListening: boolean;
}

declare interface Window {
  App: AppState;
  emberLog: EmberLogAPI;
  electronAPI: ElectronAPI;
  // Globals set by websocket-service.ts
  connectWebSocket(): Promise<void>;
  disconnectWebSocket(): void;
  wsSubscribeToChannel(channelId: string): void;
  wsSubscribeToEmber(emberId: string): void;
  handlePresenceUpdate(payload: PresenceUpdatePayload): void;
  handleIncomingMessage(payload: Message): Promise<void>;
  // Globals set by message-service.ts
  sendEncryptedMessage(plaintext: string): Promise<void>;
  displayDecryptedMessage(msg: Message): void;
  escapeHtml(text: string): string;
  loadChannelMessages(channelId: string): Promise<void>;
  fetchMessages(channelId: string): Promise<Message[]>;
  addMessage(author: string, text: string, timestamp?: number): void;
  formatTimestamp(unixSeconds?: number): string;
  // Globals set by ember-manager.ts
  fetchEmbers(): Promise<Ember[]>;
  renderServerList(embers: Ember[]): void;
  switchToServer(emberId: string, emberName: string): void;
  fetchEmberKey(emberId: string): Promise<Uint8Array | null>;
  loadServerContent(emberId: string, emberName: string): Promise<void>;
  openCreateServerModal(): void;
  closeCreateServerModal(): void;
  // Globals set by channel-manager.ts
  fetchChannels(emberId: string): Promise<Channel[]>;
  fetchCategories(emberId: string): Promise<Category[]>;
  renderChannels(channels: Channel[], categories: Category[]): void;
  openChannelNameModal(mode: string, categoryId: string | null, targetId: string | null, currentName: string, currentDescription?: string): void;
  closeChannelNameModal(): void;
  showChannelContextMenu(x: number, y: number, target: ContextMenuTarget): void;
  hideChannelContextMenu(): void;
  // Globals set by invite-manager.ts
  openJoinServerModal(): void;
  closeJoinServerModal(): void;
  openCreateInviteModal(): void;
  closeCreateInviteModal(): void;
  openAcceptInviteModal(inviteInfo: Record<string, unknown>): void;
  closeAcceptInviteModal(): void;
  processInviteLink(code: string, hostname: string | null): Promise<void>;
  // Globals set by voice-ui-manager.ts
  joinVoiceChannel(channelId: string, channelName: string): Promise<void>;
  leaveVoiceChannel(): Promise<void>;
  handleVoiceUserJoined(payload: { channel_id: string; user_id: string; username: string }): void;
  handleVoiceUserLeft(payload: { channel_id: string; user_id: string }): void;
  renderVoiceParticipants(channelId: string | null): void;
  updateSpeakingIndicator(userId: string, isSpeaking: boolean): void;
  showVoiceControls(channelName: string): void;
  hideVoiceControls(): void;
  toggleCamera(): Promise<void>;
  openSettingsModal(page?: string): void;
  closeSettingsModal(): void;
  switchSettingsPage(page: string): void;
  playVoiceSound(type: string): void;
  // Globals set by renderer.ts
  fetchMembers(emberId: string): Promise<Member[]>;
  renderMemberList(members: Member[]): void;
  updateChatHeader(name: string, description: string): void;
  hideWelcomeScreen(): void;
}
