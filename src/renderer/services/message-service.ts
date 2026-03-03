/**
 * Message service — TypeScript conversion of public/message-manager.js.
 * Handles message fetch, encrypt/send, decrypt/display.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('MessageManager');
  const emberCrypto = window.electronAPI.crypto;

  const messagesContainer = document.getElementById('messages');

  // Pagination state (per channel load)
  let hasMoreMessages = false;
  let oldestMessageId: string | null = null;
  let isLoadingOlderMessages = false;

  async function sendEncryptedMessage(plaintext: string): Promise<void> {
    if (!App.activeChannelId || !App.activeEmberId) return;
    const emberKey = App.emberKeyCache.get(App.activeEmberId);
    if (!emberKey) {
      log.error('Cannot send message: no ember key in cache', { ember_id: App.activeEmberId });
      console.error('No ember key available for encryption');
      return;
    }
    log.debug('Sending encrypted message', { channel_id: App.activeChannelId });
    try {
      const auth = await ipcRenderer.invoke('get-auth') as AuthData | null;
      if (!auth || !auth.token || !auth.hostname) return;
      const msgData = await window.electronAPI.messageService.sendMessage(auth, App.activeChannelId, plaintext, emberKey);
      log.debug('Message sent successfully', { channel_id: App.activeChannelId, message_id: msgData.id });
      window.registerSentMessageId(msgData.id);
      displayDecryptedMessage(msgData);
    } catch (error) {
      const err = error as Error;
      log.error('Error sending message', { channel_id: App.activeChannelId ?? '', error: err.message });
      console.error('Error sending message:', error);
    }
  }

  function formatTimestamp(unixSeconds?: number): string {
    const date = unixSeconds ? new Date(unixSeconds * 1000) : new Date();
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (isToday) return `Today at ${timeStr}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${timeStr}`;
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${timeStr}`;
  }

  function addMessage(author: string, text: string, timestamp?: number, prepend = false): void {
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
      if (prepend) {
        const banner = messagesContainer.querySelector('.channel-welcome-banner');
        const referenceNode = banner ? banner.nextSibling : messagesContainer.firstChild;
        messagesContainer.insertBefore(messageDiv, referenceNode);
      } else {
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }
  }

  function displayDecryptedMessage(msg: Message, prepend = false): void {
    if (!App.activeEmberId) return;
    const emberKey = App.emberKeyCache.get(App.activeEmberId);
    if (!emberKey) {
      log.warn('Cannot decrypt message: ember key not in cache', { ember_id: App.activeEmberId, message_id: msg.id });
      addMessage(msg.username ?? 'Unknown', '[Encrypted message - key unavailable]', msg.created_at, prepend);
      return;
    }
    const plaintext = emberCrypto.decryptMessage(msg.ciphertext, emberKey);
    if (plaintext === null) {
      log.warn('Message decryption failed', { message_id: msg.id });
      addMessage(msg.username ?? 'Unknown', '[Failed to decrypt message]', msg.created_at, prepend);
      return;
    }
    addMessage(msg.username ?? 'Unknown', plaintext, msg.created_at, prepend);
  }

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  interface FetchResult {
    messages: Message[];
    hasMore: boolean;
  }

  async function fetchMessages(channelId: string, beforeId: string | null = null): Promise<FetchResult> {
    log.debug('Fetching messages', { channel_id: channelId, before: beforeId ?? 'none' });
    try {
      const auth = await ipcRenderer.invoke('get-auth') as AuthData | null;
      if (!auth || !auth.token || !auth.hostname) return { messages: [], hasMore: false };
      const result = await window.electronAPI.messageService.fetchMessages(auth, channelId, beforeId ?? undefined);
      log.debug('Messages fetched', { channel_id: channelId, count: result.messages.length, has_more: result.hasMore });
      return result;
    } catch (error) {
      const err = error as Error;
      log.error('Error fetching messages', { channel_id: channelId, error: err.message });
      console.error('Error fetching messages:', error);
      return { messages: [], hasMore: false };
    }
  }

  async function loadChannelMessages(channelId: string): Promise<void> {
    if (!messagesContainer) return;
    log.info('Loading channel messages', { channel_id: channelId });
    // Reset pagination state
    hasMoreMessages = false;
    oldestMessageId = null;
    isLoadingOlderMessages = false;
    while (messagesContainer.firstChild) messagesContainer.removeChild(messagesContainer.firstChild);
    const prevChannelId = App.activeChannelId;
    App.activeChannelId = channelId;
    if (prevChannelId && prevChannelId !== channelId) {
      window.wsUnsubscribeFromChannel(prevChannelId);
    }
    window.wsSubscribeToChannel(channelId);

    // Channel welcome banner — reads name from header (set by updateChatHeader before this call)
    const channelName = document.querySelector('.chat-header .channel-title')?.textContent ?? '';
    const banner = document.createElement('div');
    banner.className = 'channel-welcome-banner';

    const heading = document.createElement('h2');
    heading.className = 'channel-welcome-heading';
    heading.textContent = `Welcome to #${channelName}!`;

    const subtitle = document.createElement('p');
    subtitle.className = 'channel-welcome-subtitle';
    subtitle.textContent = `This is the start of the #${channelName} channel.`;

    const editBtn = document.createElement('button');
    editBtn.className = 'channel-welcome-edit-btn';
    const pencilSpan = document.createElement('span');
    pencilSpan.textContent = '✏ ';
    editBtn.appendChild(pencilSpan);
    editBtn.appendChild(document.createTextNode('Edit Channel'));
    editBtn.addEventListener('click', () => {
      const desc = document.querySelector('.chat-header .channel-description')?.textContent ?? '';
      window.openChannelNameModal('edit-channel', null, channelId, channelName, desc);
    });

    banner.appendChild(heading);
    banner.appendChild(subtitle);
    banner.appendChild(editBtn);
    messagesContainer.appendChild(banner);

    const { messages, hasMore } = await fetchMessages(channelId);
    hasMoreMessages = hasMore;
    if (messages.length > 0) oldestMessageId = messages[0].id;
    log.debug('Rendering messages', { channel_id: channelId, count: messages.length, has_more: hasMore });
    messages.forEach(msg => displayDecryptedMessage(msg));
  }

  function loadOlderMessages(): void {
    if (!App.activeChannelId || !hasMoreMessages || isLoadingOlderMessages) return;
    isLoadingOlderMessages = true;
    log.debug('Loading older messages', { channel_id: App.activeChannelId, before: oldestMessageId });
    const prevScrollHeight = messagesContainer!.scrollHeight;
    fetchMessages(App.activeChannelId, oldestMessageId).then(({ messages, hasMore }) => {
      hasMoreMessages = hasMore;
      if (messages.length > 0) {
        oldestMessageId = messages[0].id;
        // Prepend in reverse order so oldest appears at top
        for (let i = messages.length - 1; i >= 0; i--) {
          displayDecryptedMessage(messages[i], true);
        }
        // Restore scroll position so the viewport doesn't jump
        messagesContainer!.scrollTop = messagesContainer!.scrollHeight - prevScrollHeight;
      }
      isLoadingOlderMessages = false;
    });
  }

  if (messagesContainer) {
    messagesContainer.addEventListener('scroll', () => {
      if (messagesContainer.scrollTop < 100) {
        loadOlderMessages();
      }
    });
  }

  window.sendEncryptedMessage    = sendEncryptedMessage;
  window.displayDecryptedMessage = displayDecryptedMessage;
  window.escapeHtml              = escapeHtml;
  window.loadChannelMessages     = loadChannelMessages;
  window.fetchMessages           = fetchMessages;
  window.addMessage              = addMessage;
  window.formatTimestamp         = formatTimestamp;
})();
