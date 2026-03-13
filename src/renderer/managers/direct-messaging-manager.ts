/**
 * Direct Messaging Manager — TypeScript module.
 * Each DM is a private ember (kind='dm') with a text channel and a voice channel.
 * Uses the standard ember encryption system (NaCl box key exchange + secretbox messages).
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
  }

  const dmByTextChannel = new Map<string, DmEntry>();
  const dmByEmberId = new Map<string, DmEntry>();
  let activeTextChannelId: string | null = null;

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

  async function fetchAndCacheEmberKey(emberId: string): Promise<Uint8Array | null> {
    if (App.emberKeyCache.has(emberId)) return App.emberKeyCache.get(emberId) ?? null;
    const auth = await getAuth();
    const device = await getDevice();
    if (!auth || !device) return null;
    try {
      const res = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/key`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { encrypted_key: string };
      const key = emberCrypto.decryptEmberKeyForUser(
        data.encrypted_key,
        naclUtil.decodeBase64(device.public_key),
        naclUtil.decodeBase64(device.private_key),
      );
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
      }> };
      for (const dm of data.dms ?? []) {
        const channels = await fetchDmChannels(auth, dm.id);
        const entry: DmEntry = {
          emberId: dm.id,
          textChannelId: channels.textChannelId,
          voiceChannelId: channels.voiceChannelId,
          partnerId: dm.partner_id,
          partnerUsername: dm.partner_username,
          partnerAvatar: dm.partner_avatar,
        };
        if (entry.textChannelId) {
          dmByTextChannel.set(entry.textChannelId, entry);
          dmByEmberId.set(entry.emberId, entry);
          window.addDmConversationToList({
            id: entry.textChannelId,
            participantId: entry.partnerId,
            participantUsername: entry.partnerUsername,
            participantAvatar: entry.partnerAvatar,
            unreadCount: 0,
            isOnline: false,
            keyExchanged: true,
            createdAt: Date.now(),
          });
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

  // ─── Start DM / find-or-create ─────────────────────────────────────────────

  async function startDmConversation(
    participantId: string,
    participantUsername: string,
  ): Promise<string> {
    const auth = await getAuth();
    const device = await getDevice();
    if (!auth || !device) throw new Error("Not authenticated");

    const existing = [...dmByTextChannel.values()].find(
      (e) => e.partnerId === participantId,
    );
    if (existing) return existing.textChannelId;

    const partnerDeviceRes = await fetch(
      `${auth.hostname}/api/v1/users/${participantId}/devices`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    let partnerPublicKey: string | null = null;
    if (partnerDeviceRes.ok) {
      const devData = (await partnerDeviceRes.json()) as {
        devices?: Array<{ public_key: string }>;
      };
      partnerPublicKey = devData.devices?.[0]?.public_key ?? null;
    }

    const emberKey = emberCrypto.generateEmberKey();
    const selfPub = naclUtil.decodeBase64(device.public_key);
    const selfPriv = naclUtil.decodeBase64(device.private_key);
    const encryptedKeySelf = emberCrypto.encryptEmberKeyForUser(emberKey, selfPub, selfPriv);
    let encryptedKeyPeer: string;
    if (partnerPublicKey) {
      const peerPub = naclUtil.decodeBase64(partnerPublicKey);
      encryptedKeyPeer = emberCrypto.encryptEmberKeyForUser(emberKey, peerPub, selfPriv);
    } else {
      encryptedKeyPeer = encryptedKeySelf;
    }

    const createRes = await fetch(`${auth.hostname}/api/v1/dms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({
        user_id: participantId,
        encrypted_key_self: encryptedKeySelf,
        encrypted_key_peer: encryptedKeyPeer,
      }),
    });
    if (!createRes.ok) {
      const errData = (await createRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error ?? "Failed to create DM");
    }
    const { id: emberId } = (await createRes.json()) as { id: string };

    App.emberKeyCache.set(emberId, emberKey);

    const channels = await fetchDmChannels(auth, emberId);
    const entry: DmEntry = {
      emberId,
      textChannelId: channels.textChannelId,
      voiceChannelId: channels.voiceChannelId,
      partnerId: participantId,
      partnerUsername: participantUsername,
      partnerAvatar: "",
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
      keyExchanged: true,
      createdAt: Date.now(),
    });

    return channels.textChannelId;
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

    const emberKey = await fetchAndCacheEmberKey(entry.emberId);
    if (!emberKey) return [];

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
        const plaintext = emberCrypto.decryptMessage(msg.ciphertext, emberKey) ?? "";
        return {
          id: msg.id,
          conversationId: channelId,
          senderId: msg.sender_user_id,
          content: plaintext,
          timestamp: typeof msg.created_at === "number" ? msg.created_at : new Date(msg.created_at).getTime() / 1000,
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
    if (!emberKey) throw new Error("Ember key unavailable");

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
    return msg.id;
  }

  // ─── Set active conversation ───────────────────────────────────────────────

  function setActiveDmConversation(channelId: string): void {
    if (activeTextChannelId && activeTextChannelId !== channelId) {
      window.wsUnsubscribeFromChannel(activeTextChannelId);
    }
    activeTextChannelId = channelId;
    window.wsSubscribeToChannel(channelId);

    const entry = dmByTextChannel.get(channelId);
    if (entry) fetchAndCacheEmberKey(entry.emberId).catch(() => null);
  }

  // ─── Incoming WS messages ──────────────────────────────────────────────────

  async function handleIncomingMessage(payload: Record<string, unknown>): Promise<void> {
    const channelId = String(payload["channel_id"] ?? "");
    const entry = dmByTextChannel.get(channelId);
    if (!entry) return;
    const auth = await getAuth();
    if (!auth) return;
    const emberKey = await fetchAndCacheEmberKey(entry.emberId);
    if (!emberKey) return;
    const ciphertext = String(payload["ciphertext"] ?? "");
    const plaintext = emberCrypto.decryptMessage(ciphertext, emberKey) ?? "";
    const senderId = String(payload["sender_user_id"] ?? "");
    const createdAt = Number(payload["created_at"] ?? 0);
    window.displayDmMessage({
      id: String(payload["id"] ?? ""),
      conversationId: channelId,
      senderId,
      content: plaintext,
      timestamp: createdAt,
      isOwn: senderId === auth.user_id,
    });
  }

  // ─── No-op stubs for backwards-compat ─────────────────────────────────────

  async function initiateKeyExchange(_channelId: string, _participantId: string): Promise<void> {
    // Key exchange happens at DM ember creation time — no-op here
  }

  async function sendTypingIndicator(_channelId: string, _isTyping: boolean): Promise<void> {
    // Typing indicators are not supported in the ember channel model yet
  }

  async function refreshAllPresenceStates(): Promise<void> {
    // Presence is handled by the presence system — no DM-specific action needed
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  async function initializeDirectMessaging(): Promise<void> {
    log.info("Initializing DM system");
    await loadDmEmbers();
    log.info("DM system ready", { dmCount: dmByTextChannel.size });
  }

  // ─── WS message routing ────────────────────────────────────────────────────

  window.addEventListener("dm-channel-message", ((e: CustomEvent) => {
    handleIncomingMessage(e.detail).catch((err: Error) =>
      log.error("Failed to handle incoming DM message", { error: err.message }),
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
