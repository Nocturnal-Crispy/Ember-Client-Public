/**
 * Global type declarations for the Ember renderer process.
 * Extends Window with custom APIs exposed by the preload bridge and module globals.
 * All domain types are declared here as globals so renderer scripts need no import statements
 * (which would cause TypeScript to emit CommonJS module boilerplate incompatible with plain <script> tags).
 *
 * Domain types are re-exported from ember-shared as global type aliases.
 */

import type {
  AuthData,
  DeviceIdentity,
  RegistrationPayload,
  LoginPayload,
  AuthResponse,
  RecoveryData,
  Ember,
  Channel,
  Category,
  Member,
  ChannelReorderUpdate,
  CategoryReorderUpdate,
  DragItem,
  ContextMenuTarget,
  Message,
  WsMessage,
  PresenceUpdatePayload,
  LogPayload,
  VoiceSettings,
  SoundType,
  VoiceParticipant,
  ICEServer,
  AuthForVoice,
  OscillatorType,
  SoundDef,
} from "ember-shared";

declare global {
  // ─── Domain types re-exported from ember-shared ───────────────────────────

  type AuthData = import("ember-shared").AuthData;
  type DeviceIdentity = import("ember-shared").DeviceIdentity;
  type RegistrationPayload = import("ember-shared").RegistrationPayload;
  type LoginPayload = import("ember-shared").LoginPayload;
  type AuthResponse = import("ember-shared").AuthResponse;
  type RecoveryData = import("ember-shared").RecoveryData;

  type Ember = import("ember-shared").Ember;
  type Channel = import("ember-shared").Channel;
  type Category = import("ember-shared").Category;
  type Member = import("ember-shared").Member;
  type ChannelReorderUpdate = import("ember-shared").ChannelReorderUpdate;
  type CategoryReorderUpdate = import("ember-shared").CategoryReorderUpdate;
  type DragItem = import("ember-shared").DragItem;
  type ContextMenuTarget = import("ember-shared").ContextMenuTarget;

  type Message = import("ember-shared").Message;
  type WsMessage = import("ember-shared").WsMessage;
  type PresenceUpdatePayload = import("ember-shared").PresenceUpdatePayload;
  type LogPayload = import("ember-shared").LogPayload;

  type VoiceSettings = import("ember-shared").VoiceSettings;
  type SoundType = import("ember-shared").SoundType;
  type VoiceParticipant = import("ember-shared").VoiceParticipant;
  type ICEServer = import("ember-shared").ICEServer;
  type AuthForVoice = import("ember-shared").AuthForVoice;
  type OscillatorType = import("ember-shared").OscillatorType;
  type SoundDef = import("ember-shared").SoundDef;

  // ─── Direct Messaging Types ───────────────────────────────────────────────

  type User = {
    id: string;
    username: string;
    status: 'online' | 'offline' | 'away';
    avatar?: string;
  };

  // ─── Theme settings ───────────────────────────────────────────────────────

  interface ThemeSettings {
    themeId: string;
    accentRgb: string;
    backgroundRgb: string;
    surfaceRgb: string;
    chatColor?: string;
  }

  interface ThemePreset {
    id: string;
    name: string;
    accentRgb: string;
    backgroundRgb: string;
    surfaceRgb: string;
  }

  // ─── Update check ─────────────────────────────────────────────────────────

  interface UpdateInfo {
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion: string | null;
    error?: string;
  }

  // ─── Electron bridge APIs ─────────────────────────────────────────────────

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
    box(
      msg: Uint8Array,
      nonce: Uint8Array,
      theirPk: Uint8Array,
      mysk: Uint8Array
    ): Uint8Array;
    boxOpen(
      box: Uint8Array,
      nonce: Uint8Array,
      theirPk: Uint8Array,
      mysk: Uint8Array
    ): Uint8Array | null;
    boxKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
    secretbox(msg: Uint8Array, nonce: Uint8Array, k: Uint8Array): Uint8Array;
    secretboxOpen(
      box: Uint8Array,
      nonce: Uint8Array,
      k: Uint8Array
    ): Uint8Array | null;
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

  // ─── Attachment types ─────────────────────────────────────────────────────

  interface AttachmentData {
    id: string;
    name: string;
    size: number;
    mime: string;
  }

  interface AttachmentDownloadResult {
    id: string;
    encrypted_data: string;
    original_name: string;
    content_type: string;
    size_bytes: number;
    created_at: number;
  }

  interface PendingAttachment {
    file: File;
    name: string;
    size: number;
    type: string;
  }

  interface EmberCryptoAPI {
    generateRecoveryCode(): string;
    encryptPrivateKeyWithRecoveryCode(
      privateKey: Uint8Array,
      recoveryCode: string
    ): Promise<{ encrypted: string; salt: string }>;
    decryptPrivateKeyWithRecoveryCode(
      encryptedBase64: string,
      recoveryCode: string,
      saltBase64: string
    ): Promise<Uint8Array | null>;
    generateEmberKey(): Uint8Array;
    encryptEmberKeyForUser(
      emberKey: Uint8Array,
      recipientPublicKey: Uint8Array,
      senderPrivateKey: Uint8Array
    ): string;
    decryptEmberKeyForUser(
      encryptedBase64: string,
      senderPublicKey: Uint8Array,
      recipientPrivateKey: Uint8Array
    ): Uint8Array | null;
    encryptMessage(plaintext: string, emberKey: Uint8Array): string;
    decryptMessage(
      ciphertextBase64: string,
      emberKey: Uint8Array
    ): string | null;
    encryptEmberKeyForInvite(
      emberKey: Uint8Array,
      inviteCode: string
    ): Promise<{ encrypted: string; salt: string }>;
    decryptEmberKeyFromInvite(
      encryptedBase64: string,
      inviteCode: string,
      saltBase64: string
    ): Promise<Uint8Array | null>;
    encryptFileBytes(fileBytes: Uint8Array, key: Uint8Array): string;
    decryptFileBytes(encryptedBase64: string, key: Uint8Array): Uint8Array | null;
  }

  interface IPCRenderer {
    send(channel: string, ...args: unknown[]): void;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void
    ): void;
  }

  interface AuthServiceAPI {
    generateDeviceIdentity(): DeviceIdentity;
    login(
      hostname: string,
      username: string,
      password: string,
      deviceId: string
    ): Promise<AuthResponse>;
    register(
      hostname: string,
      username: string,
      password: string,
      deviceId: string,
      publicKey: string,
      encryptedDeviceKey: string,
      salt: string
    ): Promise<AuthResponse>;
    registerWithRecovery(
      hostname: string,
      username: string,
      password: string,
      deviceIdentity: DeviceIdentity
    ): Promise<AuthResponse & { _recoveryCode: string }>;
    validateLoginForm(
      hostname: string,
      username: string,
      password: string
    ): string | null;
    validateRegisterForm(
      hostname: string,
      username: string,
      password: string,
      confirmPassword: string
    ): string | null;
  }

  interface MessageServiceAPI {
    fetchMessages(
      auth: AuthData,
      channelId: string,
      beforeId?: string
    ): Promise<{ messages: Message[]; hasMore: boolean }>;
    sendMessage(
      auth: AuthData,
      channelId: string,
      plaintext: string,
      emberKey: Uint8Array
    ): Promise<Message>;
    editMessage(
      auth: AuthData,
      channelId: string,
      messageId: string,
      plaintext: string,
      emberKey: Uint8Array
    ): Promise<void>;
    uploadAttachment(
      auth: AuthData,
      channelId: string,
      encryptedData: string,
      meta: { name: string; size: number; mime: string }
    ): Promise<{ id: string; created_at: number }>;
    downloadAttachment(
      auth: AuthData,
      channelId: string,
      attachmentId: string
    ): Promise<AttachmentDownloadResult>;
  }

  interface EmberServiceAPI {
    fetchEmbers(auth: AuthData): Promise<Ember[]>;
    updateEmber(auth: AuthData, emberId: string, updates: { name?: string; icon_data?: string }): Promise<Ember>;
  }

  interface ChannelServiceAPI {
    fetchChannels(
      auth: AuthData,
      emberId: string
    ): Promise<{ channels: Channel[]; categories: Category[] }>;
    fetchEmberKey(
      auth: AuthData,
      emberId: string
    ): Promise<{ encryptedEmberKey: string; senderPublicKey: string } | null>;
  }

  interface WsServiceAPI {
    buildWsUrl(hostname: string, token: string): string;
  }

  interface ElectronAPI {
    ipc: IPCRenderer;
    nacl: NaClAPI;
    naclUtil: NaClUtilAPI;
    crypto: EmberCryptoAPI;
    authService: AuthServiceAPI;
    messageService: MessageServiceAPI;
    emberService: EmberServiceAPI;
    channelService: ChannelServiceAPI;
    wsService: WsServiceAPI;
    onCssHotReload: (callback: (message: { path: string; content: string }) => void) => void;
  }

  // ─── App state ────────────────────────────────────────────────────────────

  interface AppState {
    activeChannelId: string | null;
    activeEmberId: string | null;
    emberKeyCache: Map<string, Uint8Array>;
    ownedMessageIds: Set<string>;
    currentEmbers: Ember[];
    currentMembers: Member[];
    wsConnection: WebSocket | null;
    wsReconnectTimer: ReturnType<typeof setTimeout> | null;
    voiceManager: unknown | null;
    activeVoiceChannelId: string | null;
    activeVoiceChannelName: string | null;
    voiceParticipants: Map<string, string>;
    voiceChannelPresence: Map<string, Map<string, string>>;
    videoParticipants: Set<string>;
    localCameraOn: boolean;
    videoGridVisible: boolean;
    activeView: "text" | "voice";
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
    currentIconSource: "upload" | "url";
    pendingInvite: Record<string, unknown> | null;
    pendingAttachment: PendingAttachment | null;
    _vvSounds: Partial<Record<string, boolean>> | null;
    _micTestStream: MediaStream | null;
    _micTestAnimFrame: number | null;
    _cameraPreviewStream: MediaStream | null;
    _pttListening: boolean;
  }

  interface Window {
    App: AppState;
    emberLog: EmberLogAPI;
    electronAPI: ElectronAPI;
    // Auth utilities
    getValidAuth(): Promise<AuthData | null>;
    isValidAuth(auth: unknown): auth is AuthData;
    createAuthenticatedFetch(url: string, options?: RequestInit): Promise<{ auth: AuthData; fetchOptions: RequestInit } | null>;
    // Globals set by websocket-service.ts
    connectWebSocket(): Promise<void>;
    disconnectWebSocket(): void;
    wsSubscribeToChannel(channelId: string): void;
    wsUnsubscribeFromChannel(channelId: string): void;
    wsSubscribeToEmber(emberId: string): void;
    handlePresenceUpdate(payload: PresenceUpdatePayload): void;
    handleIncomingMessage(payload: Message): Promise<void>;
    handleEmberUpdated(payload: {
      id: string;
      name: string;
      icon_data?: string;
      created_at: number;
      is_owner: boolean;
    }): void;
    handleMembershipUpdated(payload: {
      ember_id: string;
      user_id: string;
      username: string;
      action: string;
    }): Promise<void>;
    registerSentMessageId(id: string): void;
    // Globals set by message-service.ts
    sendEncryptedMessage(plaintext: string): Promise<void>;
    displayDecryptedMessage(msg: Message, prepend?: boolean): void;
    handleEditedMessage(payload: {
      id: string;
      channel_id: string;
      ciphertext: string;
      updated_at?: number;
    }): void;
    escapeHtml(text: string): string;
    loadChannelMessages(channelId: string): Promise<void>;
    fetchMessages(
      channelId: string,
      beforeId?: string | null
    ): Promise<{ messages: Message[]; hasMore: boolean }>;
    addMessage(
      author: string,
      text: string,
      timestamp?: number,
      prepend?: boolean,
      messageId?: string,
      chatColor?: string,
      attachment?: AttachmentData
    ): void;
    clearPendingAttachment(): void;
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
    openChannelNameModal(
      mode: string,
      categoryId: string | null,
      targetId: string | null,
      currentName: string,
      currentDescription?: string
    ): void;
    closeChannelNameModal(): void;
    showChannelContextMenu(
      x: number,
      y: number,
      target: ContextMenuTarget
    ): void;
    hideChannelContextMenu(): void;
    markChannelUnread(channelId: string): void;
    // Globals set by invite-manager.ts
    openJoinServerModal(): void;
    closeJoinServerModal(): void;
    openCreateInviteModal(): void;
    closeCreateInviteModal(): void;
    openAcceptInviteModal(inviteInfo: Record<string, unknown>): void;
    closeAcceptInviteModal(): void;
    processInviteLink(code: string, hostname: string | null): Promise<void>;
    // Globals set by voice-ui-manager.ts
    handleMemberUpdate(payload: { user_id: string; avatar?: string; username?: string }): void;
    fetchAndRenderVoicePresence(emberId: string): Promise<void>;
    joinVoiceChannel(channelId: string, channelName: string): Promise<void>;
    leaveVoiceChannel(): Promise<void>;
    handleVoiceUserJoined(payload: {
      channel_id: string;
      user_id: string;
      username: string;
    }): void;
    handleVoiceUserLeft(payload: { channel_id: string; user_id: string }): void;
    renderVoiceParticipants(channelId: string | null): void;
    updateSpeakingIndicator(userId: string, isSpeaking: boolean): void;
    showVoiceControls(channelName: string): void;
    hideVoiceControls(): void;
    toggleCamera(): Promise<void>;
    showVoiceChannelView(): void;
    showTextChannelView(): void;
    openSettingsModal(page?: string): void;
    closeSettingsModal(): void;
    switchSettingsPage(page: string): void;
    playVoiceSound(type: string): void;
    cleanupVoiceOnDisconnect(): void;
    // Globals set by theme-manager.ts
    initThemeSettings(): Promise<void>;
    // Globals set by update-notifier.ts
    checkForUpdate(): Promise<void>;
    dismissUpdateNotification(): void;
    // Globals set by renderer.ts
    fetchMembers(emberId: string): Promise<Member[]>;
    renderMemberList(members: Member[]): void;
    updateChatHeader(name: string, description: string): void;
    hideWelcomeScreen(): void;
    showWelcomeScreen(): void;
    // Globals set by direct-messaging-manager.ts
    initializeDirectMessaging(): Promise<void>;
    startDmConversation(participantId: string, participantUsername: string): Promise<string>;
    sendDirectMessage(conversationId: string, plaintext: string): Promise<string>;
    setActiveDmConversation(conversationId: string): void;
    sendTypingIndicator(conversationId: string, isTyping: boolean): Promise<void>;
    fetchConversationMessages(conversationId: string): Promise<Array<{
      id: string;
      conversationId: string;
      senderId: string;
      content: string;
      timestamp: number;
      isOwn: boolean;
    }>>;
    initiateKeyExchange(conversationId: string, participantId: string): Promise<void>;
    refreshAllPresenceStates(): Promise<void>;
    handleDmMessage(payload: {
      id: string;
      conversation_id: string;
      sender_user_id: string;
      content: string;
      timestamp: number;
    }): void;
    handleDmPresenceUpdate(payload: {
      user_id: string;
      username: string;
      status: string;
    }): void;
    handleDmTypingIndicator(payload: {
      conversation_id: string;
      user_id: string;
      typing: boolean;
    }): void;
    // Globals set by direct-messaging-ui.ts
    initializeDirectMessagingUI(): void;
    addDmConversationToList(conversation: {
      id: string;
      participantId: string;
      participantUsername: string;
      participantAvatar?: string;
      unreadCount: number;
      isOnline: boolean;
      keyExchanged: boolean;
    }): void;
    displayDmMessage(messageData: {
      id: string;
      conversationId: string;
      senderId: string;
      content: string;
      timestamp: number;
      isOwn: boolean;
    }): void;
    updateDmConversation(conversationId: string, updates: Partial<{
      id: string;
      participantId: string;
      participantUsername: string;
      lastMessage?: string;
      unreadCount: number;
      isOnline: boolean;
    }>): void;
    showDmTypingIndicator(isTyping: boolean, username?: string): void;
    addDmMessageReactions(messageId: string, reactions: Array<{
      emoji: string;
      count: number;
      reacted: boolean;
    }>): void;
    updateDmMessageStatus(messageId: string, status: 'sending' | 'sent' | 'delivered' | 'read'): void;
    addDmNotificationBadge(element: HTMLElement, count: number): void;
    removeDmConversation(conversationId: string): void;
    // Performance optimization functions
    getCachedMessages(channelId: string): {
      messages: Message[];
      hasMore: boolean;
    } | null;
    cacheMessages(channelId: string, result: {
      messages: Message[];
      hasMore: boolean;
    }): void;
    initializeVirtualScrolling(): void;
    cleanupOldMessages(): void;
    monitorPerformance(operation: string, startTime: number): void;
    // Accessibility functions
    announceToScreenReader(message: string): void;
    updateScreenReaderStatus(status: string): void;
    initializeAccessibility(): void;
    // Test functions
    testDmMessageSend(): Promise<void>;
    debugTextarea(): void;
    // Globals set by message-service.ts (DM extensions)
    sendDirectMessage(conversationId: string, plaintext: string): Promise<string>;
    displayDirectMessage(messageData: {
      id: string;
      conversation_id: string;
      sender_user_id: string;
      content: string;
      timestamp: number;
    }): Promise<void>;
    cacheDmConversationKey(conversationId: string, key: Uint8Array): void;
    removeDmConversationKey(conversationId: string): void;
    // Globals set by websocket-service.ts (DM extensions)
    wsSubscribeToDmConversation(conversationId: string): void;
    wsUnsubscribeFromDmConversation(conversationId: string): void;
    // Globals set by renderer.ts (DM extensions)
    closeDMScreenOnServerSwitch(): void;
    // Globals set by emoji-picker.ts
    openEmojiPicker(trigger: HTMLElement, input: HTMLTextAreaElement | HTMLInputElement): void;
    // Globals set by gif-picker.ts
    openGifPicker(trigger: HTMLElement): void;
    // Globals set by message-service.ts (GIF)
    sendGifMessage(url: string, title: string): Promise<void>;
    sendGif(url: string, title: string): void;
  }
}
