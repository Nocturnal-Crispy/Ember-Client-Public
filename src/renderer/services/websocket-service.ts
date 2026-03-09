/**
 * WebSocket service — TypeScript conversion of public/ws-manager.js.
 * Manages the WebSocket connection lifecycle and message routing.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger("WsManager");

  const recentMessageIds = new Set<string>();
  const DEDUP_MAX_SIZE = 50;

  async function connectWebSocket(): Promise<void> {
    if (App.wsConnection && App.wsConnection.readyState === WebSocket.OPEN)
      return;
    log.debug("Connecting WebSocket");
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
      } | null;
      if (!auth || !auth.token || !auth.hostname) return;
      const wsUrl = window.electronAPI.wsService.buildWsUrl(
        auth.hostname,
        auth.token
      );
      const wsBaseUrl = wsUrl.split("?")[0];
      log.info("WebSocket connecting", { url: wsBaseUrl });
      App.wsConnection = new WebSocket(wsUrl);

      App.wsConnection.onopen = () => {
        log.info("WebSocket connected");
        console.log("WebSocket connected");
        if (App.activeChannelId) {
          log.debug("Re-subscribing to active channel", {
            channel_id: App.activeChannelId,
          });
          wsSubscribeToChannel(App.activeChannelId);
        }
        if (App.activeEmberId) {
          log.debug("Re-subscribing to active ember", {
            ember_id: App.activeEmberId,
          });
          wsSubscribeToEmber(App.activeEmberId);
        }
      };

      App.wsConnection.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as {
            type: string;
            payload?: Record<string, unknown>;
          };
          if (data.type === "new_message" && data.payload) {
            log.debug("WebSocket: new_message received", {
              channel_id: String(data.payload["channel_id"] ?? ""),
            });
            window.handleIncomingMessage(
              data.payload as unknown as Parameters<
                typeof window.handleIncomingMessage
              >[0]
            );
          } else if (data.type === "edit_message" && data.payload) {
            log.debug("WebSocket: edit_message received", {
              id: String(data.payload["id"] ?? ""),
            });
            window.handleEditedMessage(
              data.payload as Parameters<typeof window.handleEditedMessage>[0]
            );
          } else if (data.type === "presence_update" && data.payload) {
            log.debug("WebSocket: presence_update", {
              user_id: String(data.payload["user_id"] ?? ""),
              status: String(data.payload["status"] ?? ""),
            });
            handlePresenceUpdate(
              data.payload as Parameters<typeof handlePresenceUpdate>[0]
            );
          } else if (
            data.type === "voice_offer" ||
            data.type === "voice_answer" ||
            data.type === "voice_ice_candidate" ||
            data.type === "voice_speaking" ||
            data.type === "voice_participants" ||
            data.type === "voice_camera_on" ||
            data.type === "voice_camera_off"
          ) {
            if (App.voiceManager)
              (
                App.voiceManager as { handleMessage(d: unknown): void }
              ).handleMessage(data);
          } else if (data.type === "voice_user_joined" && data.payload) {
            log.debug("WebSocket: voice_user_joined", {
              channel_id: String(data.payload["channel_id"] ?? ""),
              user_id: String(data.payload["user_id"] ?? ""),
            });
            window.handleVoiceUserJoined(
              data.payload as Parameters<typeof window.handleVoiceUserJoined>[0]
            );
          } else if (data.type === "voice_user_left" && data.payload) {
            log.debug("WebSocket: voice_user_left", {
              channel_id: String(data.payload["channel_id"] ?? ""),
              user_id: String(data.payload["user_id"] ?? ""),
            });
            window.handleVoiceUserLeft(
              data.payload as Parameters<typeof window.handleVoiceUserLeft>[0]
            );
          } else if (data.type === "ember_updated" && data.payload) {
            log.debug("WebSocket: ember_updated", {
              ember_id: String(data.payload["id"] ?? ""),
              name: String(data.payload["name"] ?? ""),
            });
            handleEmberUpdated(
              data.payload as Parameters<typeof handleEmberUpdated>[0]
            );
          } else if (data.type === "membership_updated" && data.payload) {
            log.debug("WebSocket: membership_updated", {
              ember_id: String(data.payload["ember_id"] ?? ""),
              user_id: String(data.payload["user_id"] ?? ""),
              action: String(data.payload["action"] ?? ""),
            });
            handleMembershipUpdated(
              data.payload as Parameters<typeof handleMembershipUpdated>[0]
            );
          } else if (data.type === "dm_message" && data.payload) {
            log.debug("WebSocket: dm_message received", {
              conversation_id: String(data.payload["conversation_id"] ?? ""),
            });
            handleDmMessage(
              data.payload as unknown as Parameters<typeof handleDmMessage>[0]
            );
          } else if (data.type === "dm_presence_update" && data.payload) {
            log.debug("WebSocket: dm_presence_update", {
              user_id: String(data.payload["user_id"] ?? ""),
              status: String(data.payload["status"] ?? ""),
            });
            handleDmPresenceUpdate(
              data.payload as Parameters<typeof handleDmPresenceUpdate>[0]
            );
          } else if (data.type === "dm_typing" && data.payload) {
            log.debug("WebSocket: dm_typing", {
              conversation_id: String(data.payload["conversation_id"] ?? ""),
              user_id: String(data.payload["user_id"] ?? ""),
              typing: Boolean(data.payload["typing"] ?? false),
            });
            handleDmTypingIndicator(
              data.payload as Parameters<typeof handleDmTypingIndicator>[0]
            );
          }
        } catch (err) {
          log.error("WebSocket message parse error", { error: String(err) });
          console.error("WebSocket message parse error:", err);
        }
      };

      App.wsConnection.onclose = () => {
        log.warn("WebSocket disconnected, scheduling reconnect in 3s");
        console.log("WebSocket disconnected");
        App.wsConnection = null;
        // Capture voice channel before cleanupVoiceOnDisconnect clears App state.
        const rejoinChannelId = App.activeVoiceChannelId;
        const rejoinChannelName = App.activeVoiceChannelName ?? "";
        if (typeof window.cleanupVoiceOnDisconnect === "function") {
          window.cleanupVoiceOnDisconnect();
        }
        if (!App.wsReconnectTimer) {
          App.wsReconnectTimer = setTimeout(() => {
            App.wsReconnectTimer = null;
            log.debug("Attempting WebSocket reconnect");
            connectWebSocket().then(() => {
              if (rejoinChannelId && rejoinChannelName) {
                // Brief delay lets WS subscriptions (ember/channel) settle before
                // sending voice_join, which requires an active channel subscription.
                setTimeout(() => {
                  if (
                    App.wsConnection?.readyState === WebSocket.OPEN &&
                    !App.activeVoiceChannelId
                  ) {
                    log.info("Auto-rejoining voice channel after reconnect", {
                      channel_id: rejoinChannelId,
                    });
                    window
                      .joinVoiceChannel(rejoinChannelId, rejoinChannelName)
                      .catch((e: unknown) =>
                        log.error("Voice auto-rejoin failed", {
                          error: String(e),
                        })
                      );
                  }
                }, 500);
              }
            });
          }, 3000);
        }
      };

      App.wsConnection.onerror = (err: Event) => {
        log.error("WebSocket error", { error: String(err) });
        console.error("WebSocket error:", err);
      };
    } catch (error) {
      const err = error as Error;
      log.error("Failed to connect WebSocket", { error: err.message });
      console.error("Failed to connect WebSocket:", error);
    }
  }

  function wsSubscribeToChannel(channelId: string): void {
    if (!App.wsConnection || App.wsConnection.readyState !== WebSocket.OPEN)
      return;
    log.debug("Subscribing to channel", { channel_id: channelId });
    App.wsConnection.send(
      JSON.stringify({ type: "subscribe", channel_id: channelId })
    );
  }

  function wsSubscribeToEmber(emberId: string): void {
    if (!App.wsConnection || App.wsConnection.readyState !== WebSocket.OPEN)
      return;
    log.debug("Subscribing to ember", { ember_id: emberId });
    App.wsConnection.send(
      JSON.stringify({ type: "subscribe_ember", ember_id: emberId })
    );
  }

  function wsSubscribeToDmConversation(conversationId: string): void {
    if (!App.wsConnection || App.wsConnection.readyState !== WebSocket.OPEN)
      return;
    log.debug("Subscribing to DM conversation", { conversation_id: conversationId });
    App.wsConnection.send(
      JSON.stringify({ type: "subscribe_dm", conversation_id: conversationId })
    );
  }

  function wsUnsubscribeFromDmConversation(conversationId: string): void {
    if (!App.wsConnection || App.wsConnection.readyState !== WebSocket.OPEN)
      return;
    log.debug("Unsubscribing from DM conversation", { conversation_id: conversationId });
    App.wsConnection.send(
      JSON.stringify({ type: "unsubscribe_dm", conversation_id: conversationId })
    );
  }

  function wsUnsubscribeFromChannel(channelId: string): void {
    if (!App.wsConnection || App.wsConnection.readyState !== WebSocket.OPEN)
      return;
    log.debug("Unsubscribing from channel", { channel_id: channelId });
    App.wsConnection.send(
      JSON.stringify({ type: "unsubscribe", channel_id: channelId })
    );
  }

  function registerSentMessageId(id: string): void {
    recentMessageIds.add(id);
    if (recentMessageIds.size > DEDUP_MAX_SIZE) {
      const first = recentMessageIds.values().next().value;
      if (first !== undefined) recentMessageIds.delete(first);
    }
  }

  function handlePresenceUpdate(payload: {
    user_id: string;
    username: string;
    status: string;
  }): void {
    const { user_id, username, status } = payload;
    const memberIdx = App.currentMembers.findIndex(
      (m) => m.user_id === user_id
    );
    if (memberIdx !== -1) {
      App.currentMembers[memberIdx].status = status;
    } else {
      App.currentMembers.push({ user_id, username, status, role: "member" });
    }
    window.renderMemberList(App.currentMembers);
    
    // Also forward to DM system in case this user is a DM participant
    if (typeof window.handleDmPresenceUpdate === "function") {
      window.handleDmPresenceUpdate(payload);
    }
  }

  async function handleIncomingMessage(
    payload: {
      id: string;
      channel_id: string;
      sender_user_id: string;
    } & Record<string, unknown>
  ): Promise<void> {
    if (payload.channel_id !== App.activeChannelId) {
      window.markChannelUnread(payload.channel_id);
      return;
    }
    if (recentMessageIds.has(payload.id)) return;
    const auth = (await ipcRenderer.invoke("get-auth")) as {
      user_id?: string;
    } | null;
    if (auth && payload.sender_user_id === auth.user_id) {
      App.ownedMessageIds.add(payload.id);
      return;
    }
    registerSentMessageId(payload.id);
    window.displayDecryptedMessage(
      payload as unknown as Parameters<typeof window.displayDecryptedMessage>[0]
    );
  }

  function handleEmberUpdated(payload: {
    id: string;
    name: string;
    icon_data?: string;
    created_at: number;
    is_owner: boolean;
  }): void {
    // Update the ember in the current embers list if it exists
    const emberIndex = App.currentEmbers.findIndex(e => e.id === payload.id);
    if (emberIndex !== -1) {
      App.currentEmbers[emberIndex] = {
        id: payload.id,
        name: payload.name,
        icon_data: payload.icon_data || null,
        is_owner: payload.is_owner
      };
      
      // Re-render the server list to show updated ember
      window.renderServerList(App.currentEmbers);
      
      // If this is the currently active ember, update the header and reload content
      if (App.activeEmberId === payload.id) {
        const serverHeader = document.querySelector(".server-header h3");
        if (serverHeader) serverHeader.textContent = payload.name;
        
        // Reload server content to refresh any cached data
        window.loadServerContent(payload.id, payload.name);
      }
    }
  }

  async function handleMembershipUpdated(payload: {
    ember_id: string;
    user_id: string;
    username: string;
    action: string;
  }): Promise<void> {
    const { ember_id, user_id, username, action } = payload;
    
    // Only refresh members list if this is for the currently active ember
    if (App.activeEmberId !== ember_id) {
      log.debug("Membership update for different ember, ignoring", { 
        active_ember_id: App.activeEmberId, 
        update_ember_id: ember_id 
      });
      return;
    }

    log.info("Membership updated, refreshing members list", { 
      ember_id, 
      user_id, 
      username, 
      action 
    });

    // Refresh the members list to get the latest data
    const members = await window.fetchMembers(ember_id);
    window.renderMemberList(members);
  }

  function handleDmMessage(payload: {
    id: string;
    conversation_id: string;
    sender_user_id: string;
    content: string;
    timestamp: number;
  }): void {
    // Forward to Direct Messaging manager if available
    if (typeof window.handleDmMessage === "function") {
      window.handleDmMessage(payload);
    } else {
      log.warn("Direct Messaging manager not available, cannot handle DM message");
    }
  }

  function handleDmPresenceUpdate(payload: {
    user_id: string;
    username: string;
    status: string;
  }): void {
    // Forward to Direct Messaging manager if available
    if (typeof window.handleDmPresenceUpdate === "function") {
      window.handleDmPresenceUpdate(payload);
    } else {
      log.warn("Direct Messaging manager not available, cannot handle DM presence update");
    }
  }

  function handleDmTypingIndicator(payload: {
    conversation_id: string;
    user_id: string;
    typing: boolean;
  }): void {
    // Forward to Direct Messaging manager if available
    if (typeof window.handleDmTypingIndicator === "function") {
      window.handleDmTypingIndicator(payload);
    } else {
      log.warn("Direct Messaging manager not available, cannot handle DM typing indicator");
    }
  }

  function disconnectWebSocket(): void {
    if (App.wsReconnectTimer) {
      clearTimeout(App.wsReconnectTimer);
      App.wsReconnectTimer = null;
    }
    if (App.wsConnection) {
      App.wsConnection.close();
      App.wsConnection = null;
    }
  }

  window.connectWebSocket = connectWebSocket;
  window.disconnectWebSocket = disconnectWebSocket;
  window.wsSubscribeToChannel = wsSubscribeToChannel;
  window.wsUnsubscribeFromChannel = wsUnsubscribeFromChannel;
  window.wsSubscribeToEmber = wsSubscribeToEmber;
  window.wsSubscribeToDmConversation = wsSubscribeToDmConversation;
  window.wsUnsubscribeFromDmConversation = wsUnsubscribeFromDmConversation;
  window.handlePresenceUpdate = handlePresenceUpdate;
  window.handleIncomingMessage =
    handleIncomingMessage as unknown as typeof window.handleIncomingMessage;
  window.handleEmberUpdated = handleEmberUpdated;
  window.handleMembershipUpdated = handleMembershipUpdated;
  window.registerSentMessageId = registerSentMessageId;
})();
