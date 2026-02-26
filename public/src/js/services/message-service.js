"use strict";
/**
 * Message service — TypeScript conversion of public/message-manager.js.
 * Handles message fetch, encrypt/send, decrypt/display.
 */
(function () {
    const App = window.App;
    const ipcRenderer = window.electronAPI.ipc;
    const log = window.emberLog.createLogger('MessageManager');
    const emberCrypto = window.electronAPI.crypto;
    const messagesContainer = document.getElementById('messages');
    async function sendEncryptedMessage(plaintext) {
        if (!App.activeChannelId || !App.activeEmberId)
            return;
        const emberKey = App.emberKeyCache.get(App.activeEmberId);
        if (!emberKey) {
            log.error('Cannot send message: no ember key in cache', { ember_id: App.activeEmberId });
            console.error('No ember key available for encryption');
            return;
        }
        log.debug('Sending encrypted message', { channel_id: App.activeChannelId });
        try {
            const auth = await ipcRenderer.invoke('get-auth');
            if (!auth || !auth.token || !auth.hostname)
                return;
            const ciphertext = emberCrypto.encryptMessage(plaintext, emberKey);
            const response = await fetch(`${auth.hostname}/api/v1/channels/${App.activeChannelId}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`
                },
                body: JSON.stringify({ ciphertext })
            });
            if (response.ok) {
                const msgData = await response.json();
                log.debug('Message sent successfully', { channel_id: App.activeChannelId, message_id: msgData.id });
                displayDecryptedMessage(msgData);
            }
            else {
                log.error('Failed to send message', { status: response.status, channel_id: App.activeChannelId });
                console.error('Failed to send message');
            }
        }
        catch (error) {
            const err = error;
            log.error('Error sending message', { channel_id: App.activeChannelId ?? '', error: err.message });
            console.error('Error sending message:', error);
        }
    }
    function formatTimestamp(unixSeconds) {
        const date = unixSeconds ? new Date(unixSeconds * 1000) : new Date();
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();
        const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        if (isToday)
            return `Today at ${timeStr}`;
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString())
            return `Yesterday at ${timeStr}`;
        return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${timeStr}`;
    }
    function addMessage(author, text, timestamp) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        const timeString = formatTimestamp(timestamp);
        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.textContent = author.charAt(0).toUpperCase();
        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        const headerEl = document.createElement('div');
        headerEl.className = 'message-header';
        const authorEl = document.createElement('span');
        authorEl.className = 'message-author';
        authorEl.textContent = author;
        const tsEl = document.createElement('span');
        tsEl.className = 'message-timestamp';
        tsEl.textContent = timeString;
        headerEl.appendChild(authorEl);
        headerEl.appendChild(tsEl);
        const textEl = document.createElement('div');
        textEl.className = 'message-text';
        textEl.textContent = text;
        contentEl.appendChild(headerEl);
        contentEl.appendChild(textEl);
        messageDiv.appendChild(avatarEl);
        messageDiv.appendChild(contentEl);
        if (messagesContainer) {
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
    function displayDecryptedMessage(msg) {
        if (!App.activeEmberId)
            return;
        const emberKey = App.emberKeyCache.get(App.activeEmberId);
        if (!emberKey) {
            log.warn('Cannot decrypt message: ember key not in cache', { ember_id: App.activeEmberId, message_id: msg.id });
            addMessage(msg.username ?? 'Unknown', '[Encrypted message - key unavailable]', msg.created_at);
            return;
        }
        const plaintext = emberCrypto.decryptMessage(msg.ciphertext, emberKey);
        if (plaintext === null) {
            log.warn('Message decryption failed', { message_id: msg.id });
            addMessage(msg.username ?? 'Unknown', '[Failed to decrypt message]', msg.created_at);
            return;
        }
        addMessage(msg.username ?? 'Unknown', plaintext, msg.created_at);
    }
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    async function fetchMessages(channelId) {
        log.debug('Fetching messages', { channel_id: channelId });
        try {
            const auth = await ipcRenderer.invoke('get-auth');
            if (!auth || !auth.token || !auth.hostname)
                return [];
            const response = await fetch(`${auth.hostname}/api/v1/channels/${channelId}/messages`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${auth.token}` }
            });
            if (!response.ok) {
                log.error('Failed to fetch messages', { status: response.status, channel_id: channelId });
                return [];
            }
            const data = await response.json();
            const messages = data.messages ?? [];
            log.debug('Messages fetched', { channel_id: channelId, count: messages.length });
            return messages;
        }
        catch (error) {
            const err = error;
            log.error('Error fetching messages', { channel_id: channelId, error: err.message });
            console.error('Error fetching messages:', error);
            return [];
        }
    }
    async function loadChannelMessages(channelId) {
        if (!messagesContainer)
            return;
        log.info('Loading channel messages', { channel_id: channelId });
        while (messagesContainer.firstChild)
            messagesContainer.removeChild(messagesContainer.firstChild);
        App.activeChannelId = channelId;
        window.wsSubscribeToChannel(channelId);
        const messages = await fetchMessages(channelId);
        log.debug('Rendering messages', { channel_id: channelId, count: messages.length });
        messages.forEach(msg => displayDecryptedMessage(msg));
    }
    window.sendEncryptedMessage = sendEncryptedMessage;
    window.displayDecryptedMessage = displayDecryptedMessage;
    window.escapeHtml = escapeHtml;
    window.loadChannelMessages = loadChannelMessages;
    window.fetchMessages = fetchMessages;
    window.addMessage = addMessage;
    window.formatTimestamp = formatTimestamp;
})();
