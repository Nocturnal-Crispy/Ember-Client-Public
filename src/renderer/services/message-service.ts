/**
 * Message service — TypeScript conversion of public/message-manager.js.
 * Handles message fetch, encrypt/send, decrypt/display for both channels and DMs.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger("MessageManager");
  const emberCrypto = window.electronAPI.crypto;
  
  // Import DM crypto from ember-shared
  const DMCrypto = (window as any).emberShared?.crypto?.directMessaging;

  const messagesContainer = document.getElementById("messages");

  // Pagination state (per channel load)
  let hasMoreMessages = false;
  let oldestMessageId: string | null = null;
  let isLoadingOlderMessages = false;

  // Current user ID and username cached for ownership checks (set in loadChannelMessages)
  let currentUserId: string | null = null;
  let currentUsername: string = '';
  
  // DM conversation keys cache
  const dmConversationKeys = new Map<string, Uint8Array>();
  
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

  interface LocalAttachmentData {
    id: string;
    name: string;
    size: number;
    mime: string;
  }

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
      auth, channelId, encryptedBase64, { name, size, mime: type }
    );
    const payload: { t: string; body: string; a: LocalAttachmentData } = {
      t: "file",
      body: text,
      a: { id, name, size, mime: type },
    };
    return JSON.stringify(payload);
  }

  function isImageMime(mime: string): boolean {
    return typeof mime === "string" && mime.startsWith("image/");
  }

  function createFileCard(attachment: LocalAttachmentData): HTMLElement {
    if (isImageMime(attachment.mime)) {
      return createImageCard(attachment);
    }
    const card = document.createElement("div");
    card.className = "file-card";
    const icon = document.createElement("span");
    icon.className = "file-card-icon";
    icon.textContent = "📎 ";
    const nameEl = document.createElement("span");
    nameEl.className = "file-card-name";
    nameEl.textContent = attachment.name;
    const dlBtn = document.createElement("button");
    dlBtn.className = "file-card-download";
    dlBtn.textContent = "[download]";
    dlBtn.addEventListener("click", () => { downloadFileAttachment(attachment); });
    card.appendChild(icon);
    card.appendChild(nameEl);
    card.appendChild(dlBtn);
    return card;
  }

  function createImageCard(attachment: LocalAttachmentData): HTMLElement {
    // Capture channel/ember context at creation time — channel may change before async load completes
    const capturedChannelId = App.activeChannelId;
    const capturedEmberId = App.activeEmberId;

    const card = document.createElement("div");
    card.className = "image-card";

    const imgWrapper = document.createElement("div");
    imgWrapper.className = "image-card-wrapper image-card-state-loading";

    const statusEl = document.createElement("span");
    statusEl.className = "image-card-status";
    statusEl.textContent = "[loading...]";

    const img = document.createElement("img");
    img.className = "image-card-img";
    img.alt = attachment.name;

    imgWrapper.appendChild(statusEl);
    imgWrapper.appendChild(img);

    const footer = document.createElement("div");
    footer.className = "image-card-footer";
    const nameEl = document.createElement("span");
    nameEl.className = "image-card-name";
    nameEl.textContent = attachment.name;
    const saveBtn = document.createElement("button");
    saveBtn.className = "file-card-download";
    saveBtn.textContent = "[save]";
    saveBtn.addEventListener("click", () => { downloadFileAttachment(attachment, capturedChannelId, capturedEmberId); });
    footer.appendChild(nameEl);
    footer.appendChild(saveBtn);

    card.appendChild(imgWrapper);
    card.appendChild(footer);

    if (capturedChannelId && capturedEmberId) {
      loadImageAttachment(attachment, img, statusEl, imgWrapper, capturedChannelId, capturedEmberId);
    } else {
      statusEl.textContent = "[failed to load image]";
      imgWrapper.className = "image-card-wrapper image-card-state-error";
    }
    return card;
  }

  function loadImageAttachment(
    attachment: LocalAttachmentData,
    img: HTMLImageElement,
    statusEl: HTMLElement,
    wrapper: HTMLElement,
    channelId: string,
    emberId: string
  ): void {
    const emberKey = App.emberKeyCache.get(emberId);
    if (!emberKey) {
      statusEl.textContent = "[failed to load image]";
      wrapper.className = "image-card-wrapper image-card-state-error";
      return;
    }
    ipcRenderer.invoke("get-auth").then((authUnknown: unknown) => {
      const auth = authUnknown as AuthData | null;
      if (!auth) {
        statusEl.textContent = "[failed to load image]";
        wrapper.className = "image-card-wrapper image-card-state-error";
        return;
      }
      window.electronAPI.messageService.downloadAttachment(auth, channelId, attachment.id)
        .then((resp) => {
          const bytes = window.electronAPI.crypto.decryptFileBytes(resp.encrypted_data, emberKey);
          if (!bytes) {
            statusEl.textContent = "[failed to decrypt image]";
            wrapper.className = "image-card-wrapper image-card-state-error";
            log.error("Failed to decrypt image attachment", { id: attachment.id });
            return;
          }
          const blob = new Blob([new Uint8Array(bytes)], { type: attachment.mime || "image/png" });
          const url = URL.createObjectURL(blob);
          img.onload = () => {
            wrapper.className = "image-card-wrapper image-card-state-loaded";
            img.addEventListener("click", () => {
              (window as any).openImageViewer?.(url, attachment.name);
            });
            // The image just expanded the layout. If that expansion is what pushed
            // the viewport away from the bottom, scroll back down. We use the
            // image's rendered height minus the placeholder height (80px) as the
            // expected expansion delta, plus a small buffer. If distanceFromBottom
            // is within that range the user was effectively at the bottom before
            // the image loaded.
            if (messagesContainer) {
              const distanceFromBottom =
                messagesContainer.scrollHeight -
                messagesContainer.scrollTop -
                messagesContainer.clientHeight;
              const expandedBy = Math.max(0, (img.offsetHeight || 300) - 80);
              if (distanceFromBottom <= expandedBy + 60) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
              }
            }
          };
          img.onerror = () => {
            statusEl.textContent = "[failed to load image]";
            wrapper.className = "image-card-wrapper image-card-state-error";
            URL.revokeObjectURL(url);
          };
          img.src = url;
        })
        .catch((err: Error) => {
          statusEl.textContent = "[failed to load image]";
          wrapper.className = "image-card-wrapper image-card-state-error";
          log.error("Failed to load image attachment", { id: attachment.id, error: err.message });
        });
    });
  }

  function downloadFileAttachment(
    attachment: LocalAttachmentData,
    channelId = App.activeChannelId,
    emberId = App.activeEmberId
  ): void {
    if (!emberId || !channelId) return;
    const emberKey = App.emberKeyCache.get(emberId);
    if (!emberKey) { log.error("Cannot download: no ember key"); return; }
    ipcRenderer.invoke("get-auth").then((authUnknown: unknown) => {
      const auth = authUnknown as AuthData | null;
      if (!auth) return;
      window.electronAPI.messageService.downloadAttachment(auth, channelId, attachment.id)
        .then((resp) => {
          const bytes = window.electronAPI.crypto.decryptFileBytes(resp.encrypted_data, emberKey);
          if (!bytes) { log.error("Failed to decrypt attachment", { id: attachment.id }); return; }
          const blob = new Blob([new Uint8Array(bytes)], { type: resp.content_type || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = resp.original_name;
          a.click();
          URL.revokeObjectURL(url);
        })
        .catch((err: Error) => {
          log.error("Failed to download attachment", { id: attachment.id, error: err.message });
        });
    });
  }

  // ─── Message send ──────────────────────────────────────────────────────────

  async function sendEncryptedMessage(plaintext: string): Promise<void> {
    if (!App.activeChannelId || !App.activeEmberId) return;
    const emberKey = App.emberKeyCache.get(App.activeEmberId);
    if (!emberKey) {
      log.error("Cannot send message: no ember key in cache", {
        ember_id: App.activeEmberId,
      });
      return;
    }
    const hasPendingAttachment = !!App.pendingAttachment;
    if (!plaintext && !hasPendingAttachment) return;
    log.debug("Sending encrypted message", { channel_id: App.activeChannelId });
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as AuthData | null;
      if (!auth || !auth.token || !auth.hostname) return;
      let messageText = plaintext;
      if (hasPendingAttachment) {
        messageText = await buildFileMessageText(plaintext, auth, App.activeChannelId, emberKey);
        window.clearPendingAttachment?.();
      }
      const msgData = await window.electronAPI.messageService.sendMessage(
        auth,
        App.activeChannelId,
        messageText,
        emberKey
      );
      log.debug("Message sent successfully", {
        channel_id: App.activeChannelId,
        message_id: msgData.id,
      });
      window.registerSentMessageId(msgData.id);
      App.ownedMessageIds.add(msgData.id);
      displayDecryptedMessage(msgData);
    } catch (error) {
      const err = error as Error;
      log.error("Error sending message", {
        channel_id: App.activeChannelId ?? "",
        error: err.message,
      });
      (window as any).showInputError?.(`Failed to send: ${err.message}`);
    }
  }

  function formatTimestamp(unixSeconds?: number): string {
    const date = unixSeconds ? new Date(unixSeconds * 1000) : new Date();
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    if (isToday) return `Today at ${timeStr}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString())
      return `Yesterday at ${timeStr}`;
    return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${timeStr}`;
  }

  function createActionButton(
    icon: string,
    title: string,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "message-action-btn";
    btn.title = title;
    btn.textContent = icon;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  function markMessageAsEdited(messageDiv: HTMLElement): void {
    const header = messageDiv.querySelector(".message-header");
    if (!header || header.querySelector(".message-edited")) return;
    const editedSpan = document.createElement("span");
    editedSpan.className = "message-edited";
    editedSpan.textContent = "(edited)";
    header.appendChild(editedSpan);
  }

  async function saveEditedMessage(
    messageId: string,
    newText: string,
    textEl: HTMLElement,
    editContainer: HTMLElement
  ): Promise<void> {
    if (!App.activeEmberId || !App.activeChannelId) return;
    const emberKey = App.emberKeyCache.get(App.activeEmberId);
    if (!emberKey) throw new Error("No ember key");
    const auth = (await ipcRenderer.invoke("get-auth")) as AuthData | null;
    if (!auth || !auth.token || !auth.hostname)
      throw new Error("Not authenticated");
    await window.electronAPI.messageService.editMessage(
      auth,
      App.activeChannelId,
      messageId,
      newText,
      emberKey
    );
    textEl.textContent = newText;
    editContainer.replaceWith(textEl);
    const messageDiv = textEl.closest(".message") as HTMLElement | null;
    if (messageDiv) markMessageAsEdited(messageDiv);
    log.debug("Message edited successfully", { message_id: messageId });
  }

  function enterEditMode(messageDiv: HTMLElement, messageId: string): void {
    if (messageDiv.querySelector(".message-edit-container")) return;
    const textEl = messageDiv.querySelector(
      ".message-text"
    ) as HTMLElement | null;
    if (!textEl) return;
    const originalText = textEl.textContent ?? "";

    const editContainer = document.createElement("div");
    editContainer.className = "message-edit-container";

    const textarea = document.createElement("textarea");
    textarea.className = "message-edit-textarea";
    textarea.value = originalText;

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "message-edit-actions";

    const hintSpan = document.createElement("span");
    hintSpan.className = "message-edit-hint";
    hintSpan.textContent = "Enter to save • Escape to cancel";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "message-edit-btn message-edit-cancel";
    cancelBtn.textContent = "Cancel";

    const saveBtn = document.createElement("button");
    saveBtn.className = "message-edit-btn message-edit-save";
    saveBtn.textContent = "Save";

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

    cancelBtn.addEventListener("click", cancel);

    saveBtn.addEventListener("click", async () => {
      const newText = textarea.value.trim();
      if (!newText || newText === originalText) {
        cancel();
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        await saveEditedMessage(messageId, newText, textEl, editContainer);
      } catch (err) {
        log.error("Failed to save edit", {
          message_id: messageId,
          error: String(err),
        });
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        cancel();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        saveBtn.click();
      }
    });
  }

  function handleEditedMessage(payload: {
    id: string;
    channel_id: string;
    ciphertext: string;
  }): void {
    if (payload.channel_id !== App.activeChannelId) return;
    const messageDiv = messagesContainer?.querySelector(
      `[data-message-id="${payload.id}"]`
    ) as HTMLElement | null;
    if (!messageDiv) return;
    const textEl = messageDiv.querySelector(
      ".message-text"
    ) as HTMLElement | null;
    if (!textEl) return;
    if (!App.activeEmberId) return;
    const emberKey = App.emberKeyCache.get(App.activeEmberId);
    if (!emberKey) return;
    const plaintext = emberCrypto.decryptMessage(payload.ciphertext, emberKey);
    if (plaintext === null) return;
    textEl.textContent = plaintext;
    markMessageAsEdited(messageDiv);
  }

  function createActionToolbar(messageId?: string): HTMLDivElement {
    const toolbar = document.createElement("div");
    toolbar.className = "message-action-bar";
    const isOwn = !!messageId && App.ownedMessageIds.has(messageId);
    toolbar.appendChild(
      createActionButton("😊", "Add Reaction", () => {
        log.debug("Reaction clicked", { message_id: messageId ?? "" });
      })
    );
    if (isOwn) {
      toolbar.appendChild(
        createActionButton("✏", "Edit", () => {
          const msgDiv = toolbar.closest(".message") as HTMLElement | null;
          if (msgDiv && messageId) enterEditMode(msgDiv, messageId);
        })
      );
    }
    toolbar.appendChild(
      createActionButton("↗", "Forward", () => {
        log.debug("Forward clicked", { message_id: messageId ?? "" });
      })
    );
    return toolbar;
  }

  function toChumhandle(username: string): string {
    const words = username.match(/[A-Z]?[a-z]+|[0-9]+|[A-Z]+/g) || [username];
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return username.slice(0, 2).toUpperCase();
  }

  function addMessage(
    author: string,
    text: string,
    timestamp?: number,
    prepend = false,
    messageId?: string,
    chatColor?: string,
    attachment?: LocalAttachmentData
  ): void {
    const messageDiv = document.createElement("div");
    messageDiv.className = "message";
    if (messageId) messageDiv.dataset["messageId"] = messageId;
    messageDiv.dataset["chumhandle"] = "[" + toChumhandle(author) + "]: ";
    if (currentUsername && author === currentUsername) {
      messageDiv.classList.add("own");
    }
    if (chatColor) {
      messageDiv.style.color = chatColor;
    }
    const timeString = formatTimestamp(timestamp);
    const avatarEl = document.createElement("div");
    avatarEl.className = "message-avatar";
    avatarEl.textContent = author.charAt(0).toUpperCase();
    const contentEl = document.createElement("div");
    contentEl.className = "message-content";
    const headerEl = document.createElement("div");
    headerEl.className = "message-header";
    const authorEl = document.createElement("span");
    authorEl.className = "message-author";
    authorEl.textContent = author;
    const tsEl = document.createElement("span");
    tsEl.className = "message-timestamp";
    tsEl.textContent = timeString;
    headerEl.appendChild(authorEl);
    headerEl.appendChild(tsEl);
    const textEl = document.createElement("div");
    textEl.className = "message-text";
    textEl.textContent = text;
    contentEl.appendChild(headerEl);
    contentEl.appendChild(textEl);
    messageDiv.appendChild(avatarEl);
    messageDiv.appendChild(contentEl);
    if (attachment) {
      messageDiv.appendChild(createFileCard(attachment));
    }
    messageDiv.appendChild(createActionToolbar(messageId));
    
    // Virtual scrolling temporarily disabled - use messagesContainer directly
    if (messagesContainer) {
      if (prepend) {
        const banner = messagesContainer.querySelector(".channel-welcome-banner");
        const referenceNode = banner ? banner.nextSibling : messagesContainer.firstChild;
        messagesContainer.insertBefore(messageDiv, referenceNode);
      } else {
        messagesContainer.appendChild(messageDiv);
        // Scroll to bottom if not prepending (new message)
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }
  }

  function displayDecryptedMessage(msg: Message, prepend = false): void {
    if (!App.activeEmberId) return;
    const emberKey = App.emberKeyCache.get(App.activeEmberId);
    if (!emberKey) {
      log.warn("Cannot decrypt message: ember key not in cache", {
        ember_id: App.activeEmberId,
        message_id: msg.id,
      });
      addMessage(
        msg.username ?? "Unknown",
        "[Encrypted message - key unavailable]",
        msg.created_at,
        prepend,
        msg.id,
        msg.chat_color
      );
      return;
    }
    const plaintext = emberCrypto.decryptMessage(msg.ciphertext, emberKey);
    if (plaintext === null) {
      log.warn("Message decryption failed", { message_id: msg.id });
      addMessage(
        msg.username ?? "Unknown",
        "[Failed to decrypt message]",
        msg.created_at,
        prepend,
        msg.id,
        msg.chat_color
      );
      return;
    }
    if (plaintext.startsWith('{"t":"file"')) {
      try {
        const parsed = JSON.parse(plaintext) as { t: string; body: string; a: LocalAttachmentData };
        addMessage(
          msg.username ?? "Unknown",
          parsed.body,
          msg.created_at,
          prepend,
          msg.id,
          msg.chat_color,
          parsed.a
        );
        return;
      } catch (_) {
        // fall through to plain-text rendering
      }
    }
    addMessage(
      msg.username ?? "Unknown",
      plaintext,
      msg.created_at,
      prepend,
      msg.id,
      msg.chat_color
    );
  }

  function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
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
      oldestMessageId: oldestMessageId || undefined // Store current pagination state
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
      (entries) => {
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
    
    const totalHeight = Array.from(virtualScrollContainer.children)
      .reduce((sum, child) => sum + (child as HTMLElement).offsetHeight, 0);
    
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
      const messagesToRemove = Array.from(renderedMessageIds).slice(0, renderedMessageIds.size - maxMessages);
      
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
      average: messageLoadCount > 0 ? duration / messageLoadCount : 0
    });
    
    // Warn if operations are taking too long
    if (duration > 1000) {
      log.warn('Slow operation detected', { operation, duration });
    }
  }
  
  /**
   * Optimize message rendering with document fragments
   */
  function createMessageFragment(messages: Message[]): DocumentFragment {
    const fragment = document.createDocumentFragment();
    
    messages.forEach(message => {
      const messageElement = createMessageElement(message);
      if (messageElement) {
        fragment.appendChild(messageElement);
      }
    });
    
    return fragment;
  }
  
  /**
   * Create optimized message element
   */
  function createMessageElement(message: Message): HTMLElement | null {
    if (!App.activeEmberId) return null;
    
    // Check if element already exists
    let messageElement = messageElements.get(message.id);
    if (messageElement) {
      return messageElement;
    }
    
    // Create new element
    messageElement = document.createElement('div');
    messageElement.className = 'message';
    messageElement.setAttribute('data-message-id', message.id);
    messageElement.setAttribute('data-content-loaded', 'false');
    
    // Store reference
    messageElements.set(message.id, messageElement);
    renderedMessageIds.add(message.id);
    
    // Add to intersection observer for lazy loading
    if (intersectionObserver) {
      intersectionObserver.observe(messageElement);
    }
    
    return messageElement;
  }

  async function fetchMessages(
    channelId: string,
    beforeId: string | null = null
  ): Promise<FetchResult> {
    const startTime = Date.now();
    const cacheKey = beforeId ? `${channelId}-${beforeId}` : channelId;
    
    log.debug("Fetching messages", {
      channel_id: channelId,
      before: beforeId ?? "none",
    });
    
    // Check cache first
    const cached = getCachedMessages(cacheKey);
    if (cached) {
      log.debug("Using cached messages", { channel_id: channelId, count: cached.messages.length });
      monitorPerformance('fetch-messages-cache', startTime);
      return cached;
    }
    
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as AuthData | null;
      if (!auth || !auth.token || !auth.hostname)
        return { messages: [], hasMore: false };
      const result = await window.electronAPI.messageService.fetchMessages(
        auth,
        channelId,
        beforeId ?? undefined
      );
      
      // Cache the result
      cacheMessages(cacheKey, result);
      
      log.debug("Messages fetched", {
        channel_id: channelId,
        count: result.messages.length,
        has_more: result.hasMore,
      });
      
      monitorPerformance('fetch-messages-network', startTime);
      return result;
    } catch (error) {
      const err = error as Error;
      log.error("Error fetching messages", {
        channel_id: channelId,
        error: err.message,
      });
      console.error("Error fetching messages:", error);
      monitorPerformance('fetch-messages-error', startTime);
      return { messages: [], hasMore: false };
    }
  }

  /**
   * Create and show loading indicator for message loading
   */
  function showLoadingIndicator(): HTMLElement {
    const loadingIndicator = document.createElement("div");
    loadingIndicator.className = "messages-loading-indicator";
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
    
    const spinner = loadingIndicator.querySelector(".loading-spinner") as HTMLElement;
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
    log.info("Loading channel messages", { channel_id: channelId });
    
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
    window.clearPendingAttachment?.();

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

    // Channel welcome banner — reads name from header (set by updateChatHeader before this call)
    const channelName =
      document.querySelector(".chat-header .channel-title")?.textContent ?? "";
    const banner = document.createElement("div");
    banner.className = "channel-welcome-banner";

    const heading = document.createElement("h2");
    heading.className = "channel-welcome-heading";
    heading.textContent = `Welcome to #${channelName}!`;

    const subtitle = document.createElement("p");
    subtitle.className = "channel-welcome-subtitle";
    subtitle.textContent = `This is the start of the #${channelName} channel.`;

    const editBtn = document.createElement("button");
    editBtn.className = "channel-welcome-edit-btn";
    const pencilSpan = document.createElement("span");
    pencilSpan.textContent = "✏ ";
    editBtn.appendChild(pencilSpan);
    editBtn.appendChild(document.createTextNode("Edit Channel"));
    editBtn.addEventListener("click", () => {
      const desc =
        document.querySelector(".chat-header .channel-description")
          ?.textContent ?? "";
      window.openChannelNameModal(
        "edit-channel",
        null,
        channelId,
        channelName,
        desc
      );
    });

    banner.appendChild(heading);
    banner.appendChild(subtitle);
    banner.appendChild(editBtn);
    
    // Add banner directly to messagesContainer (before the virtual scroll div)
    messagesContainer.insertBefore(banner, messagesContainer.firstChild);

    // Fetch auth once to populate ownership cache (fast IPC read from safeStorage)
    const authForOwnership = (await ipcRenderer.invoke(
      "get-auth"
    )) as AuthData | null;
    currentUserId = authForOwnership?.user_id ?? null;
    currentUsername = authForOwnership?.username ?? '';

    const { messages, hasMore } = await fetchMessages(channelId);
    hasMoreMessages = hasMore;
    if (messages.length > 0) oldestMessageId = messages[0].id;
    
    log.debug("Rendering messages", {
      channel_id: channelId,
      count: messages.length,
      has_more: hasMore,
    });
    
    // Batch DOM updates for better performance
    const updates: (() => void)[] = [];
    
    messages.forEach((msg) => {
      if (currentUserId && msg.sender_user_id === currentUserId) {
        App.ownedMessageIds.add(msg.id);
      }
      
      // Create message element and add to batch
      const messageElement = createMessageElement(msg);
      if (messageElement) {
        updates.push(() => {
          displayDecryptedMessage(msg);
        });
      }
    });
    
    // Execute all DOM updates in a single batch
    batchDOMUpdates(updates);
    
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
    
    log.debug("Auto-loading more messages", {
      channel_id: channelId,
      current_count: currentMessageCount,
      target_count: targetMessageCount,
      has_more: hasMoreMessages
    });
    
    // Show loading indicator at the top of messages
    const loadingIndicator = showLoadingIndicator();
    // Virtual scrolling disabled - use messagesContainer directly
    if (messagesContainer) {
      // Insert after welcome banner or at the top
      const banner = messagesContainer.querySelector(".channel-welcome-banner");
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
          const updates: (() => void)[] = [];
          for (let i = messages.length - 1; i >= 0; i--) {
            if (currentUserId && messages[i].sender_user_id === currentUserId) {
              App.ownedMessageIds.add(messages[i].id);
            }
            updates.push(() => {
              displayDecryptedMessage(messages[i], true);
            });
          }
          
          // Execute all DOM updates in a single batch
          batchDOMUpdates(updates);
          
          currentMessageCount = renderedMessageIds.size;
          
          log.debug("Auto-loaded batch of messages", {
            channel_id: channelId,
            batch_size: messages.length,
            total_count: currentMessageCount,
            has_more: hasMore
          });
        } else {
          break;
        }
      } catch (error) {
        log.error("Error auto-loading messages", {
          channel_id: channelId,
          error: String(error)
        });
        break;
      } finally {
        isLoadingOlderMessages = false;
      }
    }
    
    // Hide loading indicator
    hideLoadingIndicator(loadingIndicator);
    
    log.debug("Auto-loading completed", {
      channel_id: channelId,
      final_count: renderedMessageIds.size,
      has_more: hasMoreMessages
    });
  }

  function loadOlderMessages(): void {
    if (!App.activeChannelId || !hasMoreMessages || isLoadingOlderMessages)
      return;
    isLoadingOlderMessages = true;
    log.debug("Loading older messages", {
      channel_id: App.activeChannelId,
      before: oldestMessageId,
    });
    
    // Show loading indicator at the top
    const loadingIndicator = showLoadingIndicator();
    // Virtual scrolling disabled - use messagesContainer directly
    if (messagesContainer) {
      const banner = messagesContainer.querySelector(".channel-welcome-banner");
      const referenceNode = banner ? banner.nextSibling : messagesContainer.firstChild;
      messagesContainer.insertBefore(loadingIndicator, referenceNode);
    }
    
    const prevScrollHeight = messagesContainer?.scrollHeight || 0;
    fetchMessages(App.activeChannelId, oldestMessageId).then(
      ({ messages, hasMore }) => {
        hasMoreMessages = hasMore;
        if (messages.length > 0) {
          oldestMessageId = messages[0].id;
          // Prepend in reverse order so oldest appears at top
          for (let i = messages.length - 1; i >= 0; i--) {
            if (currentUserId && messages[i].sender_user_id === currentUserId) {
              App.ownedMessageIds.add(messages[i].id);
            }
            displayDecryptedMessage(messages[i], true);
          }
          // Restore scroll position so the viewport doesn't jump
          messagesContainer!.scrollTop =
            messagesContainer!.scrollHeight - prevScrollHeight;
        }
        isLoadingOlderMessages = false;
        hideLoadingIndicator(loadingIndicator);
        
        log.debug("Older messages loaded", {
          channel_id: App.activeChannelId,
          count: messages.length,
          has_more: hasMore
        });
      }
    ).catch((error) => {
      log.error("Error loading older messages", {
        channel_id: App.activeChannelId,
        error: String(error)
      });
      isLoadingOlderMessages = false;
      hideLoadingIndicator(loadingIndicator);
    });
  }

  // ─── Direct Messaging Functions ───────────────────────────────────────────

  /**
   * Send an encrypted direct message
   */
  async function sendDirectMessage(conversationId: string, plaintext: string): Promise<string> {
    if (!DMCrypto) {
      log.error("DM crypto not available");
      throw new Error("Direct messaging crypto not available");
    }
    
    const conversationKey = dmConversationKeys.get(conversationId);
    if (!conversationKey) {
      log.error("Cannot send DM: no conversation key", { conversationId });
      throw new Error("Conversation key not available for encryption");
    }
    
    log.debug("Sending encrypted direct message", { conversationId });
    try {
      // Encrypt message using ember-shared DM crypto
      const encryptedContent = DMCrypto.encryptDirectMessage(plaintext, conversationKey);
      
      // Send via WebSocket
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
      } | null;
      
      if (!auth || !auth.token || !auth.hostname) {
        throw new Error("Authentication required");
      }
      
      // This would send through the WebSocket connection
      // For now, we'll use the existing WebSocket infrastructure
      const messageData = {
        conversation_id: conversationId,
        content: encryptedContent,
        timestamp: Date.now()
      };
      
      // Send through existing WebSocket
      if (App.wsConnection && App.wsConnection.readyState === WebSocket.OPEN) {
        App.wsConnection.send(JSON.stringify({
          type: "dm_message",
          payload: messageData
        }));
      }
      
      // Return a temporary message ID (in a real implementation, this would come from the server)
      return `temp_${Date.now()}`;
    } catch (error) {
      const err = error as Error;
      log.error("Error sending direct message", {
        conversationId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Decrypt and display a direct message
   */
  async function displayDirectMessage(messageData: {
    id: string;
    conversation_id: string;
    sender_user_id: string;
    content: string;
    timestamp: number;
  }): Promise<void> {
    if (!DMCrypto) {
      log.error("DM crypto not available");
      return;
    }
    
    const conversationKey = dmConversationKeys.get(messageData.conversation_id);
    if (!conversationKey) {
      log.warn("Cannot decrypt DM: no conversation key", { 
        conversationId: messageData.conversation_id 
      });
      return;
    }
    
    try {
      // Decrypt message using ember-shared DM crypto
      const decryptedContent = DMCrypto.decryptDirectMessage(
        messageData.content, 
        conversationKey
      );
      
      // Create message object for display
      const displayData = {
        id: messageData.id,
        channel_id: messageData.conversation_id,
        sender_user_id: messageData.sender_user_id,
        content: decryptedContent,
        sender_username: "User", // This would be resolved from user data
        created_at: Math.floor(messageData.timestamp / 1000),
        sender_id: messageData.sender_user_id,
        ciphertext: messageData.content // Original encrypted content
      };
      
      // Display using existing message display function
      displayDecryptedMessage(displayData as any);
      
      log.debug("Direct message displayed", { 
        messageId: messageData.id,
        conversationId: messageData.conversation_id 
      });
    } catch (error) {
      const err = error as Error;
      log.error("Failed to decrypt direct message", {
        messageId: messageData.id,
        conversationId: messageData.conversation_id,
        error: err.message
      });
    }
  }

  /**
   * Cache a DM conversation key
   */
  function cacheDmConversationKey(conversationId: string, key: Uint8Array): void {
    dmConversationKeys.set(conversationId, key);
    log.debug("DM conversation key cached", { conversationId });
  }

  /**
   * Remove a DM conversation key from cache
   */
  function removeDmConversationKey(conversationId: string): void {
    dmConversationKeys.delete(conversationId);
    log.debug("DM conversation key removed from cache", { conversationId });
  }

  if (messagesContainer) {
    let scrollTimeout: NodeJS.Timeout | null = null;
    
    messagesContainer.addEventListener("scroll", () => {
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
          log.debug("Scroll trigger: loading older messages", {
            scroll_top: scrollTop,
            threshold: scrollThreshold,
            has_more: hasMoreMessages,
            is_loading: isLoadingOlderMessages
          });
          loadOlderMessages();
        }
      }, 100); // 100ms debounce
    });
  }

  window.sendEncryptedMessage = sendEncryptedMessage;
  window.displayDecryptedMessage = displayDecryptedMessage;
  window.handleEditedMessage = handleEditedMessage;
  window.escapeHtml = escapeHtml;
  window.loadChannelMessages = loadChannelMessages;
  window.fetchMessages = fetchMessages;
  window.addMessage = addMessage;
  window.formatTimestamp = formatTimestamp;
  
  // DM-specific functions
  window.sendDirectMessage = sendDirectMessage;
  window.displayDirectMessage = displayDirectMessage;
  window.cacheDmConversationKey = cacheDmConversationKey;
  window.removeDmConversationKey = removeDmConversationKey;
  
  // Performance optimization functions
  window.getCachedMessages = getCachedMessages;
  window.cacheMessages = cacheMessages;
  window.initializeVirtualScrolling = initializeVirtualScrolling;
  window.cleanupOldMessages = cleanupOldMessages;
  window.monitorPerformance = monitorPerformance;
})();
