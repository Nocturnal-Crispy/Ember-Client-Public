/**
 * Message service — TypeScript conversion of public/message-manager.js.
 * Handles message fetch, encrypt/send, decrypt/display.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger("MessageManager");
  const emberCrypto = window.electronAPI.crypto;

  const messagesContainer = document.getElementById("messages");

  // Pagination state (per channel load)
  let hasMoreMessages = false;
  let oldestMessageId: string | null = null;
  let isLoadingOlderMessages = false;

  // Current user ID cached for ownership checks (set in loadChannelMessages)
  let currentUserId: string | null = null;

  async function sendEncryptedMessage(plaintext: string): Promise<void> {
    if (!App.activeChannelId || !App.activeEmberId) return;
    const emberKey = App.emberKeyCache.get(App.activeEmberId);
    if (!emberKey) {
      log.error("Cannot send message: no ember key in cache", {
        ember_id: App.activeEmberId,
      });
      console.error("No ember key available for encryption");
      return;
    }
    log.debug("Sending encrypted message", { channel_id: App.activeChannelId });
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as AuthData | null;
      if (!auth || !auth.token || !auth.hostname) return;
      const msgData = await window.electronAPI.messageService.sendMessage(
        auth,
        App.activeChannelId,
        plaintext,
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
      console.error("Error sending message:", error);
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

  function addMessage(
    author: string,
    text: string,
    timestamp?: number,
    prepend = false,
    messageId?: string
  ): void {
    const messageDiv = document.createElement("div");
    messageDiv.className = "message";
    if (messageId) messageDiv.dataset["messageId"] = messageId;
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
    messageDiv.appendChild(createActionToolbar(messageId));
    if (messagesContainer) {
      if (prepend) {
        const banner = messagesContainer.querySelector(
          ".channel-welcome-banner"
        );
        const referenceNode = banner
          ? banner.nextSibling
          : messagesContainer.firstChild;
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
      log.warn("Cannot decrypt message: ember key not in cache", {
        ember_id: App.activeEmberId,
        message_id: msg.id,
      });
      addMessage(
        msg.username ?? "Unknown",
        "[Encrypted message - key unavailable]",
        msg.created_at,
        prepend,
        msg.id
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
        msg.id
      );
      return;
    }
    addMessage(
      msg.username ?? "Unknown",
      plaintext,
      msg.created_at,
      prepend,
      msg.id
    );
  }

  function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  interface FetchResult {
    messages: Message[];
    hasMore: boolean;
  }

  async function fetchMessages(
    channelId: string,
    beforeId: string | null = null
  ): Promise<FetchResult> {
    log.debug("Fetching messages", {
      channel_id: channelId,
      before: beforeId ?? "none",
    });
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as AuthData | null;
      if (!auth || !auth.token || !auth.hostname)
        return { messages: [], hasMore: false };
      const result = await window.electronAPI.messageService.fetchMessages(
        auth,
        channelId,
        beforeId ?? undefined
      );
      log.debug("Messages fetched", {
        channel_id: channelId,
        count: result.messages.length,
        has_more: result.hasMore,
      });
      return result;
    } catch (error) {
      const err = error as Error;
      log.error("Error fetching messages", {
        channel_id: channelId,
        error: err.message,
      });
      console.error("Error fetching messages:", error);
      return { messages: [], hasMore: false };
    }
  }

  async function loadChannelMessages(channelId: string): Promise<void> {
    if (!messagesContainer) return;
    log.info("Loading channel messages", { channel_id: channelId });
    // Reset pagination state and ownership cache for the new channel
    hasMoreMessages = false;
    oldestMessageId = null;
    isLoadingOlderMessages = false;
    App.ownedMessageIds.clear();
    while (messagesContainer.firstChild)
      messagesContainer.removeChild(messagesContainer.firstChild);
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
    messagesContainer.appendChild(banner);

    // Fetch auth once to populate ownership cache (fast IPC read from safeStorage)
    const authForOwnership = (await ipcRenderer.invoke(
      "get-auth"
    )) as AuthData | null;
    currentUserId = authForOwnership?.user_id ?? null;

    const { messages, hasMore } = await fetchMessages(channelId);
    hasMoreMessages = hasMore;
    if (messages.length > 0) oldestMessageId = messages[0].id;
    log.debug("Rendering messages", {
      channel_id: channelId,
      count: messages.length,
      has_more: hasMore,
    });
    messages.forEach((msg) => {
      if (currentUserId && msg.sender_user_id === currentUserId) {
        App.ownedMessageIds.add(msg.id);
      }
      displayDecryptedMessage(msg);
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
    const prevScrollHeight = messagesContainer!.scrollHeight;
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
      }
    );
  }

  if (messagesContainer) {
    messagesContainer.addEventListener("scroll", () => {
      if (messagesContainer.scrollTop < 100) {
        loadOlderMessages();
      }
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
})();
