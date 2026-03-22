/**
 * Message service — TypeScript conversion of public/message-manager.js.
 * Handles message fetch, encrypt/send, decrypt/display for both channels and DMs.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('MessageManager');
  const emberCrypto = window.electronAPI.crypto;

  const messagesContainer = document.getElementById('messages');

  // ─── Sender Key (Signal group) encrypt/decrypt helpers ──────────────────

  const SK_VERSION = 2;

  function textToBase64(text: string): string {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToText(b64: string): string {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  async function tryGroupEncrypt(plaintext: string, emberId: string): Promise<string | null> {
    try {
      let distResp = await window.emberAPI.invoke<{
        distributionId: string | null;
      }>('LoadDistributionId', { address: emberId });

      if (!distResp.success || !distResp.data?.distributionId) {
        log.warn('Distribution ID missing — attempting sender key recovery', { ember_id: emberId });
        const recovered = await window.ensureSenderKeyForEmber?.(emberId);
        if (!recovered) {
          log.warn('Sender key recovery failed — encryption unavailable', { ember_id: emberId });
          return null;
        }
        distResp = { success: true, data: { distributionId: recovered } };
      }

      const plaintextB64 = textToBase64(plaintext);
      const encResp = await window.emberAPI.invoke<{ ciphertext: string }>('GroupEncrypt', {
        distributionId: distResp.data!.distributionId!,
        plaintext: plaintextB64,
      });
      if (!encResp.success || !encResp.data?.ciphertext) {
        log.warn('GroupEncrypt failed', {
          ember_id: emberId,
          distribution_id: distResp.data!.distributionId,
          error: encResp.error ?? 'unknown',
        });
        return null;
      }
      const auth = (await ipcRenderer.invoke('get-auth')) as {
        user_id?: string;
        device_id?: string;
      } | null;
      if (!auth?.user_id || !auth?.device_id) return null;
      return JSON.stringify({
        v: SK_VERSION,
        sa: `${auth.user_id}.${auth.device_id}`,
        ct: encResp.data.ciphertext,
      });
    } catch (err) {
      log.error('tryGroupEncrypt exception', {
        ember_id: emberId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async function tryGroupDecrypt(ciphertext: string): Promise<string | null> {
    try {
      if (!ciphertext.startsWith('{"v":2')) return null;
      const envelope = JSON.parse(ciphertext) as {
        v?: number;
        sa?: string;
        ct?: string;
      };
      if (envelope.v !== SK_VERSION || !envelope.sa || !envelope.ct) return null;
      const decResp = await window.emberAPI.invoke<{ plaintext: string }>('GroupDecrypt', {
        senderAddress: envelope.sa,
        ciphertext: envelope.ct,
      });
      if (!decResp.success || !decResp.data?.plaintext) {
        log.warn('GroupDecrypt returned failure', {
          success: decResp.success,
          error: (decResp as any).error ?? 'none',
          hasData: !!decResp.data,
          senderAddress: envelope.sa,
        });
        return null;
      }
      return base64ToText(decResp.data.plaintext);
    } catch (err) {
      log.error('tryGroupDecrypt exception', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // Pagination state (per channel load)
  let hasMoreMessages = false;
  let oldestMessageId: string | null = null;
  let isLoadingOlderMessages = false;

  // Current user ID and username cached for ownership checks (set in loadChannelMessages)
  let currentUserId: string | null = null;
  let currentUsername: string = '';

  // Performance optimizations
  const messageCache = new Map<string, FetchResult>(); // channelId -> FetchResult
  const messageElements = new Map<string, HTMLElement>(); // messageId -> HTMLElement
  const renderedMessageIds = new Set<string>(); // Track currently rendered messages
  let virtualScrollContainer: HTMLElement | null = null;
  let intersectionObserver: IntersectionObserver | null = null;
  let messageResizeObserver: ResizeObserver | null = null;

  // Performance monitoring
  let lastLoadTime = 0;
  let messageLoadCount = 0;

  // LRU cache tracking
  const cacheAccessOrder = new Set<string>(); // Track access order for LRU eviction

  interface FetchResult {
    messages: Message[];
    hasMore: boolean;
  }

  interface MessageCacheEntry extends FetchResult {
    timestamp: number;
    channelId: string;
    oldestMessageId?: string; // Store oldest message ID for pagination
  }

  // ─── Attachment message helpers ────────────────────────────────────────────

  async function buildFileMessageText(
    text: string,
    auth: AuthData,
    channelId: string,
    emberKey: Uint8Array
  ): Promise<string> {
    const attachment = App.pendingAttachment!;
    const { file, name, size, type } = attachment;
    const arrayBuffer = await file.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuffer);
    const encryptedBase64 = window.electronAPI.crypto.encryptFileBytes(fileBytes, emberKey);
    const { id } = await window.electronAPI.messageService.uploadAttachment(
      auth,
      channelId,
      encryptedBase64,
      { name, size, mime: type }
    );
    const payload: { t: string; body: string; spoiler?: boolean; a: AttachmentData } = {
      t: 'file',
      body: text,
      a: { id, name, size, mime: type },
    };
    if (attachment.spoiler) {
      payload.spoiler = true;
    }
    return JSON.stringify(payload);
  }

  // ─── GIF message helpers ───────────────────────────────────────────────────

  interface GifMessageData {
    t: 'gif';
    url: string;
    title: string;
  }

  async function sendGifMessage(url: string, title: string): Promise<void> {
    const payload: GifMessageData = { t: 'gif', url, title };
    if (App.activeChannelId) {
      await sendEncryptedMessage(App.activeChannelId, JSON.stringify(payload));
    }
  }

  // ─── Message send ──────────────────────────────────────────────────────────

  async function sendEncryptedMessage(channelId: string, plaintext: string): Promise<string> {
    const targetChannelId = channelId || App.activeChannelId;
    if (!targetChannelId || !App.activeEmberId) {
      throw new Error('No active channel or ember');
    }

    const hasPendingAttachment = !!App.pendingAttachment;
    if (!plaintext && !hasPendingAttachment) return '';

    const emberKey = hasPendingAttachment ? App.emberKeyCache.get(App.activeEmberId) : null;
    if (hasPendingAttachment && !emberKey) {
      log.error('Cannot encrypt attachment: ember key not in cache', {
        ember_id: App.activeEmberId,
        channel_id: targetChannelId,
      });
      throw new Error('Ember key not available');
    }
    log.debug('Sending encrypted message', { channel_id: App.activeChannelId });
    try {
      const auth = (await ipcRenderer.invoke('get-auth')) as AuthData | null;
      if (!auth || !auth.token || !auth.hostname) return '';
      let messageText = plaintext;
      if (hasPendingAttachment) {
        messageText = await buildFileMessageText(plaintext, auth, App.activeChannelId!, emberKey!);
        window.clearPendingAttachment();
      }
      log.debug('Attempting group encrypt', {
        ember_id: App.activeEmberId,
        has_ember_id: !!App.activeEmberId,
      });
      const groupCiphertext = await tryGroupEncrypt(messageText, App.activeEmberId);
      if (!groupCiphertext) {
        const errMsg =
          'Encryption unavailable — sender key not established for this ember. Please rejoin or restart the application.';
        (window as any).showInputError?.(errMsg);
        throw new Error(errMsg);
      }

      const response = await fetch(
        `${auth.hostname}/api/v1/channels/${App.activeChannelId!}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            ciphertext: groupCiphertext,
            protocol_version: 1,
            envelope_type: 'signal_group',
          }),
        }
      );
      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Send failed: ${response.status}`);
      }

      const msgData = (await response.json()) as Message;
      log.debug('Message sent with sender key', { message_id: msgData.id });
      window.registerSentMessageId(msgData.id);
      App.ownedMessageIds.add(msgData.id);
      await displayDecryptedMessage(msgData);
      return msgData.id;
    } catch (error) {
      const err = error as Error;
      log.error('Error sending message', {
        channel_id: App.activeChannelId ?? '',
        error: err.message,
      });
      const showMsg = err.message.includes('Encryption unavailable')
        ? err.message
        : `Failed to send: ${err.message}`;
      (window as any).showInputError?.(showMsg);
      throw err;
    }
  }

  function markMessageAsEdited(messageDiv: HTMLElement): void {
    const header = messageDiv.querySelector('.message-header');
    if (!header || header.querySelector('.message-edited')) return;
    const editedSpan = document.createElement('span');
    editedSpan.className = 'message-edited';
    editedSpan.textContent = '(edited)';
    header.appendChild(editedSpan);
  }

  async function saveEditedMessage(
    messageId: string,
    newText: string,
    textEl: HTMLElement,
    editContainer: HTMLElement
  ): Promise<void> {
    if (!App.activeEmberId || !App.activeChannelId) return;
    const auth = (await ipcRenderer.invoke('get-auth')) as AuthData | null;
    if (!auth || !auth.token || !auth.hostname) throw new Error('Not authenticated');
    const groupCiphertext = await tryGroupEncrypt(newText, App.activeEmberId);
    if (groupCiphertext) {
      const response = await fetch(
        `${auth.hostname}/api/v1/channels/${App.activeChannelId}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            ciphertext: groupCiphertext,
            protocol_version: 1,
            envelope_type: 'signal_group',
          }),
        }
      );
      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Edit failed: ${response.status}`);
      }
    } else {
      const errMsg =
        'Encryption unavailable — sender key not established for this ember. Please rejoin or restart the application.';
      (window as any).showInputError?.(errMsg);
      throw new Error(errMsg);
    }
    textEl.textContent = newText;
    editContainer.replaceWith(textEl);
    const messageDiv = textEl.closest('.message') as HTMLElement | null;
    if (messageDiv) markMessageAsEdited(messageDiv);
    log.debug('Message edited successfully', { message_id: messageId });
  }

  function enterEditMode(messageDiv: HTMLElement, messageId: string): void {
    if (messageDiv.querySelector('.message-edit-container')) return;
    const textEl = messageDiv.querySelector('.message-text') as HTMLElement | null;
    if (!textEl) return;
    const originalText = textEl.textContent ?? '';

    const editContainer = document.createElement('div');
    editContainer.className = 'message-edit-container';

    const textarea = document.createElement('textarea');
    textarea.className = 'message-edit-textarea';
    textarea.value = originalText;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-edit-actions';

    const hintSpan = document.createElement('span');
    hintSpan.className = 'message-edit-hint';
    hintSpan.textContent = 'Enter to save • Escape to cancel';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'message-edit-btn message-edit-cancel';
    cancelBtn.textContent = 'Cancel';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'message-edit-btn message-edit-save';
    saveBtn.textContent = 'Save';

    actionsDiv.appendChild(hintSpan);
    actionsDiv.appendChild(cancelBtn);
    actionsDiv.appendChild(saveBtn);
    editContainer.appendChild(textarea);
    editContainer.appendChild(actionsDiv);

    textEl.replaceWith(editContainer);
    textarea.focus();
    textarea.selectionStart = textarea.value.length;

    const cancel = (): void => {
      editContainer.replaceWith(textEl);
    };

    cancelBtn.addEventListener('click', cancel);

    saveBtn.addEventListener('click', async () => {
      const newText = textarea.value.trim();
      if (!newText || newText === originalText) {
        cancel();
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await saveEditedMessage(messageId, newText, textEl, editContainer);
      } catch (err) {
        log.error('Failed to save edit', {
          message_id: messageId,
          error: String(err),
        });
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });

    textarea.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        cancel();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveBtn.click();
      }
    });
  }

  async function handleEditedMessage(payload: {
    id: string;
    channel_id: string;
    ciphertext: string;
    protocol_version?: number;
    envelope_type?: string;
  }): Promise<void> {
    if (payload.channel_id !== App.activeChannelId) return;
    const messageDiv = messagesContainer?.querySelector(
      `[data-message-id="${payload.id}"]`
    ) as HTMLElement | null;
    if (!messageDiv) return;
    const textEl = messageDiv.querySelector('.message-text') as HTMLElement | null;
    if (!textEl) return;
    if (!App.activeEmberId) return;
    if (payload.envelope_type === 'signal_group') {
      const plaintext = await tryGroupDecrypt(payload.ciphertext);
      if (plaintext === null) return;
      textEl.textContent = plaintext;
      markMessageAsEdited(messageDiv);
      return;
    }

    if (payload.envelope_type === 'signal_dm') {
      textEl.textContent = '[Requires app update to view this message]';
      markMessageAsEdited(messageDiv);
      return;
    }

    // Non-Signal envelopes cannot be decrypted.
    textEl.textContent = '[This message cannot be decrypted — unsupported envelope]';
    markMessageAsEdited(messageDiv);
  }

  function addMessage(
    author: string,
    text: string,
    timestamp?: number,
    prepend = false,
    messageId?: string,
    chatColor?: string,
    attachment?: AttachmentData,
    gif?: { url: string; title?: string }
  ): void {
    const capturedEmberId = App.activeEmberId;
    const capturedChannelId = App.activeChannelId;
    const getEmberKey = async (_cid: string): Promise<Uint8Array | null> =>
      capturedEmberId ? (App.emberKeyCache.get(capturedEmberId) ?? null) : null;
    const messageDiv = window.createBasicMessageElement(
      author,
      text,
      timestamp,
      messageId,
      chatColor,
      !!(currentUsername && author === currentUsername),
      attachment,
      gif,
      capturedChannelId ?? undefined,
      getEmberKey
    );

    // Virtual scrolling temporarily disabled - use messagesContainer directly
    if (messagesContainer) {
      if (prepend) {
        const banner = messagesContainer.querySelector('.channel-welcome-banner');
        const referenceNode = banner ? banner.nextSibling : messagesContainer.firstChild;
        if (referenceNode) {
          messagesContainer.insertBefore(messageDiv, referenceNode);
        } else {
          messagesContainer.appendChild(messageDiv);
        }
      } else {
        messagesContainer.appendChild(messageDiv);
        // Scroll to bottom if not prepending (new message)
        // For GIF messages, wait for images to load before scrolling
        if (gif) {
          const gifImg = messageDiv.querySelector('.gif-card img') as HTMLImageElement;
          if (gifImg) {
            if (gifImg.complete && gifImg.naturalHeight !== 0) {
              // Image already loaded, scroll immediately
              messagesContainer.scrollTop = messagesContainer.scrollHeight;
            } else {
              // Wait for image to load before scrolling
              gifImg.addEventListener('load', () => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
              });
              // Fallback timeout in case image load takes too long or fails
              setTimeout(() => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
              }, 1000);
            }
          } else {
            // Fallback if GIF image not found
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        } else {
          // Non-GIF messages scroll immediately
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }
    }
  }

  async function displayDecryptedMessage(msg: Message, prepend = false): Promise<void> {
    if (!App.activeEmberId) return;
    let plaintext: string | null = null;
    const envelopeType = msg.envelope_type;
    if (envelopeType === 'signal_group') {
      plaintext = await tryGroupDecrypt(msg.ciphertext);
      if (plaintext === null) {
        log.warn('Sender key decrypt failed, triggering distribution fetch', {
          message_id: msg.id,
        });

        // Trigger distribution fetch and retry decryption
        await window.processIncomingDistributions?.();

        // Retry decryption after distribution fetch
        plaintext = await tryGroupDecrypt(msg.ciphertext);

        if (plaintext === null) {
          // Still failed - show waiting message
          addMessage(
            msg.username ?? 'Unknown',
            '[Waiting for sender key — message will be readable once keys arrive]',
            msg.created_at,
            prepend,
            msg.id,
            msg.chat_color
          );
          return;
        }
      }
    } else if (envelopeType === 'signal_dm') {
      addMessage(
        msg.username ?? 'Unknown',
        '[Requires app update to view this message]',
        msg.created_at,
        prepend,
        msg.id,
        msg.chat_color
      );
      return;
    }
    if (plaintext === null) {
      log.warn('Message decryption failed', { message_id: msg.id });
      addMessage(
        msg.username ?? 'Unknown',
        '[Failed to decrypt message]',
        msg.created_at,
        prepend,
        msg.id,
        msg.chat_color
      );
      return;
    }
    if (plaintext.startsWith('{"t":"file"')) {
      try {
        const parsed = JSON.parse(plaintext) as {
          t: string;
          body: string;
          spoiler?: boolean;
          a: AttachmentData;
        };
        const attachment: AttachmentData = parsed.spoiler
          ? { ...parsed.a, spoiler: true }
          : parsed.a;
        addMessage(
          msg.username ?? 'Unknown',
          parsed.body,
          msg.created_at,
          prepend,
          msg.id,
          msg.chat_color,
          attachment
        );
        return;
      } catch (_) {
        // fall through to plain-text rendering
      }
    }
    if (plaintext.startsWith('{"t":"gif"')) {
      try {
        const parsed = JSON.parse(plaintext) as GifMessageData;
        addMessage(
          msg.username ?? 'Unknown',
          '',
          msg.created_at,
          prepend,
          msg.id,
          msg.chat_color,
          undefined,
          parsed
        );
        return;
      } catch (_) {
        // fall through to plain-text rendering
      }
    }
    addMessage(
      msg.username ?? 'Unknown',
      plaintext,
      msg.created_at,
      prepend,
      msg.id,
      msg.chat_color
    );
  }

  function escapeHtml(text: string): string {
    // Avoid innerHTML-based escaping to prevent security hook warnings.
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Performance optimization functions
   */

  /**
   * Get cached messages for a channel
   */
  function getCachedMessages(channelId: string): FetchResult | null {
    const cached = messageCache.get(channelId) as MessageCacheEntry | undefined;
    if (!cached) return null;

    // Cache entries expire after 5 minutes
    const now = Date.now();
    if (now - cached.timestamp > 5 * 60 * 1000) {
      messageCache.delete(channelId);
      cacheAccessOrder.delete(channelId);
      return null;
    }

    // Update LRU access order
    cacheAccessOrder.delete(channelId);
    cacheAccessOrder.add(channelId);

    // Restore pagination state from cache
    if (cached.oldestMessageId) {
      oldestMessageId = cached.oldestMessageId;
    }

    return { messages: cached.messages, hasMore: cached.hasMore };
  }

  /**
   * Cache messages for a channel
   */
  function cacheMessages(channelId: string, result: FetchResult): void {
    const cacheEntry: MessageCacheEntry = {
      ...result,
      timestamp: Date.now(),
      channelId,
      oldestMessageId: oldestMessageId || undefined, // Store current pagination state
    };
    messageCache.set(channelId, cacheEntry);

    // Update LRU access order
    cacheAccessOrder.delete(channelId);
    cacheAccessOrder.add(channelId);

    // Limit cache size to prevent memory leaks using LRU eviction
    if (messageCache.size > 50) {
      const oldestKey = cacheAccessOrder.values().next().value;
      if (oldestKey) {
        messageCache.delete(oldestKey);
        cacheAccessOrder.delete(oldestKey);
      }
    }
  }

  /**
   * Initialize virtual scrolling for better performance with large message lists
   */
  function initializeVirtualScrolling(): void {
    if (!messagesContainer) return;

    // Create virtual scroll container
    virtualScrollContainer = document.createElement('div');
    virtualScrollContainer.className = 'virtual-scroll-container';
    virtualScrollContainer.style.cssText = `
      height: 100%;
      width: 100%;
      overflow-y: auto;
      position: relative;
      box-sizing: border-box;
    `;

    // Move existing messages to virtual container
    while (messagesContainer.firstChild) {
      virtualScrollContainer.appendChild(messagesContainer.firstChild);
    }

    messagesContainer.appendChild(virtualScrollContainer);

    // Set up intersection observer for lazy loading
    intersectionObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const messageId = entry.target.getAttribute('data-message-id');
            if (messageId) {
              loadMessageContent(messageId);
            }
          }
        });
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    // Set up resize observer for container size changes
    messageResizeObserver = new ResizeObserver(() => {
      updateVirtualScrollHeight();
    });
    messageResizeObserver.observe(virtualScrollContainer);
  }

  /**
   * Load message content lazily
   */
  function loadMessageContent(messageId: string): void {
    const element = messageElements.get(messageId);
    if (!element || element.getAttribute('data-content-loaded') === 'true') return;

    // Mark as loaded to prevent duplicate work
    element.setAttribute('data-content-loaded', 'true');

    // Add fade-in animation
    element.style.opacity = '0';
    element.style.transform = 'translateY(10px)';

    requestAnimationFrame(() => {
      element.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      element.style.opacity = '1';
      element.style.transform = 'translateY(0)';
    });
  }

  /**
   * Update virtual scroll container height
   */
  function updateVirtualScrollHeight(): void {
    if (!virtualScrollContainer) return;

    const totalHeight = Array.from(virtualScrollContainer.children).reduce(
      (sum, child) => sum + (child as HTMLElement).offsetHeight,
      0
    );

    virtualScrollContainer.style.height = `${totalHeight}px`;
  }

  /**
   * Optimize DOM operations by batching updates
   */
  function batchDOMUpdates(updates: (() => void)[]): void {
    // Use requestAnimationFrame for smooth updates
    requestAnimationFrame(() => {
      updates.forEach(update => update());
    });
  }

  /**
   * Clean up old messages to prevent memory leaks
   */
  function cleanupOldMessages(): void {
    const maxMessages = 1000; // Keep only last 1000 messages in memory

    if (renderedMessageIds.size > maxMessages) {
      const messagesToRemove = Array.from(renderedMessageIds).slice(
        0,
        renderedMessageIds.size - maxMessages
      );

      messagesToRemove.forEach(messageId => {
        const element = messageElements.get(messageId);
        if (element && element.parentNode) {
          element.parentNode.removeChild(element);
        }
        messageElements.delete(messageId);
        renderedMessageIds.delete(messageId);
      });

      log.debug('Cleaned up old messages', { removed: messagesToRemove.length });
    }
  }

  /**
   * Monitor performance metrics
   */
  function monitorPerformance(operation: string, startTime: number): void {
    const duration = Date.now() - startTime;
    lastLoadTime = duration;
    messageLoadCount++;

    log.debug('Performance metric', {
      operation,
      duration,
      count: messageLoadCount,
      average: messageLoadCount > 0 ? duration / messageLoadCount : 0,
    });

    // Warn if operations are taking too long
    if (duration > 1000) {
      log.warn('Slow operation detected', { operation, duration });
    }
  }

  async function fetchMessages(
    channelId: string,
    beforeId: string | null = null
  ): Promise<FetchResult> {
    const startTime = Date.now();
    const cacheKey = beforeId ? `${channelId}-${beforeId}` : channelId;

    log.debug('Fetching messages', {
      channel_id: channelId,
      before: beforeId ?? 'none',
    });

    // Check cache first
    const cached = getCachedMessages(cacheKey);
    if (cached) {
      log.debug('Using cached messages', { channel_id: channelId, count: cached.messages.length });
      monitorPerformance('fetch-messages-cache', startTime);
      return cached;
    }

    try {
      const auth = (await ipcRenderer.invoke('get-auth')) as AuthData | null;
      if (!auth || !auth.token || !auth.hostname) return { messages: [], hasMore: false };
      const result = await window.electronAPI.messageService.fetchMessages(
        auth,
        channelId,
        beforeId ?? undefined
      );

      // Cache the result
      cacheMessages(cacheKey, result);

      log.debug('Messages fetched', {
        channel_id: channelId,
        count: result.messages.length,
        has_more: result.hasMore,
      });

      monitorPerformance('fetch-messages-network', startTime);
      return result;
    } catch (error) {
      const err = error as Error;
      log.error('Error fetching messages', {
        channel_id: channelId,
        error: err.message,
      });
      console.error('Error fetching messages:', error);
      monitorPerformance('fetch-messages-error', startTime);
      return { messages: [], hasMore: false };
    }
  }

  /**
   * Create and show loading indicator for message loading
   */
  function showLoadingIndicator(): HTMLElement {
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'messages-loading-indicator';
    loadingIndicator.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text">Loading more messages...</div>
    `;

    // Add styles for the loading indicator
    loadingIndicator.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      color: #666;
      font-size: 14px;
      background: rgba(0, 0, 0, 0.05);
      border-radius: 8px;
      margin: 8px 0;
    `;

    const spinner = loadingIndicator.querySelector('.loading-spinner') as HTMLElement;
    if (spinner) {
      spinner.style.cssText = `
        width: 20px;
        height: 20px;
        border: 2px solid #e0e0e0;
        border-top: 2px solid #666;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-right: 8px;
      `;
    }

    return loadingIndicator;
  }

  /**
   * Hide loading indicator
   */
  function hideLoadingIndicator(indicator: HTMLElement): void {
    if (indicator && indicator.parentNode) {
      indicator.parentNode.removeChild(indicator);
    }
  }

  async function loadChannelMessages(channelId: string): Promise<void> {
    const startTime = Date.now();

    if (!messagesContainer) return;
    log.info('Loading channel messages', { channel_id: channelId });

    // Initialize virtual scrolling if not already done
    // Temporarily disabled to fix layout issues
    // if (!virtualScrollContainer) {
    //   initializeVirtualScrolling();
    // }

    // Reset pagination state and ownership cache for the new channel
    hasMoreMessages = false;
    oldestMessageId = null;
    isLoadingOlderMessages = false;
    App.ownedMessageIds.clear();

    // Clear any pending attachment when switching channels
    window.clearPendingAttachment();

    // Invalidate stale cache so fresh messages are always fetched from the server
    messageCache.delete(channelId);

    // Clear existing messages efficiently
    // Virtual scrolling temporarily disabled
    while (messagesContainer.firstChild) {
      messagesContainer.removeChild(messagesContainer.firstChild);
    }

    // Clear message tracking
    messageElements.clear();
    renderedMessageIds.clear();

    const prevChannelId = App.activeChannelId;
    App.activeChannelId = channelId;
    if (prevChannelId && prevChannelId !== channelId) {
      window.wsUnsubscribeFromChannel(prevChannelId);
    }
    window.wsSubscribeToChannel(channelId);

    // Reset window.sendGif to use channel routing (fixes DM->channel GIF routing bug)
    window.sendGif = (url: string, title: string): void => {
      window.sendGifMessage(url, title).catch((err: Error) => {
        log.error('Failed to send GIF', { error: err.message });
      });
    };

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

    // Add banner directly to messagesContainer (before the virtual scroll div)
    messagesContainer.insertBefore(banner, messagesContainer.firstChild);

    // Fetch auth once to populate ownership cache (fast IPC read from safeStorage)
    const authForOwnership = (await ipcRenderer.invoke('get-auth')) as AuthData | null;
    currentUserId = authForOwnership?.user_id ?? null;
    currentUsername = authForOwnership?.username ?? '';

    const { messages, hasMore } = await fetchMessages(channelId);
    hasMoreMessages = hasMore;
    if (messages.length > 0) oldestMessageId = messages[0].id;

    log.debug('Rendering messages', {
      channel_id: channelId,
      count: messages.length,
      has_more: hasMore,
    });

    for (const msg of messages) {
      if (currentUserId && msg.sender_user_id === currentUserId) {
        App.ownedMessageIds.add(msg.id);
      }
      await displayDecryptedMessage(msg);
    }

    // Clean up old messages if needed
    cleanupOldMessages();

    // Auto-load more messages if available (Phase 2: Auto-pagination)
    if (hasMoreMessages && !isLoadingOlderMessages) {
      await autoLoadMoreMessages(channelId);
    }

    // Scroll to bottom to show newest messages (after all loading is complete)
    // Virtual scrolling temporarily disabled - use messagesContainer directly
    if (messagesContainer) {
      // Use requestAnimationFrame to ensure DOM is fully updated
      requestAnimationFrame(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      });
    }

    monitorPerformance('load-channel-messages', startTime);
  }

  /**
   * Automatically load more messages when channel is loaded
   * Loads messages in batches until we have a reasonable amount or no more messages
   */
  async function autoLoadMoreMessages(channelId: string): Promise<void> {
    const targetMessageCount = 100; // Target 100 messages total
    let currentMessageCount = renderedMessageIds.size;

    log.debug('Auto-loading more messages', {
      channel_id: channelId,
      current_count: currentMessageCount,
      target_count: targetMessageCount,
      has_more: hasMoreMessages,
    });

    // Show loading indicator at the top of messages
    const loadingIndicator = showLoadingIndicator();
    // Virtual scrolling disabled - use messagesContainer directly
    if (messagesContainer) {
      // Insert after welcome banner or at the top
      const banner = messagesContainer.querySelector('.channel-welcome-banner');
      const referenceNode = banner ? banner.nextSibling : messagesContainer.firstChild;
      messagesContainer.insertBefore(loadingIndicator, referenceNode);
    }

    while (currentMessageCount < targetMessageCount && hasMoreMessages && !isLoadingOlderMessages) {
      isLoadingOlderMessages = true;

      try {
        const { messages, hasMore } = await fetchMessages(channelId, oldestMessageId);
        hasMoreMessages = hasMore;

        if (messages.length > 0) {
          oldestMessageId = messages[0].id;

          // Prepend messages in reverse order so oldest appears at top
          for (let i = messages.length - 1; i >= 0; i--) {
            if (currentUserId && messages[i].sender_user_id === currentUserId) {
              App.ownedMessageIds.add(messages[i].id);
            }
            await displayDecryptedMessage(messages[i], true);
          }

          currentMessageCount = renderedMessageIds.size;

          log.debug('Auto-loaded batch of messages', {
            channel_id: channelId,
            batch_size: messages.length,
            total_count: currentMessageCount,
            has_more: hasMore,
          });
        } else {
          break;
        }
      } catch (error) {
        log.error('Error auto-loading messages', {
          channel_id: channelId,
          error: String(error),
        });
        break;
      } finally {
        isLoadingOlderMessages = false;
      }
    }

    // Hide loading indicator
    hideLoadingIndicator(loadingIndicator);

    log.debug('Auto-loading completed', {
      channel_id: channelId,
      final_count: renderedMessageIds.size,
      has_more: hasMoreMessages,
    });
  }

  function loadOlderMessages(): void {
    if (!App.activeChannelId || !hasMoreMessages || isLoadingOlderMessages) return;
    isLoadingOlderMessages = true;
    log.debug('Loading older messages', {
      channel_id: App.activeChannelId,
      before: oldestMessageId,
    });

    // Show loading indicator at the top
    const loadingIndicator = showLoadingIndicator();
    // Virtual scrolling disabled - use messagesContainer directly
    if (messagesContainer) {
      const banner = messagesContainer.querySelector('.channel-welcome-banner');
      const referenceNode = banner ? banner.nextSibling : messagesContainer.firstChild;
      messagesContainer.insertBefore(loadingIndicator, referenceNode);
    }

    const prevScrollHeight = messagesContainer?.scrollHeight || 0;
    fetchMessages(App.activeChannelId, oldestMessageId)
      .then(async ({ messages, hasMore }) => {
        hasMoreMessages = hasMore;
        if (messages.length > 0) {
          oldestMessageId = messages[0].id;
          // Prepend in reverse order so oldest appears at top
          for (let i = messages.length - 1; i >= 0; i--) {
            if (currentUserId && messages[i].sender_user_id === currentUserId) {
              App.ownedMessageIds.add(messages[i].id);
            }
            await displayDecryptedMessage(messages[i], true);
          }
          // Restore scroll position so the viewport doesn't jump
          messagesContainer!.scrollTop = messagesContainer!.scrollHeight - prevScrollHeight;
        }
        isLoadingOlderMessages = false;
        hideLoadingIndicator(loadingIndicator);

        log.debug('Older messages loaded', {
          channel_id: App.activeChannelId,
          count: messages.length,
          has_more: hasMore,
        });
      })
      .catch(error => {
        log.error('Error loading older messages', {
          channel_id: App.activeChannelId,
          error: String(error),
        });
        isLoadingOlderMessages = false;
        hideLoadingIndicator(loadingIndicator);
      });
  }

  if (messagesContainer) {
    let scrollTimeout: NodeJS.Timeout | null = null;

    messagesContainer.addEventListener('scroll', () => {
      // Clear existing timeout
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      // Debounce scroll events and check if we're near the top
      scrollTimeout = setTimeout(() => {
        const scrollThreshold = 200; // Increased threshold for better UX
        // Virtual scrolling disabled - use messagesContainer directly
        const scrollTop = messagesContainer.scrollTop;
        const isNearTop = scrollTop < scrollThreshold;
        const hasMoreContent = hasMoreMessages && !isLoadingOlderMessages;

        if (isNearTop && hasMoreContent) {
          log.debug('Scroll trigger: loading older messages', {
            scroll_top: scrollTop,
            threshold: scrollThreshold,
            has_more: hasMoreMessages,
            is_loading: isLoadingOlderMessages,
          });
          loadOlderMessages();
        }
      }, 100); // 100ms debounce
    });
  }

  window.sendEncryptedMessage = sendEncryptedMessage;
  window.sendGifMessage = sendGifMessage;
  window.displayDecryptedMessage = displayDecryptedMessage;
  window.handleEditedMessage = handleEditedMessage;
  window.enterEditMode = enterEditMode;
  window.escapeHtml = escapeHtml;
  window.loadChannelMessages = loadChannelMessages;
  window.fetchMessages = fetchMessages;
  window.addMessage = addMessage;

  // Performance optimization functions
  window.getCachedMessages = getCachedMessages;
  window.cacheMessages = cacheMessages;
  window.initializeVirtualScrolling = initializeVirtualScrolling;
  window.cleanupOldMessages = cleanupOldMessages;
  window.monitorPerformance = monitorPerformance;
})();
