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
  const emberCrypto = window.electronAPI.crypto;
  const naclUtil = window.electronAPI.naclUtil;

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
    if (App.emberKeyCache.has(emberId)) return App.emberKeyCache.get(emberId) ?? null;
    const auth = await getAuth();
    const device = await getDevice();
    if (!auth || !device) return null;
    try {
      const res = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/key`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) {
        if (res.status === 404) {
          // Only request enrollment when the DM has already been accepted — meaning
          // the key exists on at least one other device but hasn't been delivered to
          // this one yet. For pending DMs (requester perspective) no key has been
          // created anywhere yet, so enrollment is pointless and misleading.
          const dmEntry = dmByEmberId.get(emberId);
          const isPendingRequester = dmEntry?.requestStatus === 'pending' && !dmEntry.isRecipient;
          if (!isPendingRequester) {
            requestDeviceKeyEnrollment(emberId).catch(() => null);
          }
        }
        return null;
      }
      const data = (await res.json()) as { encrypted_key: string; sender_public_key?: string };
      const ownPub = naclUtil.decodeBase64(device.public_key);
      const ownPriv = naclUtil.decodeBase64(device.private_key);

      let key: Uint8Array | null = null;

      if (data.sender_public_key) {
        // Peer-box path (first fetch after DM acceptance by the other party).
        // sender_public_key is the stored key that was used for encryption —
        // decryption is reliable regardless of subsequent key rotations.
        const senderPub = naclUtil.decodeBase64(data.sender_public_key);
        key = emberCrypto.decryptEmberKeyForUser(data.encrypted_key, senderPub, ownPriv);
        if (key) {
          // Migrate to self-box so all future fetches skip this path.
          const selfBox = emberCrypto.encryptEmberKeyForUser(key, ownPub, ownPriv);
          fetch(`${auth.hostname}/api/v1/embers/${emberId}/key`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${auth.token}`,
            },
            body: JSON.stringify({ encrypted_key: selfBox }),
          }).catch((err: Error) =>
            log.warn("Failed to migrate DM key to self-box", { emberId, error: err.message }),
          );
        }
      } else {
        // Self-box path: standard for all embers (channels and migrated DMs).
        key = emberCrypto.decryptEmberKeyForUser(data.encrypted_key, ownPub, ownPriv);
      }

      if (key) App.emberKeyCache.set(emberId, key);
      return key ?? null;
    } catch (err) {
      log.error("Failed to fetch ember key", { emberId, error: (err as Error).message });
      return null;
    }
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
   * The requester can send messages right away; a "pending" banner is shown until
   * the recipient accepts. Returns the text channel ID so the UI can open the DM.
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

    // Do NOT generate an ember key here — the acceptor creates the single shared
    // key and distributes it via peer-box on acceptance. The requester fetches
    // their peer-box after the DM is accepted (see fetchAndCacheEmberKey).
    const res = await fetch(`${auth.hostname}/api/v1/dm-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ user_id: participantId }),
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
    };
    dmByTextChannel.set(channels.textChannelId, entry);
    dmByEmberId.set(emberId, entry);

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
   * Accepts a pending DM request. The recipient:
   *   1. Generates their own ember key for the DM channel.
   *   2. Seals it as a self-box (encrypted with their own device key pair).
   *   3. Sends the self-box to the server — no peer-box, no cross-user asymmetric
   *      encryption required. Each party only ever encrypts for themselves.
   *
   * The DM ember and channels already exist (created when the request was sent).
   * This call just adds the recipient as a member and stores their key.
   */
  async function acceptDMRequest(
    requestId: string,
    requesterId: string,
    requesterUsername: string,
  ): Promise<string> {
    const auth = await getAuth();
    const device = await getDevice();
    if (!auth || !device) throw new Error("Not authenticated");

    // Acceptor generates the ONE shared ember key and distributes it:
    //   self-box:  encrypted for own device (standard self-box path)
    //   peer-box:  encrypted for each of the requester's registered devices
    const emberKey = emberCrypto.generateEmberKey();
    const ownPub = naclUtil.decodeBase64(device.public_key);
    const ownPriv = naclUtil.decodeBase64(device.private_key);
    const encryptedKeySelf = emberCrypto.encryptEmberKeyForUser(emberKey, ownPub, ownPriv);
    const senderPublicKey = device.public_key; // base64 acceptor pub key stored with peer-box

    // Fetch the requester's registered devices and create one peer-box per device
    // so any of their devices can decrypt the ember key.
    const peerBoxes: Array<{ device_id: string; encrypted_key: string; sender_public_key: string }> = [];
    try {
      const devRes = await fetch(`${auth.hostname}/api/v1/users/${requesterId}/devices`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (devRes.ok) {
        const devData = (await devRes.json()) as {
          devices: Array<{ id: string; public_key: string }>;
        };
        for (const d of devData.devices) {
          if (!d.public_key || !d.id) continue;
          const requesterPub = naclUtil.decodeBase64(d.public_key);
          const encryptedKeyPeer = emberCrypto.encryptEmberKeyForUser(emberKey, requesterPub, ownPriv);
          peerBoxes.push({
            device_id: d.id,
            encrypted_key: encryptedKeyPeer,
            sender_public_key: senderPublicKey,
          });
        }
      }
    } catch (err) {
      log.warn("Failed to fetch requester devices for peer-boxes", {
        requesterId,
        error: (err as Error).message,
      });
    }

    if (peerBoxes.length === 0) {
      throw new Error("Could not create peer-boxes: requester has no registered devices");
    }

    const res = await fetch(`${auth.hostname}/api/v1/dm-requests/${requestId}/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({
        encrypted_key_self: encryptedKeySelf,
        peer_boxes: peerBoxes,
      }),
    });
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error ?? "Failed to accept DM request");
    }
    const { ember_id: emberId } = (await res.json()) as { ember_id: string };

    App.emberKeyCache.set(emberId, emberKey);

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

    // No key exists yet for pending DMs from the requester's perspective — the
    // recipient hasn't accepted yet so there is nothing to decrypt.
    if (entry.requestStatus === 'pending' && !entry.isRecipient) {
      return [];
    }

    const emberKey = await fetchAndCacheEmberKey(entry.emberId);
    if (!emberKey) {
      log.error("Cannot fetch DM messages: ember key unavailable", {
        emberId: entry.emberId,
        channelId,
      });
      return [];
    }

    try {
      const res = await fetch(
        `${auth.hostname}/api/v1/channels/${channelId}/messages`,
        { headers: { Authorization: `Bearer ${auth.token}` } },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as {
        messages: Array<{
          id: string; sender_user_id: string; ciphertext: string; created_at: number;
        }>;
      };
      const currentUserId = auth.user_id;
      return (data.messages ?? []).map((msg) => {
        const plaintext = emberCrypto.decryptMessage(msg.ciphertext, emberKey);
        if (plaintext === null) {
          log.warn("DM message decryption failed", { message_id: msg.id, channel_id: channelId });
        }
        return {
          id: msg.id,
          conversationId: channelId,
          senderId: msg.sender_user_id,
          content: plaintext ?? "[Failed to decrypt message]",
          timestamp: typeof msg.created_at === "number"
            ? msg.created_at
            : new Date(msg.created_at).getTime() / 1000,
          isOwn: msg.sender_user_id === currentUserId,
        };
      });
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

    const emberKey = await fetchAndCacheEmberKey(entry.emberId);
    if (!emberKey) {
      if (entry.requestStatus === 'pending' && !entry.isRecipient) {
        throw new Error(`${entry.partnerUsername} hasn't accepted your message request yet`);
      }
      throw new Error("Ember key unavailable");
    }

    const ciphertext = emberCrypto.encryptMessage(plaintext, emberKey);

    const device = await ipcRenderer.invoke("get-device-identity") as {
      device_id?: string;
    } | null;
    const res = await fetch(`${auth.hostname}/api/v1/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ ciphertext, device_id: device?.device_id ?? "" }),
    });
    if (!res.ok) throw new Error("Failed to send message");
    const msg = (await res.json()) as { id: string };

    // BP-4: Optimistic render — display immediately so the sender doesn't wait
    // for the WS echo. BP-5: register the id so the echo is deduplicated.
    pendingMessageIds.add(msg.id);
    window.displayDmMessage({
      id: msg.id,
      conversationId: channelId,
      senderId: auth.user_id,
      content: plaintext,
      timestamp: Date.now() / 1000,
      isOwn: true,
    });

    return msg.id;
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
    const emberKey = await fetchAndCacheEmberKey(entry.emberId);
    if (!emberKey) {
      log.error("Cannot handle incoming DM message: ember key unavailable", {
        emberId: entry.emberId,
        channelId,
      });
      return;
    }
    const ciphertext = String(payload["ciphertext"] ?? "");
    const plaintext = emberCrypto.decryptMessage(ciphertext, emberKey);
    const senderId = String(payload["sender_user_id"] ?? "");
    const createdAt = Number(payload["created_at"] ?? 0);

    const messageContent = plaintext === null ? "[Failed to decrypt message]" : plaintext;
    if (plaintext === null) {
      log.warn("Incoming DM message decryption failed", {
        message_id: String(payload["id"] ?? ""),
        channel_id: channelId,
      });
    }

    const isOwn = senderId === auth.user_id;
    window.displayDmMessage({
      id: String(payload["id"] ?? ""),
      conversationId: channelId,
      senderId,
      content: messageContent,
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

  /**
   * Signals to other devices of the same user that this device needs the ember
   * key for the given DM. One of the other devices will see this via
   * `fulfillPendingKeyRequests` and deliver a peer-box.
   */
  async function requestDeviceKeyEnrollment(emberId: string): Promise<void> {
    const auth = await getAuth();
    const device = await getDevice();
    if (!auth || !device) return;
    try {
      const res = await fetch(
        `${auth.hostname}/api/v1/embers/${emberId}/device-key-requests`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ device_pub_key: device.public_key }),
        },
      );
      if (!res.ok) {
        log.warn("Failed to request device key enrollment", { emberId });
      } else {
        log.info("Device key enrollment requested", { emberId });
      }
    } catch (err) {
      log.warn("Error requesting device key enrollment", { emberId, error: (err as Error).message });
    }
  }

  /**
   * Checks for pending key requests from other devices of the same user and
   * delivers the ember key encrypted as a peer-box for each requesting device.
   */
  async function fulfillPendingKeyRequests(emberId: string): Promise<void> {
    const auth = await getAuth();
    const device = await getDevice();
    if (!auth || !device) return;
    try {
      const res = await fetch(
        `${auth.hostname}/api/v1/embers/${emberId}/device-key-requests`,
        { headers: { Authorization: `Bearer ${auth.token}` } },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        requests: Array<{
          id: string;
          requesting_device_id: string;
          requesting_device_pub_key: string;
          created_at: number;
        }>;
      };
      if (!data.requests || data.requests.length === 0) return;

      const emberKey = await fetchAndCacheEmberKey(emberId);
      if (!emberKey) return;

      const ownPriv = naclUtil.decodeBase64(device.private_key);

      for (const req of data.requests) {
        try {
          const recipientPub = naclUtil.decodeBase64(req.requesting_device_pub_key);
          const encryptedKey = emberCrypto.encryptEmberKeyForUser(emberKey, recipientPub, ownPriv);
          const fulfillRes = await fetch(
            `${auth.hostname}/api/v1/embers/${emberId}/device-key-requests/${req.requesting_device_id}/fulfill`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${auth.token}`,
              },
              body: JSON.stringify({
                encrypted_key: encryptedKey,
                sender_public_key: device.public_key,
              }),
            },
          );
          if (!fulfillRes.ok) {
            log.warn("Failed to fulfill device key request", { emberId, deviceId: req.requesting_device_id });
          } else {
            log.info("Device key request fulfilled", { emberId, deviceId: req.requesting_device_id });
          }
        } catch (err) {
          log.warn("Error fulfilling device key request", {
            emberId,
            deviceId: req.requesting_device_id,
            error: (err as Error).message,
          });
        }
      }
    } catch (err) {
      log.warn("Failed to fetch pending key requests", { emberId, error: (err as Error).message });
    }
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  async function initializeDirectMessaging(): Promise<void> {
    log.info("Initializing DM system");
    await loadDmEmbers();
    await loadAndShowDmRequests();
    startDMRequestPolling();
    // On startup, fulfill any pending key requests from other devices of the
    // same user that haven't been served yet (e.g. another device came online
    // while this device was offline).
    for (const emberId of dmByEmberId.keys()) {
      fulfillPendingKeyRequests(emberId).catch((err: Error) =>
        log.warn("Failed to fulfill pending key requests on startup", { emberId, error: err.message }),
      );
    }
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
      // Mark the entry as accepted and refresh the key from the server (peer-box).
      App.emberKeyCache.delete(emberId); // force re-fetch to get the peer-box
      entry.requestStatus = 'accepted';
      fetchAndCacheEmberKey(emberId).catch((err: Error) =>
        log.warn("Failed to fetch key after DM acceptance", { emberId, error: err.message }),
      );
      // Ensure the channel stays subscribed after acceptance (hardening).
      window.wsSubscribeToChannel(entry.textChannelId);
      if (typeof window.hideDmPendingBanner === 'function') {
        window.hideDmPendingBanner(entry.textChannelId);
      }
      log.info("DM request was accepted by recipient", { emberId });
    }
  }) as EventListener);

  // Handles the server push when another device fulfills this device's key request.
  // Clears the stale cache entry and re-fetches the newly delivered key.
  window.addEventListener("device-key-fulfilled", ((e: CustomEvent) => {
    const payload = e.detail as { ember_id?: string; requesting_device_id?: string };
    const emberId = payload?.ember_id ?? "";
    if (!emberId) return;

    App.emberKeyCache.delete(emberId);
    fetchAndCacheEmberKey(emberId).catch((err: Error) =>
      log.warn("Failed to re-fetch key after device key fulfillment", { emberId, error: err.message }),
    );
  }) as EventListener);

  // Handles the server push when another device of the same user requests a key.
  // Fulfills the request immediately so the new device can decrypt messages.
  window.addEventListener("device-key-requested", ((e: CustomEvent) => {
    const payload = e.detail as { ember_id?: string };
    const emberId = payload?.ember_id ?? "";
    if (!emberId) return;

    fulfillPendingKeyRequests(emberId).catch((err: Error) =>
      log.warn("Failed to fulfill pending key requests on WS push", { emberId, error: err.message }),
    );
  }) as EventListener);

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

  window.requestDeviceKeyEnrollment = requestDeviceKeyEnrollment;
  window.fulfillPendingKeyRequests = fulfillPendingKeyRequests;

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
