"use strict";
/**
 * WebSocket service — TypeScript conversion of public/ws-manager.js.
 * Manages the WebSocket connection lifecycle and message routing.
 */
(function () {
    const App = window.App;
    const ipcRenderer = window.electronAPI.ipc;
    const log = window.emberLog.createLogger('WsManager');
    async function connectWebSocket() {
        if (App.wsConnection && App.wsConnection.readyState === WebSocket.OPEN)
            return;
        log.debug('Connecting WebSocket');
        try {
            const auth = await ipcRenderer.invoke('get-auth');
            if (!auth || !auth.token || !auth.hostname)
                return;
            const wsBaseUrl = auth.hostname.replace(/^http/, 'ws').replace(/:8085\b/, ':8086') + '/ws';
            log.info('WebSocket connecting', { url: wsBaseUrl });
            const wsUrl = wsBaseUrl + '?token=' + encodeURIComponent(auth.token);
            App.wsConnection = new WebSocket(wsUrl);
            App.wsConnection.onopen = () => {
                log.info('WebSocket connected');
                console.log('WebSocket connected');
                if (App.activeChannelId) {
                    log.debug('Re-subscribing to active channel', { channel_id: App.activeChannelId });
                    wsSubscribeToChannel(App.activeChannelId);
                }
                if (App.activeEmberId) {
                    log.debug('Re-subscribing to active ember', { ember_id: App.activeEmberId });
                    wsSubscribeToEmber(App.activeEmberId);
                }
            };
            App.wsConnection.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'new_message' && data.payload) {
                        log.debug('WebSocket: new_message received', { channel_id: String(data.payload['channel_id'] ?? '') });
                        window.handleIncomingMessage(data.payload);
                    }
                    else if (data.type === 'presence_update' && data.payload) {
                        log.debug('WebSocket: presence_update', { user_id: String(data.payload['user_id'] ?? ''), status: String(data.payload['status'] ?? '') });
                        handlePresenceUpdate(data.payload);
                    }
                    else if (data.type === 'voice_offer' || data.type === 'voice_ice_candidate' ||
                        data.type === 'voice_speaking' || data.type === 'voice_participants' ||
                        data.type === 'voice_camera_on' || data.type === 'voice_camera_off') {
                        if (App.voiceManager)
                            App.voiceManager.handleMessage(data);
                    }
                    else if (data.type === 'voice_user_joined' && data.payload) {
                        log.debug('WebSocket: voice_user_joined', { channel_id: String(data.payload['channel_id'] ?? ''), user_id: String(data.payload['user_id'] ?? '') });
                        window.handleVoiceUserJoined(data.payload);
                    }
                    else if (data.type === 'voice_user_left' && data.payload) {
                        log.debug('WebSocket: voice_user_left', { channel_id: String(data.payload['channel_id'] ?? ''), user_id: String(data.payload['user_id'] ?? '') });
                        window.handleVoiceUserLeft(data.payload);
                    }
                }
                catch (err) {
                    log.error('WebSocket message parse error', { error: String(err) });
                    console.error('WebSocket message parse error:', err);
                }
            };
            App.wsConnection.onclose = () => {
                log.warn('WebSocket disconnected, scheduling reconnect in 3s');
                console.log('WebSocket disconnected');
                App.wsConnection = null;
                if (!App.wsReconnectTimer) {
                    App.wsReconnectTimer = setTimeout(() => {
                        App.wsReconnectTimer = null;
                        log.debug('Attempting WebSocket reconnect');
                        connectWebSocket();
                    }, 3000);
                }
            };
            App.wsConnection.onerror = (err) => {
                log.error('WebSocket error', { error: String(err) });
                console.error('WebSocket error:', err);
            };
        }
        catch (error) {
            const err = error;
            log.error('Failed to connect WebSocket', { error: err.message });
            console.error('Failed to connect WebSocket:', error);
        }
    }
    function wsSubscribeToChannel(channelId) {
        if (!App.wsConnection || App.wsConnection.readyState !== WebSocket.OPEN)
            return;
        log.debug('Subscribing to channel', { channel_id: channelId });
        App.wsConnection.send(JSON.stringify({ type: 'subscribe', channel_id: channelId }));
    }
    function wsSubscribeToEmber(emberId) {
        if (!App.wsConnection || App.wsConnection.readyState !== WebSocket.OPEN)
            return;
        log.debug('Subscribing to ember', { ember_id: emberId });
        App.wsConnection.send(JSON.stringify({ type: 'subscribe_ember', ember_id: emberId }));
    }
    function handlePresenceUpdate(payload) {
        const { user_id, username, status } = payload;
        const memberIdx = App.currentMembers.findIndex(m => m.user_id === user_id);
        if (memberIdx !== -1) {
            App.currentMembers[memberIdx].status = status;
        }
        else {
            App.currentMembers.push({ user_id, username, status, role: 'member' });
        }
        window.renderMemberList(App.currentMembers);
    }
    async function handleIncomingMessage(payload) {
        if (payload.channel_id !== App.activeChannelId)
            return;
        const auth = await ipcRenderer.invoke('get-auth');
        if (auth && payload.sender_user_id === auth.user_id)
            return;
        window.displayDecryptedMessage(payload);
    }
    function disconnectWebSocket() {
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
    window.wsSubscribeToEmber = wsSubscribeToEmber;
    window.handlePresenceUpdate = handlePresenceUpdate;
    window.handleIncomingMessage = handleIncomingMessage;
})();
