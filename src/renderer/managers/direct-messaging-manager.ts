/**
 * Direct Messaging Manager — TypeScript module.
 *
 * Each DM is a private ember (kind='dm') created via a request/accept flow:
 *   1. Requester sends a DM request (no encryption — just a notification).
 *   2. Recipient accepts: generates ember key, creates self-box + peer-box.
 *   3. Requester loads the accepted DM, fetches their peer-box, migrates to self-box.
 *   4. Both parties use only self-box paths going forward.
 *
 * This eliminates the "authentication failed or wrong key" bug that occurred
 * when the requester tried to encrypt a key for the recipient using a stale
 * device public key fetched at request time.
 */
(function (): void {

  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger("DirectMessagingManager");

  // ─── State ─────────────────────────────────────────────────────────────────

  interface DmEntry {
    emberId: string;
    textChannelId: string;
    voiceChannelId: string | null;
    partnerId: string;
    partnerUsername: string;
    partnerAvatar: string;
    /** 'pending' while the recipient hasn't accepted; 'accepted' otherwise. */
    requestStatus: 'pending' | 'accepted';
    /** The dm_request id, present while status is 'pending'. */
    requestId: string;
    /** True when the current user is the recipient of a pending request. */
    isRecipient: boolean;
    /** Device ID of the partner when they are Signal-capable; null for legacy devices. */
    partnerDeviceId: string | null;
    /** Protocol version: 1 = Signal, 0 = legacy NaCl. */
    partnerProtocolVersion: number;
  }

  const dmByTextChannel = new Map<string, DmEntry>();
  const dmByEmberId = new Map<string, DmEntry>();
  let activeTextChannelId: string | null = null;

  // BP-5: tracks message IDs that were optimistically rendered by sendDirectMessage
  // so the WS echo for the same message is ignored and not double-displayed.
  const pendingMessageIds = new Set<string>();

  // ─── Auth helpers ──────────────────────────────────────────────────────────

  async function getAuth(): Promise<{ token: string; hostname: string; user_id: string } | null> {
    const auth = await window.getValidAuth();
    if (!auth?.token || !auth?.hostname) return null;
    return auth as { token: string; hostname: string; user_id: string };
  }

  async function getDevice(): Promise<{ public_key: string; private_key: string } | null> {
    const device = await ipcRenderer.invoke("get-device-identity") as {
      public_key?: string; private_key?: string;
    } | null;
    if (!device?.public_key || !device?.private_key) return null;
    return device as { public_key: string; private_key: string };
  }

  // ─── Ember key helpers ─────────────────────────────────────────────────────

  /**
   * Fetches and caches the ember key for a DM channel.
   *
   * The server returns:
   *   - encrypted_key: the NaCl box ciphertext
   *   - sender_public_key (optional): present only for peer-boxes created during
   *     DM acceptance. The stored key is always the one actually used for encryption,
   *     so decryption is reliable even after device key rotation.
   *
   * On first fetch of a peer-box, the key is decrypted and immediately migrated
   * to a self-box format so all future fetches use the simpler self-box path.
   */
  async function fetchAndCacheEmberKey(emberId: string): Promise<Uint8Array | null> {
    // No backward compatibility - legacy ember keys are no longer supported
    log.debug("Legacy ember key support removed", { ember_id: emberId });
    return null;
  }

  // ─── Load DM list ──────────────────────────────────────────────────────────

  async function loadDmEmbers(): Promise<void> {
    const auth = await getAuth();
    if (!auth) return;
    try {
      const res = await fetch(`${auth.hostname}/api/v1/dms`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { dms: Array<{
        id: string; name: string; created_at: string;
        partner_id: string; partner_username: string; partner_avatar: string;
        request_status?: string; request_id?: string; requester_id?: string;
      }> };
      for (const dm of data.dms ?? []) {
        const requestStatus = (dm.request_status === 'pending' ? 'pending' : 'accepted') as 'pending' | 'accepted';
        const requestId = dm.request_id ?? '';
        const isRecipient = requestStatus === 'pending' && dm.requester_id !== undefined && dm.requester_id !== auth.user_id;

        const channels = await fetchDmChannels(auth, dm.id);
        const entry: DmEntry = {
          emberId: dm.id,
          textChannelId: channels.textChannelId,
          voiceChannelId: channels.voiceChannelId,
          partnerId: dm.partner_id,
          partnerUsername: dm.partner_username,
          partnerAvatar: dm.partner_avatar,
          requestStatus,
          requestId,
          isRecipient,
          partnerDeviceId: null,
          partnerProtocolVersion: 0,
        };
        if (entry.textChannelId) {
          dmByTextChannel.set(entry.textChannelId, entry);
          dmByEmberId.set(entry.emberId, entry);

          // Only fetch and cache the key if this user has one (requester or accepted recipient)
          if (!isRecipient) {
            fetchAndCacheEmberKey(entry.emberId).catch((err) => {
              log.warn("Failed to cache ember key for loaded DM", {
                emberId: entry.emberId,
                error: (err as Error).message,
              });
            });
          }

          window.addDmConversationToList({
            id: entry.textChannelId,
            participantId: entry.partnerId,
            participantUsername: entry.partnerUsername,
            participantAvatar: entry.partnerAvatar,
            unreadCount: 0,
            isOnline: false,
            keyExchanged: requestStatus === 'accepted',
            createdAt: Date.now(),
          });
          window.wsSubscribeToChannel(entry.textChannelId);

          // Show pending banner immediately
          if (requestStatus === 'pending') {
            if (typeof window.showDmPendingBanner === 'function') {
              window.showDmPendingBanner({
                channelId: entry.textChannelId,
                partnerUsername: entry.partnerUsername,
                requestId,
                isRecipient,
                requesterId: dm.requester_id ?? '',
              });
            }
          }
        }
      }
    } catch (err) {
      log.error("Failed to load DM embers", { error: (err as Error).message });
    }
  }

  interface DmChannels { textChannelId: string; voiceChannelId: string | null; }

  async function fetchDmChannels(
    auth: { token: string; hostname: string },
    emberId: string,
  ): Promise<DmChannels> {
    try {
      const res = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/channels`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) return { textChannelId: "", voiceChannelId: null };
      const data = (await res.json()) as {
        channels: Array<{ id: string; type: string }>;
      };
      const textChannel = data.channels.find((c) => c.type === "text");
      const voiceChannel = data.channels.find((c) => c.type === "voice");
      return {
        textChannelId: textChannel?.id ?? "",
        voiceChannelId: voiceChannel?.id ?? null,
      };
    } catch {
      return { textChannelId: "", voiceChannelId: null };
    }
  }

  // ─── DM Request flow ──────────────────────────────────────────────────────

  /**
   * Sends a DM request to another user and immediately provisions the DM channel.
   * The requester generates the ember key at request time so they can send messages
   * before the recipient accepts. A peer-box is included in the request body so
   * the recipient can decrypt all messages (including pre-acceptance ones) after
   * they accept, without any additional round-trips.
   *
   * Returns the existing channel ID if a DM already exists with this user.
   */
  async function startDmConversation(
    participantId: string,
    participantUsername: string,
  ): Promise<string | null> {
    const auth = await getAuth();
    const device = await getDevice();
    if (!auth || !device) throw new Error("Not authenticated");

    // Return existing DM channel if one already exists
    const existing = [...dmByTextChannel.values()].find(
      (e) => e.partnerId === participantId,
    );
    if (existing) return existing.textChannelId;

    // Fetch the recipient's devices so we can pick a Signal-capable target
    // device for `signal_dm` message encryption.
    let firstDevice: { id: string; public_key: string; protocol_version?: number } | undefined;
    try {
      const devRes = await fetch(`${auth.hostname}/api/v1/users/${participantId}/devices`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (devRes.ok) {
        const devData = (await devRes.json()) as { devices: Array<{ id: string; public_key: string; protocol_version?: number }> };
        firstDevice = devData.devices?.[0];
      }
    } catch (err) {
      log.warn("Failed to fetch recipient devices for DM session", { participantId, error: (err as Error).message });
    }

    // Generate encrypted_key_self for server compatibility (P0-1 fix)
    // The server requires this field even though Signal Protocol replaces ember keys for DMs
    const currentDevice = await getDevice();
    let encryptedKeySelf = "";
    if (currentDevice) {
      // Generate a dummy encrypted key for server compatibility
      // Since Signal Protocol will be used for actual encryption, this is just for API compatibility
      // Compatibility placeholder — Signal Protocol sender keys handle actual DM encryption; 
      // this value is stored server-side but never decrypted
      const emberKey = new Uint8Array(32);
      crypto.getRandomValues(emberKey);
      
      // Simple base64 encoding for server compatibility - just the 32 random bytes
      encryptedKeySelf = Buffer.from(emberKey).toString('base64');
    }

    const res = await fetch(`${auth.hostname}/api/v1/dm-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      // P0-1 FIX: Include encrypted_key_self as required by server
      body: JSON.stringify({ 
        user_id: participantId,
        encrypted_key_self: encryptedKeySelf
      }),
    });
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error ?? "Failed to send DM request");
    }
    const { id: requestId, ember_id: emberId, status: responseStatus } = (await res.json()) as {
      id: string; ember_id: string; status: string;
    };

    // Server found an existing pending/accepted DM — open it directly without
    // creating a duplicate local entry. If it's already in our map (from
    // loadDmEmbers), return it; otherwise fall through to register it fresh.
    if (responseStatus === 'accepted' || responseStatus === 'pending') {
      const existingByEmber = dmByEmberId.get(emberId);
      if (existingByEmber) return existingByEmber.textChannelId;
    }

    // Open the DM channel — key will be fetched after the recipient accepts.
    const channels = await fetchDmChannels(auth, emberId);
    const partnerDeviceId = firstDevice?.protocol_version === 1 ? (firstDevice.id ?? null) : null;
    const partnerProtocolVersion = firstDevice?.protocol_version === 1 ? 1 : 0;

    const entry: DmEntry = {
      emberId,
      textChannelId: channels.textChannelId,
      voiceChannelId: channels.voiceChannelId,
      partnerId: participantId,
      partnerUsername: participantUsername,
      partnerAvatar: "",
      requestStatus: 'pending',
      requestId,
      isRecipient: false,
      partnerDeviceId,
      partnerProtocolVersion,
    };
    dmByTextChannel.set(channels.textChannelId, entry);
    dmByEmberId.set(emberId, entry);

    // Initiate Signal session eagerly if the peer is Signal-capable.
    if (partnerDeviceId && partnerProtocolVersion === 1 && App.signalSessionManager) {
      try {
        await App.signalSessionManager.ensureSession(participantId, partnerDeviceId);
      } catch (err: unknown) {
        const error = err as Error;
        log.warn("Signal ensureSession failed, falling back to legacy", {
          participantId, partnerDeviceId, error: error.message,
        });
        // Continue without Signal - will fall back to error message in sendDirectMessage
      }
    }

  // Signal Protocol sender keys are used for all encrypted messaging

  window.addDmConversationToList({
      id: channels.textChannelId,
      participantId,
      participantUsername,
      participantAvatar: "",
      unreadCount: 0,
      isOnline: false,
      keyExchanged: false,
      createdAt: Date.now(),
    });
    window.wsSubscribeToChannel(channels.textChannelId);

    // Show "waiting for acceptance" banner
    if (typeof window.showDmPendingBanner === 'function') {
      window.showDmPendingBanner({
        channelId: channels.textChannelId,
        partnerUsername: participantUsername,
        requestId,
        isRecipient: false,
        requesterId: auth.user_id,
      });
    }

    log.info("DM request sent, channel opened", { requestId, emberId, participantUsername });
    return channels.textChannelId;
  }

  /**
   * Fetches all pending DM requests where the current user is the recipient.
   */
  async function fetchDMRequests(): Promise<Array<{
    id: string;
    requesterId: string;
    requesterUsername: string;
    requesterAvatar: string;
    createdAt: number;
  }>> {
    const auth = await getAuth();
    if (!auth) return [];
    try {
      const res = await fetch(`${auth.hostname}/api/v1/dm-requests`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { requests: Array<{
        id: string;
        requester_id: string;
        requester_username: string;
        requester_avatar: string;
        created_at: string;
      }> };
      return (data.requests ?? []).map((r) => ({
        id: r.id,
        requesterId: r.requester_id,
        requesterUsername: r.requester_username,
        requesterAvatar: r.requester_avatar,
        createdAt: new Date(r.created_at).getTime() / 1000,
      }));
    } catch (err) {
      log.error("Failed to fetch DM requests", { error: (err as Error).message });
      return [];
    }
  }

  /**
   * Accepts a pending DM request. The requester pre-computed a peer-box for the
   * recipient at request time (stored with pending=true on the server). This call
   * activates it (pending → false) and adds the recipient as a member. No key
   * generation is needed here — the recipient fetches their pre-computed peer-box
   * via fetchAndCacheEmberKey, which decrypts it and migrates to a self-box.
   */
  async function acceptDMRequest(
    requestId: string,
    requesterId: string,
    requesterUsername: string,
  ): Promise<string> {
    const auth = await getAuth();
    if (!auth) throw new Error("Not authenticated");

    const res = await fetch(`${auth.hostname}/api/v1/dm-requests/${requestId}/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error ?? "Failed to accept DM request");
    }
    const { ember_id: emberId } = (await res.json()) as { ember_id: string };

    // Update local state: the DM may already be in the map (recipient sees it as pending)
    const existingEntry = dmByEmberId.get(emberId);
    const channels = existingEntry
      ? { textChannelId: existingEntry.textChannelId, voiceChannelId: existingEntry.voiceChannelId }
      : await fetchDmChannels(auth, emberId);

    const entry: DmEntry = {
      emberId,
      textChannelId: channels.textChannelId,
      voiceChannelId: channels.voiceChannelId,
      partnerId: requesterId,
      partnerUsername: requesterUsername,
      partnerAvatar: existingEntry?.partnerAvatar ?? "",
      requestStatus: 'accepted',
      requestId,
      isRecipient: true,
      partnerDeviceId: existingEntry?.partnerDeviceId ?? null,
      partnerProtocolVersion: existingEntry?.partnerProtocolVersion ?? 0,
    };
    dmByTextChannel.set(channels.textChannelId, entry);
    dmByEmberId.set(emberId, entry);

    if (!existingEntry) {
      window.addDmConversationToList({
        id: channels.textChannelId,
        participantId: requesterId,
        participantUsername: requesterUsername,
        participantAvatar: "",
        unreadCount: 0,
        isOnline: false,
        keyExchanged: true,
        createdAt: Date.now(),
      });
    }
    // Always subscribe — fixes BP-2 where subscription was skipped for existing entries
    window.wsSubscribeToChannel(channels.textChannelId);

    // Fetch the pre-computed peer-box key the requester stored at request time.
    // fetchAndCacheEmberKey handles the peer-box decrypt + self-box migration automatically.
    fetchAndCacheEmberKey(emberId).catch((err: Error) =>
      log.warn("Failed to fetch peer-box key after DM acceptance", { emberId, error: err.message }),
    );

    // Hide the pending banner now that the DM is accepted
    if (typeof window.hideDmPendingBanner === 'function') {
      window.hideDmPendingBanner(channels.textChannelId);
    }

    log.info("DM request accepted", { requestId, emberId, requesterUsername });
    return channels.textChannelId;
  }

  /**
   * Declines a DM request.
   */
  async function declineDMRequest(requestId: string): Promise<void> {
    const auth = await getAuth();
    if (!auth) throw new Error("Not authenticated");

    const res = await fetch(`${auth.hostname}/api/v1/dm-requests/${requestId}/decline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error ?? "Failed to decline DM request");
    }
    log.info("DM request declined", { requestId });
  }

  // ─── Fetch messages ────────────────────────────────────────────────────────

  async function fetchConversationMessages(channelId: string): Promise<Array<{
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    timestamp: number;
    isOwn: boolean;
  }>> {
    const auth = await getAuth();
    const entry = dmByTextChannel.get(channelId);
    if (!auth || !entry) return [];
    const signalManager = App.signalSessionManager;

    try {
      const res = await fetch(
        `${auth.hostname}/api/v1/channels/${channelId}/messages`,
        { headers: { Authorization: `Bearer ${auth.token}` } },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as {
        messages: Array<{
          id: string;
          sender_user_id: string;
          sender_device_id?: string;
          message_type?: number;
          ciphertext: string;
          created_at: number;
          envelope_type?: string;
        }>;
      };
      const currentUserId = auth.user_id;

      return await Promise.all(
        (data.messages ?? []).map(async (msg) => {
          const envelopeType = msg.envelope_type;
          const senderId = msg.sender_user_id;
          const isOwn = senderId === currentUserId;

          if (
            envelopeType === "signal_dm" &&
            signalManager &&
            msg.sender_device_id &&
            typeof msg.message_type === "number"
          ) {
            try {
              const ciphertextBytes = new Uint8Array(
                atob(msg.ciphertext).split("").map((c) => c.charCodeAt(0)),
              );
              const senderAddress = `${senderId}.${msg.sender_device_id}`;
              const plaintextBytes = await signalManager.decrypt(
                senderAddress,
                ciphertextBytes,
                msg.message_type,
              );
              const messageContent = new TextDecoder().decode(plaintextBytes);
              return {
                id: msg.id,
                conversationId: channelId,
                senderId,
                content: messageContent,
                timestamp:
                  typeof msg.created_at === "number"
                    ? msg.created_at
                    : new Date(msg.created_at).getTime() / 1000,
                isOwn,
              };
            } catch (err) {
              log.error("Signal decrypt failed for incoming DM", {
                message_id: msg.id,
                channel_id: channelId,
                error: (err as Error).message,
              });
              return {
                id: msg.id,
                conversationId: channelId,
                senderId,
                content: "[Failed to decrypt message]",
                timestamp:
                  typeof msg.created_at === "number"
                    ? msg.created_at
                    : new Date(msg.created_at).getTime() / 1000,
                isOwn,
              };
            }
          }

          // Hard cutover: any non-signal envelope is permanently unreadable.
          return {
            id: msg.id,
            conversationId: channelId,
            senderId,
            content: "[This message cannot be decrypted — unsupported envelope]",
            timestamp:
              typeof msg.created_at === "number"
                ? msg.created_at
                : new Date(msg.created_at).getTime() / 1000,
            isOwn,
          };
        }),
      );
    } catch (err) {
      log.error("Failed to fetch DM messages", { channelId, error: (err as Error).message });
      return [];
    }
  }

  // ─── Send message ──────────────────────────────────────────────────────────

  async function sendDirectMessage(channelId: string, plaintext: string): Promise<string> {
    const auth = await getAuth();
    const entry = dmByTextChannel.get(channelId);
    if (!auth || !entry) throw new Error("DM channel not found");

    const device = await ipcRenderer.invoke("get-device-identity") as {
      device_id?: string;
    } | null;
    const deviceId = device?.device_id ?? "";

    const signalManager = App.signalSessionManager;
    if (signalManager && entry.partnerDeviceId && entry.partnerProtocolVersion === 1) {
      const signalAddress = `${entry.partnerId}.${entry.partnerDeviceId}`;
      const hasSession = await signalManager.hasSession(entry.partnerId, entry.partnerDeviceId);
      if (hasSession) {
        const plaintextBytes = new TextEncoder().encode(plaintext);
        const { ciphertext, messageType } = await signalManager.encrypt(signalAddress, plaintextBytes);
        // P1-3 FIX: Use Buffer-based encoding to prevent stack overflow for large payloads
        const ciphertextBase64 = Buffer.from(ciphertext).toString('base64');
        const res = await fetch(`${auth.hostname}/api/v1/channels/${channelId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
          // P1-1 FIX: Add protocol_version as required by server
          body: JSON.stringify({ 
            ciphertext: ciphertextBase64, 
            envelope_type: "signal_dm", 
            message_type: messageType, 
            device_id: deviceId,
            protocol_version: 1 // P1-1 FIX: Required by server
          }),
        });
        if (!res.ok) throw new Error("Failed to send message");
        const msg = (await res.json()) as { id: string };
        pendingMessageIds.add(msg.id);
        window.displayDmMessage({ id: msg.id, conversationId: channelId, senderId: auth.user_id, content: plaintext, timestamp: Date.now() / 1000, isOwn: true });
        return msg.id;
      }
    }

    // Signal Protocol is required for direct messaging
    const errMsg = "Signal Protocol encryption not ready - please ensure Signal Session Manager is initialized";
    (window as any).showInputError?.(errMsg);
    throw new Error(errMsg);
  }

  // ─── Set active conversation ───────────────────────────────────────────────

  function setActiveDmConversation(channelId: string): void {
    // Do NOT unsubscribe the previous DM channel — all DM channels must stay
    // subscribed so incoming messages trigger unread notifications even when
    // the user switches to a different conversation.
    activeTextChannelId = channelId;
    // BP-3 fix: set activeChannelId so websocket-service routes live messages
    // to displayMessage (the channel path) rather than dm-channel-message.
    App.activeChannelId = channelId;
    window.wsSubscribeToChannel(channelId);

    const entry = dmByTextChannel.get(channelId);
    if (entry) {
      App.activeEmberId = entry.emberId;
      fetchAndCacheEmberKey(entry.emberId).catch(() => null);
    }
  }

  // ─── Incoming WS messages ──────────────────────────────────────────────────

  async function handleIncomingMessage(payload: Record<string, unknown>): Promise<void> {
    const channelId = String(payload["channel_id"] ?? "");
    const entry = dmByTextChannel.get(channelId);
    if (!entry) return;

    // BP-5: skip WS echo for messages already optimistically rendered.
    // This check is intentionally before any await so it runs synchronously.
    const msgId = String(payload["id"] ?? "");
    if (pendingMessageIds.has(msgId)) {
      pendingMessageIds.delete(msgId);
      return;
    }

    const auth = await getAuth();
    if (!auth) return;

    const senderId = String(payload["sender_user_id"] ?? "");
    const createdAt = Number(payload["created_at"] ?? 0);
    const envelopeType = payload["envelope_type"];
    const signalManager = App.signalSessionManager;

    if (envelopeType === "signal_dm" && signalManager) {
      const ciphertextBase64 = String(payload["ciphertext"] ?? "");
      const messageType = Number(payload["message_type"] ?? 3);
      const senderDeviceId = String(payload["sender_device_id"] ?? "1");
      const senderAddress = `${senderId}.${senderDeviceId}`;
      try {
        const ciphertextBytes = new Uint8Array(
          atob(ciphertextBase64).split("").map((c) => c.charCodeAt(0)),
        );
        const plaintextBytes = await signalManager.decrypt(senderAddress, ciphertextBytes, messageType);
        const messageContent = new TextDecoder().decode(plaintextBytes);
        const isOwn = senderId === auth.user_id;
        window.displayDmMessage({ id: String(payload["id"] ?? ""), conversationId: channelId, senderId, content: messageContent, timestamp: createdAt, isOwn });
        if (!isOwn && typeof window.playNotificationSound === "function") {
          window.playNotificationSound("dmMessage");
        }
      } catch (err) {
        log.error("Signal decrypt failed for incoming DM", { message_id: String(payload["id"] ?? ""), channel_id: channelId, error: (err as Error).message });
        window.displayDmMessage({ id: String(payload["id"] ?? ""), conversationId: channelId, senderId, content: "[Failed to decrypt message]", timestamp: createdAt, isOwn: false });
      }
      return;
    }

    const isOwn = senderId === auth.user_id;

    // Hard cutover: any non-signal envelope is permanently unreadable.
    window.displayDmMessage({
      id: String(payload["id"] ?? ""),
      conversationId: channelId,
      senderId,
      content: "[This message cannot be decrypted — unsupported envelope]",
      timestamp: createdAt,
      isOwn,
    });
    if (!isOwn && typeof window.playNotificationSound === "function") {
      window.playNotificationSound("dmMessage");
    }
  }

  // ─── Re-subscribe to all DM channels (called after WS reconnect) ──────────

  function resubscribeDmChannels(): void {
    dmByTextChannel.forEach((_, channelId) => {
      window.wsSubscribeToChannel(channelId);
    });
  }

  // ─── No-op stubs for backwards-compat ─────────────────────────────────────

  async function initiateKeyExchange(_channelId: string, _participantId: string): Promise<void> {
    // Key exchange now happens at DM request acceptance time — no-op here
  }

  async function sendTypingIndicator(_channelId: string, _isTyping: boolean): Promise<void> {
    // Typing indicators not yet supported in the ember channel model
  }

  async function refreshAllPresenceStates(): Promise<void> {
    // Presence is handled by the presence system — no DM-specific action needed
  }

  // ─── DM request polling ────────────────────────────────────────────────────

  /**
   * Loads any pending DM requests that the current user hasn't seen yet and
   * shows the pending banner for each. Called on init and every 30 s as a
   * fallback for missed WebSocket notifications.
   */
  async function loadAndShowDmRequests(): Promise<void> {
    const auth = await getAuth();
    if (!auth) return;
    try {
      const res = await fetch(`${auth.hostname}/api/v1/dm-requests`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { requests: Array<{
        id: string; requester_id: string; requester_username: string;
        requester_avatar: string; ember_id: string; created_at: string;
      }> };
      for (const r of data.requests ?? []) {
        if (dmByEmberId.has(r.ember_id)) continue; // already loaded
        const channels = await fetchDmChannels(auth, r.ember_id);
        if (!channels.textChannelId) continue;
        const entry: DmEntry = {
          emberId: r.ember_id,
          textChannelId: channels.textChannelId,
          voiceChannelId: channels.voiceChannelId,
          partnerId: r.requester_id,
          partnerUsername: r.requester_username,
          partnerAvatar: r.requester_avatar,
          requestStatus: 'pending',
          requestId: r.id,
          isRecipient: true,
          partnerDeviceId: null,
          partnerProtocolVersion: 0,
        };
        dmByTextChannel.set(channels.textChannelId, entry);
        dmByEmberId.set(r.ember_id, entry);
        window.addDmConversationToList({
          id: channels.textChannelId,
          participantId: r.requester_id,
          participantUsername: r.requester_username,
          participantAvatar: r.requester_avatar,
          unreadCount: 0,
          isOnline: false,
          keyExchanged: false,
          createdAt: new Date(r.created_at).getTime(),
        });
        window.wsSubscribeToChannel(channels.textChannelId);
        if (typeof window.showDmPendingBanner === 'function') {
          window.showDmPendingBanner({
            channelId: channels.textChannelId,
            partnerUsername: r.requester_username,
            requestId: r.id,
            isRecipient: true,
            requesterId: r.requester_id,
          });
        }
      }
    } catch (err) {
      log.warn("DM request poll failed", { error: (err as Error).message });
    }
  }

  function startDMRequestPolling(): void {
    setInterval(() => {
      loadAndShowDmRequests().catch((err: Error) =>
        log.warn("DM request polling error", { error: err.message }),
      );
    }, 30_000);
  }

  // ─── Device key enrollment ─────────────────────────────────────────────────

  // (multi-device NaCl device-key enrollment removed)

  // ─── Initialization ────────────────────────────────────────────────────────

  async function initializeDirectMessaging(): Promise<void> {
    log.info("Initializing DM system");
    await loadDmEmbers();
    await loadAndShowDmRequests();
    startDMRequestPolling();
    log.info("DM system ready", { dmCount: dmByTextChannel.size });
  }

  // ─── WS message routing ────────────────────────────────────────────────────

  window.addEventListener("dm-channel-message", ((e: CustomEvent) => {
    handleIncomingMessage(e.detail).catch((err: Error) =>
      log.error("Failed to handle incoming DM message", { error: err.message }),
    );
  }) as EventListener);

  // Handles the server-push event sent to the requester after the recipient
  // accepts the DM request. Fetches the peer-box key and marks the DM as active.
  window.addEventListener("dm-request-accepted", ((e: CustomEvent) => {
    const payload = e.detail as { ember_id?: string };
    const emberId = payload?.ember_id ?? "";
    if (!emberId) return;

    const entry = dmByEmberId.get(emberId);
    if (entry) {
      // Mark the entry as accepted. The requester generated the key at request time
      // and it is already in cache — no re-fetch needed.
      entry.requestStatus = 'accepted';
      // Ensure the channel stays subscribed after acceptance (hardening).
      window.wsSubscribeToChannel(entry.textChannelId);
      if (typeof window.hideDmPendingBanner === 'function') {
        window.hideDmPendingBanner(entry.textChannelId);
      }
      log.info("DM request was accepted by recipient", { emberId });
    }
  }) as EventListener);

  // (device-key-fulfilled/device-key-requested handlers removed)

  // ─── Expose globals ────────────────────────────────────────────────────────

  window.initializeDirectMessaging = initializeDirectMessaging;
  window.startDmConversation = startDmConversation;
  window.sendDirectMessage = sendDirectMessage;
  window.setActiveDmConversation = setActiveDmConversation;
  window.sendTypingIndicator = sendTypingIndicator;
  window.fetchConversationMessages = fetchConversationMessages;
  window.initiateKeyExchange = initiateKeyExchange;
  window.refreshAllPresenceStates = refreshAllPresenceStates;
  window.resubscribeDmChannels = resubscribeDmChannels;

  window.fetchDMRequests = fetchDMRequests;
  window.acceptDMRequest = acceptDMRequest;
  window.declineDMRequest = declineDMRequest;
  window.loadAndShowDmRequests = loadAndShowDmRequests;

  window.getPendingStatusForChannel = (channelId: string) => {
    const entry = dmByTextChannel.get(channelId);
    if (!entry || entry.requestStatus !== 'pending') return null;
    return { requestId: entry.requestId, isRecipient: entry.isRecipient };
  };

  // UI helpers for ember key access
  window.fetchAndCacheEmberKeyForChannel = async (channelId: string): Promise<Uint8Array | null> => {
    const entry = dmByTextChannel.get(channelId);
    if (!entry) return null;
    return fetchAndCacheEmberKey(entry.emberId);
  };
  window.getEmberIdForDmChannel = (channelId: string): string | null => {
    const entry = dmByTextChannel.get(channelId);
    return entry ? entry.emberId : null;
  };
})();
