/* eslint-disable @typescript-eslint/no-unused-vars */
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
  UserStatus,
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
  EmberCmd,
  EmberIpcResponse,
} from '../../shared';

declare global {
  // ─── Domain types re-exported from ember-shared ───────────────────────────

  type AuthData = import('../../shared').AuthData;
  type DeviceIdentity = import('../../shared').DeviceIdentity;
  type RegistrationPayload = import('../../shared').RegistrationPayload;
  type LoginPayload = import('../../shared').LoginPayload;
  type AuthResponse = import('../../shared').AuthResponse;
  type RecoveryData = import('../../shared').RecoveryData;

  type Ember = import('../../shared').Ember;
  type Channel = import('../../shared').Channel;
  type Category = import('../../shared').Category;
  type Member = import('../../shared').Member;
  type UserStatus = import('../../shared').UserStatus;
  type ChannelReorderUpdate = import('../../shared').ChannelReorderUpdate;
  type CategoryReorderUpdate = import('../../shared').CategoryReorderUpdate;
  type DragItem = import('../../shared').DragItem;
  type ContextMenuTarget = import('../../shared').ContextMenuTarget;

  type Message = import('../../shared').Message;
  type WsMessage = import('../../shared').WsMessage;
  type PresenceUpdatePayload = import('../../shared').PresenceUpdatePayload;
  type LogPayload = import('../../shared').LogPayload;

  type VoiceSettings = import('../../shared').VoiceSettings;
  type SoundType = import('../../shared').SoundType;
  type VoiceParticipant = import('../../shared').VoiceParticipant;
  type ICEServer = import('../../shared').ICEServer;
  type AuthForVoice = import('../../shared').AuthForVoice;
  type OscillatorType = import('../../shared').OscillatorType;
  type SoundDef = import('../../shared').SoundDef;

  // ─── Direct Messaging Types ───────────────────────────────────────────────

  type User = {
    id: string;
    username: string;
    status: 'online' | 'offline' | 'away';
    avatar?: string;
  };

  // ─── Screen sharing types ─────────────────────────────────────────────────

  interface ScreenSource {
    id: string;
    name: string;
    thumbnailDataUrl: string;
    type: 'screen' | 'window';
  }

  interface ScreenShareSettings {
    sourceId: string;
    includeAudio: boolean;
    resolution: '720p' | '1080p' | '1440p';
    frameRate: 15 | 30 | 60;
  }

  // ─── GIF Favorites ────────────────────────────────────────────────────────

  interface GifFavorite {
    url: string;
    title: string;
    thumbnailUrl: string;
    addedAt: number;
  }

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

  // ─── Notification settings ────────────────────────────────────────────────

  interface NotifSettings {
    messageSound: boolean;
  }

  // ─── Plugin settings ──────────────────────────────────────────────────────

  interface AppLockSettings {
    enabled: boolean;
    idleTimeoutMinutes: number;
    lockOnFocusLoss: boolean;
    focusLossDelaySeconds: number;
  }

  interface PluginSettings {
    readAllButton: boolean;
    appLock: AppLockSettings;
  }

  // ─── Update check ─────────────────────────────────────────────────────────

  interface UpdateInfo {
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion: string | null;
    error?: string;
  }

  interface UpdateDetails {
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion: string | null;
    releaseNotes: string | null;
    publishedAt: string | null;
    downloadUrl: string | null;
    downloadSize: number | null;
    assetName: string | null;
    checksumUrl: string | null;
    error?: string;
  }

  interface DownloadProgress {
    bytesDownloaded: number;
    totalBytes: number;
    percentage: number;
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

  // ─── Attachment types ─────────────────────────────────────────────────────

  interface AttachmentData {
    id: string;
    name: string;
    size: number;
    mime: string;
    spoiler?: boolean;
  }

  interface AttachmentDownloadResult {
    id: string;
    encryptedData: string;
    originalName: string;
    contentType: string;
    sizeBytes: number;
    createdAt: number;
  }

  interface PendingAttachment {
    file: File;
    name: string;
    size: number;
    type: string;
    spoiler?: boolean;
  }

  interface EmberCryptoAPI {
    generateRecoveryCode(length?: number): string;
    encryptPrivateKeyWithRecoveryCode(
      privateKey: Uint8Array,
      recoveryCode: string
    ): Promise<{ encrypted: string; salt: string }>;
    decryptPrivateKeyWithRecoveryCode(
      encryptedBase64: string,
      recoveryCode: string,
      saltBase64: string
    ): Promise<Uint8Array | null>;
    encryptFileBytes(fileBytes: Uint8Array, key: Uint8Array): string;
    decryptFileBytes(encryptedBase64: string, key: Uint8Array): Uint8Array | null;
  }

  interface IPCRenderer {
    send(channel: string, ...args: unknown[]): void;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  }

  interface RefreshTokenResponse {
    readonly token: string;
    readonly userId: string;
    readonly deviceId: string;
    readonly username: string;
  }

  interface TokenUtilsAPI {
    getTokenExpiry(token: string): number | null;
    isTokenExpiringSoon(token: string, thresholdSeconds: number): boolean;
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
    registerWithSignalKeys(
      hostname: string,
      username: string,
      password: string,
      signalIdentity: SignalDeviceIdentity,
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
    validateLoginForm(hostname: string, username: string, password: string): string | null;
    validateRegisterForm(
      hostname: string,
      username: string,
      password: string,
      confirmPassword: string
    ): string | null;
    refreshToken(hostname: string, currentToken: string): Promise<RefreshTokenResponse>;
  }

  interface MessageServiceAPI {
    fetchMessages(
      auth: AuthData,
      channelId: string,
      beforeId?: string
    ): Promise<{ messages: Message[]; hasMore: boolean }>;
    sendMessage(auth: AuthData, channelId: string, ciphertext: string): Promise<Message>;
    deleteMessage(auth: AuthData, channelId: string, messageId: string): Promise<void>;
    editMessage(
      auth: AuthData,
      channelId: string,
      messageId: string,
      ciphertext: string
    ): Promise<void>;
    uploadAttachment(
      auth: AuthData,
      channelId: string,
      encryptedData: string,
      meta: { name: string; size: number; mime: string }
    ): Promise<{ id: string; createdAt: number }>;
    downloadAttachment(
      auth: AuthData,
      channelId: string,
      attachmentId: string
    ): Promise<AttachmentDownloadResult>;
    uploadDMAttachment(
      auth: AuthData,
      conversationId: string,
      encryptedData: string,
      meta: { name: string; size: number; mime: string }
    ): Promise<{ id: string; createdAt: number }>;
    downloadDMAttachment(
      auth: AuthData,
      conversationId: string,
      attachmentId: string
    ): Promise<AttachmentDownloadResult>;
  }

  interface EmberServiceAPI {
    fetchEmbers(auth: AuthData): Promise<Ember[]>;
    updateEmber(
      auth: AuthData,
      emberId: string,
      updates: { name?: string; iconData?: string }
    ): Promise<Ember>;
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

  // ─── Audio capture types ──────────────────────────────────────────────────

  interface AudioCaptureSupport {
    supported: boolean;
    platform: 'win32-wasapi' | 'linux-pipewire' | 'linux-pulseaudio' | 'none';
    reason?: string;
  }

  interface DesktopCapturerAPI {
    getSources(): Promise<
      Array<{
        id: string;
        name: string;
        displayId: string;
        thumbnail: string;
        pipeWireNodeId: number | null;
      }>
    >;
  }

  interface AudioCaptureAPI {
    checkSupport(): Promise<AudioCaptureSupport>;
    setup(): Promise<{ success: boolean; platform?: string; reason?: string }>;
    frames(): Promise<null>;
    teardown(): Promise<void>;
  }

  interface ElectronAPI {
    ipc: IPCRenderer;
    crypto: EmberCryptoAPI;
    authService: AuthServiceAPI;
    messageService: MessageServiceAPI;
    emberService: EmberServiceAPI;
    channelService: ChannelServiceAPI;
    wsService: WsServiceAPI;
    tokenUtils: TokenUtilsAPI;
    onCssHotReload: (callback: (message: { path: string; content: string }) => void) => void;
    desktopCapturer: DesktopCapturerAPI;
    audioCapture: AudioCaptureAPI;
  }

  interface EmberAPI {
    invoke<D = unknown>(cmd: EmberCmd, args: object): Promise<EmberIpcResponse<D>>;
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
    activeView: 'text' | 'voice';
    localScreenShareOn: boolean;
    screenShareParticipants: Set<string>;
    videoPopoutOpen: boolean;
    focusedTileId: string | null;
    lastScreenShareUserId: string | null;
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
    pendingAttachment: PendingAttachment | null;
    gifFavorites: GifFavorite[];
    _vvSounds: Partial<Record<string, boolean>> | null;
    _micTestStream: MediaStream | null;
    _micTestAnimFrame: number | null;
    _cameraPreviewStream: MediaStream | null;
    _pttListening: boolean;
    signalSessionReady: Map<string, boolean>;
    signalSessionManager: import('../managers/signal-session-manager').SignalSessionManager | null;
    initializeSignalSessionManager(): void;
  }

  interface Window {
    App: AppState;
    emberLog: EmberLogAPI;
    electronAPI: ElectronAPI;
    emberAPI: EmberAPI;
    // Auth utilities
    getValidAuth(): Promise<AuthData | null>;
    getAuthSync(): AuthData | null;
    isValidAuth(auth: unknown): auth is AuthData;
    createAuthenticatedFetch(
      url: string,
      options?: RequestInit
    ): Promise<{ auth: AuthData; fetchOptions: RequestInit } | null>;
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
      iconData?: string;
      createdAt: number;
      isOwner: boolean;
    }): void;
    handleMembershipUpdated(payload: {
      emberId: string;
      userId: string;
      username: string;
      action: string;
    }): Promise<void>;
    registerSentMessageId(id: string): void;
    // Globals set by message-service.ts
    sendEncryptedMessage(channelId: string, plaintext: string): Promise<string>;
    sendGifMessage(url: string, title: string): Promise<void>;
    displayDecryptedMessage(msg: Message, prepend?: boolean): Promise<void>;
    handleEditedMessage(msg: Message): Promise<void>;
    escapeHtml(text: string): string;
    loadChannelMessages(channelId: string, forceRefresh?: boolean): Promise<void>;
    fetchMessages(channelId: string, before?: string, limit?: number): Promise<FetchResult>;
    addMessage(
      author: string,
      text: string,
      timestamp?: number,
      prepend?: boolean,
      messageId?: string,
      chatColor?: string,
      attachment?: AttachmentData,
      gif?: { url: string; title?: string }
    ): void;
    // Globals set by messages-area.ts
    createBasicMessageElement(
      author: string,
      text: string,
      timestamp?: number,
      messageId?: string,
      chatColor?: string,
      isOwn?: boolean,
      attachment?: AttachmentData,
      gif?: { url: string; title?: string },
      channelId?: string,
      getEmberKey?: (channelId: string) => Promise<Uint8Array | null>
    ): HTMLElement;
    createActionToolbar(messageId?: string, isOwn?: boolean): HTMLDivElement;
    formatTimestamp(timestamp?: number): string;
    formatRelativeTimestamp(timestamp?: number): string;
    toChumhandle(username: string): string;
    // Globals set by message-service.ts
    enterEditMode(messageDiv: HTMLElement, messageId: string): void;
    // Globals set by renderer.ts
    clearPendingAttachment(): void;
    // Globals set by ember-manager.ts (crypto state)
    getCryptoState(emberId: string): {
      cryptoMode: 'pairwise_bootstrap' | 'sender_key_active';
      senderKeyStatus: 'not_initialized' | 'distributing' | 'active' | 'rotation_required';
      activeDistributionId: string | null;
      senderKeyEpoch: number;
    };
    setCryptoState(
      emberId: string,
      update: Partial<{
        cryptoMode: 'pairwise_bootstrap' | 'sender_key_active';
        senderKeyStatus: 'not_initialized' | 'distributing' | 'active' | 'rotation_required';
        activeDistributionId: string | null;
        senderKeyEpoch: number;
      }>
    ): {
      cryptoMode: 'pairwise_bootstrap' | 'sender_key_active';
      senderKeyStatus: 'not_initialized' | 'distributing' | 'active' | 'rotation_required';
      activeDistributionId: string | null;
      senderKeyEpoch: number;
    };
    shouldUseSenderKey(emberId: string, memberCount: number): boolean;
    syncCryptoStateFromServer(
      emberId: string,
      serverState: {
        cryptoMode?: string;
        senderKeyStatus?: string;
        activeDistributionId?: string | null;
        senderKeyEpoch?: number;
      }
    ): void;
    // Globals set by crypto-routing-service.ts
    cryptoRouting: {
      selectEncryptionMode(emberId: string, memberCount: number): 'pairwise' | 'sender_key';
      encryptMessage(
        plaintext: string,
        emberId: string,
        memberCount: number
      ): Promise<{ ciphertext: string; wireType: 'sender_key' } | null>;
      decryptMessage(ciphertext: string, emberId: string): Promise<string | null>;
      detectWireType(ciphertext: string): 'sender_key' | 'signal';
      onMemberAdded(emberId: string, memberCount: number): void;
      onMemberRemoved(emberId: string, memberCount: number): void;
      onDistributionComplete(emberId: string, distributionId: string): void;
      onRotationComplete(emberId: string, newDistributionId: string): void;
      validateSenderKeyMessage(emberId: string, senderAddress: string): string | null;
    };
    // Globals set by ember-manager.ts
    fetchEmbers(): Promise<Ember[]>;
    renderServerList(embers: Ember[]): void;
    switchToServer(emberId: string, emberName: string): void;
    fetchEmberKey(emberId: string): Promise<Uint8Array | null>;
    loadServerContent(emberId: string, emberName: string): Promise<void>;
    openCreateServerModal(): void;
    closeCreateServerModal(): void;
    handleSenderKeyMemberJoined(emberId: string): Promise<void>;
    handleSenderKeyMemberLeft(emberId: string): Promise<void>;
    processIncomingDistributions?(): Promise<void>;
    distributeSenderKeyToMembers(emberId: string): Promise<void>;
    ensureSenderKeyForEmber(emberId: string): Promise<string | null>;
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
    showChannelContextMenu(x: number, y: number, target: ContextMenuTarget): void;
    hideChannelContextMenu(): void;
    markChannelUnread(channelId: string): void;
    clearAllChannelUnread(): void;
    // Globals set by invite-manager.ts
    openJoinServerModal(): void;
    closeJoinServerModal(): void;
    openCreateInviteModal(): void;
    closeCreateInviteModal(): void;
    openAcceptInviteModal(inviteInfo: Record<string, unknown>): void;
    closeAcceptInviteModal(): void;
    processInviteLink(code: string, hostname: string | null): Promise<void>;
    // Globals set by voice-ui-manager.ts
    handleMemberUpdate(payload: { userId: string; avatar?: string; username?: string }): void;
    fetchAndRenderVoicePresence(emberId: string): Promise<void>;
    joinVoiceChannel(channelId: string, channelName: string): Promise<void>;
    leaveVoiceChannel(): Promise<void>;
    handleVoiceUserJoined(payload: { channelId: string; userId: string; username: string }): void;
    handleVoiceUserLeft(payload: { channelId: string; userId: string }): void;
    renderVoiceParticipants(channelId: string | null): void;
    updateSpeakingIndicator(userId: string, isSpeaking: boolean): void;
    showVoiceControls(channelName: string): void;
    hideVoiceControls(): void;
    toggleCamera(): Promise<void>;
    toggleScreenShare(): Promise<void>;
    handleVoiceScreenShareStarted(userId: string): void;
    handleVoiceScreenShareStopped(userId: string): void;
    showVoiceChannelView(): void;
    showTextChannelView(): void;
    openSettingsModal(page?: string): void;
    closeSettingsModal(): void;
    switchSettingsPage(page: string): void;
    playVoiceSound(type: string): void;
    playNotificationSound(type: string): void;
    initNotifSettings(): void;
    // Globals set by plugin-settings.ts
    initPluginSettings(): void;
    getPluginSettings(): PluginSettings;
    // Globals set by app-lock-manager.ts
    initAppLock(): void;
    lockApp(): void;
    unlockApp(pin: string): Promise<boolean>;
    isAppLocked(): boolean;
    updateAppLockSettings(settings: Partial<AppLockSettings>): void;
    getNotifSettings(): NotifSettings;
    saveNotifSettings(settings: NotifSettings): void;
    cleanupVoiceOnDisconnect(): void;
    // Globals set by screen-share-modal.ts
    openScreenShareModal(
      sources: ScreenSource[],
      audioAvailable: boolean,
      onSelect: (source: ScreenSource, settings: ScreenShareSettings) => void,
      audioLabel?: string
    ): void;
    hideScreenShareModal(): void;
    // Globals set by voice-ui-manager.ts (video grid)
    setSpotlight(tileId: string | null): void;
    toggleVideoPopout(): void;
    openVideoPopout(): void;
    resolveSpotlight(desiredTiles: Set<string>): string | null;
    // Globals set by theme-manager.ts
    initThemeSettings(): Promise<void>;
    // Globals set by update-notifier.ts
    checkForUpdate(): Promise<void>;
    dismissUpdateNotification(): void;
    // Globals set by update-modal.ts
    openUpdateModal(details: UpdateDetails): void;
    closeUpdateModal(): void;
    // Globals set by renderer.ts
    fetchMembers(emberId: string): Promise<Member[]>;
    renderMemberList(members: Member[]): void;
    updateChatHeader(name: string, description: string): void;
    hideWelcomeScreen(): void;
    showWelcomeScreen(): void;
    // Globals set by direct-messaging-manager.ts
    initializeDirectMessaging(): Promise<void>;
    startDmConversation(participantId: string, participantUsername: string): Promise<string | null>;
    fetchDMRequests(): Promise<
      Array<{
        id: string;
        requesterId: string;
        requesterUsername: string;
        requesterAvatar: string;
        createdAt: number;
      }>
    >;
    acceptDMRequest(
      requestId: string,
      requesterId: string,
      requesterUsername: string
    ): Promise<string>;
    declineDMRequest(requestId: string): Promise<void>;
    loadAndShowDmRequests(): Promise<void>;
    /** Called when user sends a DM request; channel is now open but pending. */
    onDmRequestSent?(payload: {
      requestId: string;
      participantId: string;
      participantUsername: string;
    }): void;
    getPendingStatusForChannel(
      channelId: string
    ): { requestId: string; isRecipient: boolean } | null;
    sendDirectMessage(conversationId: string, plaintext: string): Promise<string>;
    setActiveDmConversation(conversationId: string): void;
    sendTypingIndicator(conversationId: string, isTyping: boolean): Promise<void>;
    fetchConversationMessages(conversationId: string): Promise<
      Array<{
        id: string;
        conversationId: string;
        senderId: string;
        content: string;
        timestamp: number;
        isOwn: boolean;
      }>
    >;
    initiateKeyExchange(conversationId: string, participantId: string): Promise<void>;
    refreshAllPresenceStates(): Promise<void>;
    // UI helpers for ember key access
    fetchAndCacheEmberKeyForChannel(channelId: string): Promise<Uint8Array | null>;
    getEmberIdForDmChannel(channelId: string): string | null;
    resubscribeDmChannels(): void;
    handleDmMessage(payload: {
      id: string;
      conversationId: string;
      senderUserId: string;
      content: string;
      timestamp: number;
    }): void;
    handleDmPresenceUpdate(payload: { userId: string; username: string; status: string }): void;
    handleDmTypingIndicator(payload: {
      conversationId: string;
      userId: string;
      typing: boolean;
    }): void;
    // Globals set by direct-messaging-ui.ts
    clearAllDmUnread(): void;
    refreshDmUsername(username: string): void;
    initializeDirectMessagingUI(): void;
    loadAndShowDmRequests(): Promise<void>;
    showDmPendingBanner(payload: {
      channelId: string;
      partnerUsername: string;
      requestId: string;
      isRecipient: boolean;
      requesterId: string;
    }): void;
    hideDmPendingBanner(channelId: string): void;
    addDmConversationToList(conversation: {
      id: string;
      participantId: string;
      participantUsername: string;
      participantAvatar?: string;
      unreadCount: number;
      isOnline: boolean;
      keyExchanged: boolean;
      createdAt?: number;
    }): void;
    displayDmMessage(messageData: {
      id: string;
      conversationId: string;
      senderId: string;
      content: string;
      timestamp: number;
      isOwn: boolean;
    }): void;
    updateDmConversation(
      conversationId: string,
      updates: Partial<{
        id: string;
        participantId: string;
        participantUsername: string;
        lastMessage?: string;
        unreadCount: number;
        isOnline: boolean;
      }>
    ): void;
    showDmTypingIndicator(isTyping: boolean, username?: string): void;
    addDmMessageReactions(
      messageId: string,
      reactions: Array<{
        emoji: string;
        count: number;
        reacted: boolean;
      }>
    ): void;
    updateDmMessageStatus(
      messageId: string,
      status: 'sending' | 'sent' | 'delivered' | 'read'
    ): void;
    addDmNotificationBadge(element: HTMLElement, count: number): void;
    removeDmConversation(conversationId: string): void;
    // Performance optimization functions
    getCachedMessages(channelId: string): {
      messages: Message[];
      hasMore: boolean;
    } | null;
    cacheMessages(
      channelId: string,
      result: {
        messages: Message[];
        hasMore: boolean;
      }
    ): void;
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
    // Globals set by read-all-manager.ts
    readAll(): void;
    // Globals set by renderer.ts
    closeDMScreenOnServerSwitch(): void;
    // Globals set by renderer.ts (DM screen)
    openDMScreen(): void;
    // Globals set by direct-messaging-ui.ts
    openDmWithUser(userId: string, username: string): Promise<void>;
    // Globals set by renderer.ts (external link modal)
    openExternalLinkModal(url: string): void;
    // Globals set by user-details-modal.ts
    openUserDetailsModal(userId: string, username: string): void;
    closeUserDetailsModal(): void;
    // Globals set by username-click-handler.ts
    makeUsernameClickable(el: HTMLElement, userId: string, username: string): void;
    // Globals set by user-service.ts
    getUserDetails(userId: string): Member | null;
    getUserDetailsByUsername(username: string): Member | null;
    getUserVoiceChannel(userId: string): { channelId: string; channelName: string } | null;
    // Globals set by emoji-picker.ts
    openEmojiPicker(trigger: HTMLElement, input: HTMLTextAreaElement | HTMLInputElement): void;
    // Globals set by gif-picker.ts
    openGifPicker(trigger: HTMLElement): void;
    getGifFavorites(): GifFavorite[];
    addGifFavorite(favorite: GifFavorite): void;
    removeGifFavorite(url: string): void;
    isGifFavorited(url: string): boolean;
    // Globals set by message-service.ts (GIF)
    sendGifMessage(url: string, title: string): Promise<void>;
    sendGif(url: string, title: string): void;
  }
}
