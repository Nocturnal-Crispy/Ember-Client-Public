/**
 * WebSocket service — TypeScript conversion of public/ws-manager.js.
 * Manages the WebSocket connection lifecycle and message routing.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('WsManager');

  const recentMessageIds = new Set<string>();
  const DEDUP_MAX_SIZE = 50;

  /** Refresh the stored token if it is expiring within 1 hour. */
  async function refreshTokenIfNeeded(): Promise<void> {
    try {
      const auth = (await ipcRenderer.invoke('get-auth')) as {
        token?: string;
        hostname?: string;
        userId?: string;
        deviceId?: string;
        username?: string;
      } | null;
      if (!auth || !auth.token || !auth.hostname) return;
      const REFRESH_THRESHOLD_SECONDS = 3600; // 1 hour
      if (
        !window.electronAPI.tokenUtils.isTokenExpiringSoon(auth.token, REFRESH_THRESHOLD_SECONDS)
      ) {
        return;
      }
      log.info('Token expiring soon, refreshing');
      const refreshed = await window.electronAPI.authService.refreshToken(
        auth.hostname,
        auth.token
      );
      await ipcRenderer.invoke('save-auth', {
        token: refreshed.token,
        userId: refreshed.userId,
        deviceId: refreshed.deviceId,
        hostname: auth.hostname,
        username: refreshed.username,
      });
      log.info('Token refreshed successfully');
    } catch (err) {
      log.warn('Token refresh failed, continuing with existing token', { error: String(err) });
    }
  }

  async function connectWebSocket(): Promise<void> {
    if (App.wsConnection && App.wsConnection.readyState === WebSocket.OPEN) return;
    log.debug('Connecting WebSocket');
    try {
      await refreshTokenIfNeeded();
      const auth = (await ipcRenderer.invoke('get-auth')) as {
        token?: string;
        hostname?: string;
      } | null;
      if (!auth || !auth.token || !auth.hostname) return;
      const wsUrl = window.electronAPI.wsService.buildWsUrl(auth.hostname, auth.token);
      const wsBaseUrl = wsUrl.split('?')[0];
      log.info('WebSocket connecting', { url: wsBaseUrl });
      App.wsConnection = new WebSocket(wsUrl);

      App.wsConnection.onopen = () => {
        log.info('WebSocket connected');
        console.log('WebSocket connected');
        if (App.activeChannelId) {
          log.debug('Re-subscribing to active channel', {
            channel_id: App.activeChannelId,
          });
          wsSubscribeToChannel(App.activeChannelId);
        }
        if (App.activeEmberId) {
          log.debug('Re-subscribing to active ember', {
            ember_id: App.activeEmberId,
          });
          wsSubscribeToEmber(App.activeEmberId);
        }
        if (typeof window.resubscribeDmChannels === 'function') {
          log.debug('Re-subscribing to DM channels');
          window.resubscribeDmChannels();
        }
        // Sync CRK envelopes for missed epoch rotations while offline
        if (App.historyCryptoService?.syncAllCrks) {
          App.historyCryptoService
            .syncAllCrks()
            .catch((e: unknown) => log.warn('CRK sync on reconnect failed', { error: String(e) }));
        }
      };

      App.wsConnection.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as {
            type: string;
            payload?: Record<string, unknown>;
          };
          if (data.type === 'new_message' && data.payload) {
            log.debug('WebSocket: new_message received', {
              channel_id: String(data.payload['channel_id'] ?? ''),
            });
            window.handleIncomingMessage(
              data.payload as unknown as Parameters<typeof window.handleIncomingMessage>[0]
            );
          } else if (data.type === 'edit_message' && data.payload) {
            log.debug('WebSocket: edit_message received', {
              id: String(data.payload['id'] ?? ''),
            });
            window.handleEditedMessage(
              data.payload as unknown as Parameters<typeof window.handleEditedMessage>[0]
            );
          } else if (data.type === 'delete_message' && data.payload) {
            const msgId = String(data.payload['id'] ?? '');
            log.debug('WebSocket: delete_message received', { id: msgId });
            if (msgId) {
              const el = document.querySelector(`[data-message-id="${CSS.escape(msgId)}"]`);
              if (el) el.remove();
            }
          } else if (data.type === 'presence_update' && data.payload) {
            log.debug('WebSocket: presence_update', {
              user_id: String(data.payload['user_id'] ?? ''),
              status: String(data.payload['status'] ?? ''),
            });
            handlePresenceUpdate(data.payload as Parameters<typeof handlePresenceUpdate>[0]);
          } else if (
            data.type === 'voice_offer' ||
            data.type === 'voice_answer' ||
            data.type === 'voice_ice_candidate' ||
            data.type === 'voice_speaking' ||
            data.type === 'voice_participants' ||
            data.type === 'voice_camera_on' ||
            data.type === 'voice_camera_off' ||
            data.type === 'screen_share_start' ||
            data.type === 'screen_share_stop' ||
            data.type === 'voice_renegotiate_answer'
          ) {
            if (App.voiceManager)
              (App.voiceManager as { handleMessage(d: unknown): void }).handleMessage(data);
          } else if (data.type === 'voice_user_joined' && data.payload) {
            log.debug('WebSocket: voice_user_joined', {
              channel_id: String(data.payload['channel_id'] ?? ''),
              user_id: String(data.payload['user_id'] ?? ''),
            });
            window.handleVoiceUserJoined(
              data.payload as Parameters<typeof window.handleVoiceUserJoined>[0]
            );
          } else if (data.type === 'voice_user_left' && data.payload) {
            log.debug('WebSocket: voice_user_left', {
              channel_id: String(data.payload['channel_id'] ?? ''),
              user_id: String(data.payload['user_id'] ?? ''),
            });
            window.handleVoiceUserLeft(
              data.payload as Parameters<typeof window.handleVoiceUserLeft>[0]
            );
          } else if (data.type === 'ember_updated' && data.payload) {
            log.debug('WebSocket: ember_updated', {
              ember_id: String(data.payload['id'] ?? ''),
              name: String(data.payload['name'] ?? ''),
            });
            handleEmberUpdated(data.payload as Parameters<typeof handleEmberUpdated>[0]);
          } else if (data.type === 'membership_updated' && data.payload) {
            log.debug('WebSocket: membership_updated', {
              ember_id: String(data.payload['ember_id'] ?? ''),
              user_id: String(data.payload['user_id'] ?? ''),
              action: String(data.payload['action'] ?? ''),
            });
            handleMembershipUpdated(data.payload as Parameters<typeof handleMembershipUpdated>[0]);
          } else if (data.type === 'member_updated' && data.payload) {
            log.debug('WebSocket: member_updated', {
              user_id: String(data.payload['user_id'] ?? ''),
            });
            if (typeof window.handleMemberUpdate === 'function') {
              window.handleMemberUpdate(
                data.payload as Parameters<typeof window.handleMemberUpdate>[0]
              );
            }
          } else if (data.type === 'dm_request_received') {
            log.info('WebSocket: dm_request_received');
            if (typeof window.loadAndShowDmRequests === 'function') {
              window.loadAndShowDmRequests().catch((err: Error) =>
                log.error('Failed to load DM requests after WS notification', {
                  error: err.message,
                })
              );
            }
          } else if (data.type === 'dm_request_accepted') {
            log.info('WebSocket: dm_request_accepted');
            window.dispatchEvent(new CustomEvent('dm-request-accepted', { detail: data.payload }));
          } else if (data.type === 'device_key_requested') {
            log.info('WebSocket: device_key_requested');
            window.dispatchEvent(new CustomEvent('device-key-requested', { detail: data.payload }));
          } else if (data.type === 'device_key_fulfilled') {
            log.info('WebSocket: device_key_fulfilled');
            window.dispatchEvent(new CustomEvent('device-key-fulfilled', { detail: data.payload }));
          } else if (data.type === 'sender_key_rotation_required' && data.payload) {
            log.info('WebSocket: sender key rotation required', {
              ember_id: String(data.payload['ember_id'] ?? ''),
              removed_user_id: String(data.payload['removed_user_id'] ?? ''),
              new_epoch: Number(data.payload['new_epoch'] ?? 0),
            });
            const emberId = String(data.payload['ember_id'] ?? '');
            if (emberId) {
              window.cryptoRouting.onMemberRemoved(emberId, 0);
              window.handleSenderKeyMemberLeft(emberId);
            }
          } else if (data.type === 'crk_rotation_required' && data.payload) {
            const emberId = String(data.payload['emberId'] ?? '');
            const epochNumber = Number(data.payload['epochNumber'] ?? 0);
            const reason = String(data.payload['reason'] ?? '');
            log.info('WebSocket: CRK rotation required', {
              ember_id: emberId,
              epoch: epochNumber,
              reason,
            });
            if (emberId && epochNumber > 0) {
              window.handleCrkRotation?.(emberId, epochNumber);
            }
          } else if (data.type === 'device_revoked' && data.payload) {
            const deviceId = String(data.payload['deviceId'] ?? '');
            log.info('WebSocket: device revoked', { device_id: deviceId });
            window.dispatchEvent(new CustomEvent('device-revoked', { detail: data.payload }));
          }
        } catch (err) {
          log.error('WebSocket message parse error', { error: String(err) });
          console.error('WebSocket message parse error:', err);
        }
      };

      App.wsConnection.onclose = () => {
        log.warn('WebSocket disconnected, scheduling reconnect in 3s');
        console.log('WebSocket disconnected');
        App.wsConnection = null;
        // Capture voice channel before cleanupVoiceOnDisconnect clears App state.
        const rejoinChannelId = App.activeVoiceChannelId;
        const rejoinChannelName = App.activeVoiceChannelName ?? '';
        if (typeof window.cleanupVoiceOnDisconnect === 'function') {
          window.cleanupVoiceOnDisconnect();
        }
        if (!App.wsReconnectTimer) {
          App.wsReconnectTimer = setTimeout(() => {
            App.wsReconnectTimer = null;
            log.debug('Attempting WebSocket reconnect');
            connectWebSocket().then(() => {
              if (rejoinChannelId && rejoinChannelName) {
                // Brief delay lets WS subscriptions (ember/channel) settle before
                // sending voice_join, which requires an active channel subscription.
                setTimeout(() => {
                  if (
                    App.wsConnection?.readyState === WebSocket.OPEN &&
                    !App.activeVoiceChannelId
                  ) {
                    log.info('Auto-rejoining voice channel after reconnect', {
                      channel_id: rejoinChannelId,
                    });
                    window
                      .joinVoiceChannel(rejoinChannelId, rejoinChannelName)
                      .catch((e: unknown) =>
                        log.error('Voice auto-rejoin failed', {
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
        log.error('WebSocket error', { error: String(err) });
        console.error('WebSocket error:', err);
      };
    } catch (error) {
      const err = error as Error;
      log.error('Failed to connect WebSocket', { error: err.message });
      console.error('Failed to connect WebSocket:', error);
    }
  }

  function wsSubscribeToChannel(channelId: string): void {
    if (!App.wsConnection || App.wsConnection.readyState !== WebSocket.OPEN) return;
    log.debug('Subscribing to channel', { channel_id: channelId });
    App.wsConnection.send(JSON.stringify({ type: 'subscribe', channel_id: channelId }));
  }

  function wsSubscribeToEmber(emberId: string): void {
    if (!App.wsConnection || App.wsConnection.readyState !== WebSocket.OPEN) return;
    log.debug('Subscribing to ember', { ember_id: emberId });
    App.wsConnection.send(JSON.stringify({ type: 'subscribe_ember', ember_id: emberId }));
  }

  function wsUnsubscribeFromChannel(channelId: string): void {
    if (!App.wsConnection || App.wsConnection.readyState !== WebSocket.OPEN) return;
    log.debug('Unsubscribing from channel', { channel_id: channelId });
    App.wsConnection.send(JSON.stringify({ type: 'unsubscribe', channel_id: channelId }));
  }

  function registerSentMessageId(id: string): void {
    recentMessageIds.add(id);
    if (recentMessageIds.size > DEDUP_MAX_SIZE) {
      const first = recentMessageIds.values().next().value;
      if (first !== undefined) recentMessageIds.delete(first);
    }
  }

  function handlePresenceUpdate(payload: {
    userId: string;
    username: string;
    status: UserStatus;
    customStatus?: string;
    statusEmoji?: string;
  }): void {
    const { userId, username, status, customStatus, statusEmoji } = payload;
    const memberIdx = App.currentMembers.findIndex(m => m.userId === userId);
    if (memberIdx !== -1) {
      App.currentMembers[memberIdx].status = status;
      if (customStatus !== undefined) {
        App.currentMembers[memberIdx].customStatus = customStatus;
      }
      if (statusEmoji !== undefined) {
        App.currentMembers[memberIdx].statusEmoji = statusEmoji;
      }
    } else {
      App.currentMembers.push({
        userId,
        username,
        status,
        role: 'member',
        customStatus,
        statusEmoji,
      });
    }
    window.renderMemberList(App.currentMembers);

    // Also forward to DM system in case this user is a DM participant
    if (typeof window.handleDmPresenceUpdate === 'function') {
      window.handleDmPresenceUpdate(payload);
    }
  }

  async function handleIncomingMessage(
    payload: {
      id: string;
      channelId: string;
      senderUserId: string;
    } & Record<string, unknown>
  ): Promise<void> {
    // Check if this is a DM channel by checking if there's a DM entry for this channel
    const isDmChannel =
      typeof window.getEmberIdForDmChannel === 'function' &&
      window.getEmberIdForDmChannel(payload.channelId) !== null;

    if (isDmChannel) {
      // Always dispatch DM messages as dm-channel-message events
      window.dispatchEvent(new CustomEvent('dm-channel-message', { detail: payload }));
      // Mark as unread if not the active channel
      if (payload.channelId !== App.activeChannelId) {
        window.markChannelUnread(payload.channelId);
      }
      return;
    }

    // Handle regular channel messages
    if (payload.channelId !== App.activeChannelId) {
      window.markChannelUnread(payload.channelId);
      return;
    }
    if (recentMessageIds.has(payload.id)) return;
    const auth = (await ipcRenderer.invoke('get-auth')) as {
      userId?: string;
    } | null;
    if (auth && payload.senderUserId === auth.userId) {
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
    iconData?: string;
    createdAt: number;
    isOwner: boolean;
  }): void {
    // Update the ember in the current embers list if it exists
    const emberIndex = App.currentEmbers.findIndex(e => e.id === payload.id);
    if (emberIndex !== -1) {
      App.currentEmbers[emberIndex] = {
        id: payload.id,
        name: payload.name,
        iconData: payload.iconData || null,
        isOwner: payload.isOwner,
      };

      // Re-render the server list to show updated ember
      window.renderServerList(App.currentEmbers);

      // If this is the currently active ember, update the header and reload content
      if (App.activeEmberId === payload.id) {
        const serverHeader = document.querySelector('.server-header h3');
        if (serverHeader) serverHeader.textContent = payload.name;

        // Reload server content to refresh any cached data
        window.loadServerContent(payload.id, payload.name);
      }
    }
  }

  async function handleMembershipUpdated(payload: {
    emberId: string;
    userId: string;
    username: string;
    action: string;
  }): Promise<void> {
    const { emberId, userId, username, action } = payload;

    log.info('Membership updated', {
      ember_id: emberId,
      user_id: userId,
      username,
      action,
    });

    // CRK re-wrapping for new members — runs regardless of active ember.
    // Re-encrypts all prior epoch CRKs so the new member can read history.
    if (action === 'joined') {
      const historyCrypto = App.historyCryptoService;
      if (historyCrypto) {
        (async () => {
          try {
            const auth = await window.getValidAuth();
            if (!auth) return;
            // Don't re-wrap for ourselves joining
            if (userId === auth.userId) return;
            // Only the ember owner's device performs re-wrapping to avoid
            // write amplification when many devices are online.
            const embers = await window.fetchEmbers();
            const ember = embers.find(e => e.id === emberId);
            if (!ember || !ember.isOwner) return;
            // Verify the new member is actually in the ember's member list
            // before trusting the WebSocket event payload.
            const members = await window.fetchMembers(emberId);
            const isMember = members.some(m => m.userId === userId);
            if (!isMember) return;
            const devicesResp = await fetch(
              `${auth.hostname.startsWith('http') ? auth.hostname : `https://${auth.hostname}`}/api/v1/users/${userId}/devices`,
              { headers: { Authorization: `Bearer ${auth.token}` } }
            );
            if (!devicesResp.ok) return;
            const devicesData = (await devicesResp.json()) as {
              devices: Array<{ id: string; userId?: string }>;
            };
            const newMemberDevices = (devicesData.devices ?? []).map(d => ({
              userId,
              deviceId: d.id,
            }));
            if (newMemberDevices.length === 0) return;
            const count = await historyCrypto.rewrapCrksForNewMember(emberId, newMemberDevices);
            if (count > 0) {
              log.info('CRK re-wrapped for new member', {
                ember_id: emberId,
                user_id: userId,
                epochs_rewrapped: count,
              });
            }
          } catch (e) {
            log.warn('CRK re-wrap for new member failed', {
              ember_id: emberId,
              user_id: userId,
              error: String(e),
            });
          }
        })();
      }
    }

    // Only refresh UI if this is for the currently active ember
    if (App.activeEmberId !== emberId) {
      return;
    }

    // Refresh the members list to get the latest data
    const members = await window.fetchMembers(emberId);
    window.renderMemberList(members);

    // Update crypto routing state based on membership change
    const memberCount = members.length;
    if (action === 'joined') {
      window.cryptoRouting.onMemberAdded(emberId, memberCount);
    } else if (action === 'left' || action === 'kicked' || action === 'removed') {
      window.cryptoRouting.onMemberRemoved(emberId, memberCount);
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
  window.handlePresenceUpdate = handlePresenceUpdate;
  window.handleIncomingMessage =
    handleIncomingMessage as unknown as typeof window.handleIncomingMessage;
  window.handleEmberUpdated = handleEmberUpdated;
  window.handleMembershipUpdated = handleMembershipUpdated;
  window.registerSentMessageId = registerSentMessageId;
})();
