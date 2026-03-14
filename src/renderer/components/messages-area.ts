/**
 * messages-area.ts — Shared message-rendering component.
 *
 * Provides createBasicMessageElement and createActionToolbar used by both
 * text channels (message-service.ts) and DM channels (direct-messaging-ui.ts).
 *
 * Load order: must appear in main-loader BEFORE message-service.js and
 * direct-messaging-ui.js.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger("MessagesArea");
  const emberCrypto = window.electronAPI.crypto;

  type GetEmberKey = (channelId: string) => Promise<Uint8Array | null>;

  // ─── Utilities ─────────────────────────────────────────────────────────────

  function toChumhandle(username: string): string {
    const words = username.match(/[A-Z]?[a-z]+|[0-9]+|[A-Z]+/g) || [username];
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return username.slice(0, 2).toUpperCase();
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
    return `${date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })} at ${timeStr}`;
  }

  function isImageMime(mime: string): boolean {
    return typeof mime === "string" && mime.startsWith("image/");
  }

  // ─── URL detection ─────────────────────────────────────────────────────────

  const URL_REGEX_SOURCE = "https?:\\/\\/[^\\s<>\"']+";
  const IMAGE_URL_REGEX = /^https?:\/\/.+\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?[^\s]*)?$/i;

  function isImageUrl(url: string): boolean {
    return IMAGE_URL_REGEX.test(url);
  }

  function createUrlImageCard(url: string): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "url-image-card";

    const img = document.createElement("img");
    img.className = "url-image-img";
    img.loading = "lazy";
    img.alt = "Image";

    img.onerror = () => {
      wrapper.className = "url-image-card url-image-card-error";
      const errSpan = document.createElement("span");
      errSpan.textContent = "[failed to load image]";
      wrapper.replaceChildren(errSpan);
    };

    img.onload = () => {
      img.addEventListener("click", () => {
        (window as any).openImageViewer?.(url, url);
      });
      const scrollContainer = img.closest(
        ".messages-container, #messages"
      ) as HTMLElement | null;
      if (scrollContainer) {
        const dist =
          scrollContainer.scrollHeight -
          scrollContainer.scrollTop -
          scrollContainer.clientHeight;
        const expanded = Math.max(0, (img.offsetHeight || 300) - 80);
        if (dist <= expanded + 60) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    };

    img.src = url;
    wrapper.appendChild(img);
    return wrapper;
  }

  function renderTextWithLinks(text: string, container: HTMLElement): void {
    if (!text) return;

    const regex = new RegExp(URL_REGEX_SOURCE, "g");
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(
          document.createTextNode(text.slice(lastIndex, match.index))
        );
      }

      const url = match[0];

      if (isImageUrl(url)) {
        container.appendChild(createUrlImageCard(url));
      } else {
        const link = document.createElement("a");
        link.className = "message-link";
        link.textContent = url;
        link.href = "#";
        link.addEventListener("click", (e) => {
          e.preventDefault();
          (window as any).openExternalLinkModal?.(url);
        });
        container.appendChild(link);
      }

      lastIndex = match.index + url.length;
    }

    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  // ─── GIF card ──────────────────────────────────────────────────────────────

  function createGifCard(gifData: { url: string; title?: string }): HTMLElement {
    const card = document.createElement("div");
    card.className = "gif-card";
    const img = document.createElement("img");
    img.src = gifData.url;
    img.alt = gifData.title || "GIF";
    img.loading = "lazy";
    img.addEventListener("click", () => {
      (window as any).openImageViewer?.(gifData.url, gifData.title || "GIF");
    });
    card.appendChild(img);
    return card;
  }

  // ─── Attachment loading and downloading ────────────────────────────────────

  function loadImageForCard(
    attachment: AttachmentData,
    img: HTMLImageElement,
    statusEl: HTMLElement,
    wrapper: HTMLElement,
    channelId: string,
    getEmberKey: GetEmberKey
  ): void {
    getEmberKey(channelId)
      .then((emberKey) => {
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
          window.electronAPI.messageService
            .downloadAttachment(auth, channelId, attachment.id)
            .then((resp) => {
              const bytes = emberCrypto.decryptFileBytes(
                resp.encrypted_data,
                emberKey
              );
              if (!bytes) {
                statusEl.textContent = "[failed to decrypt image]";
                wrapper.className = "image-card-wrapper image-card-state-error";
                log.error("Failed to decrypt image attachment", {
                  id: attachment.id,
                });
                return;
              }
              const blob = new Blob([new Uint8Array(bytes)], {
                type: attachment.mime || "image/png",
              });
              const url = URL.createObjectURL(blob);
              img.onload = () => {
                wrapper.className = "image-card-wrapper image-card-state-loaded";
                img.addEventListener("click", () => {
                  (window as any).openImageViewer?.(url, attachment.name);
                });
                // Auto-scroll back to bottom when an image expands the layout
                // and the user was already at the bottom.
                const scrollContainer = img.closest(
                  ".messages-container, #messages"
                ) as HTMLElement | null;
                if (scrollContainer) {
                  const dist =
                    scrollContainer.scrollHeight -
                    scrollContainer.scrollTop -
                    scrollContainer.clientHeight;
                  const expanded = Math.max(0, (img.offsetHeight || 300) - 80);
                  if (dist <= expanded + 60) {
                    scrollContainer.scrollTop = scrollContainer.scrollHeight;
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
              log.error("Failed to download image attachment", {
                id: attachment.id,
                error: err.message,
              });
            });
        });
      })
      .catch((err: Error) => {
        statusEl.textContent = "[failed to load image]";
        wrapper.className = "image-card-wrapper image-card-state-error";
        log.error("Failed to get ember key for image", { error: err.message });
      });
  }

  function downloadAttachmentFile(
    attachment: AttachmentData,
    channelId: string,
    getEmberKey: GetEmberKey
  ): void {
    getEmberKey(channelId)
      .then((emberKey) => {
        if (!emberKey) {
          log.error("Cannot download: no ember key", { id: attachment.id });
          return;
        }
        ipcRenderer.invoke("get-auth").then((authUnknown: unknown) => {
          const auth = authUnknown as AuthData | null;
          if (!auth) return;
          window.electronAPI.messageService
            .downloadAttachment(auth, channelId, attachment.id)
            .then((resp) => {
              const bytes = emberCrypto.decryptFileBytes(
                resp.encrypted_data,
                emberKey
              );
              if (!bytes) {
                log.error("Failed to decrypt attachment", { id: attachment.id });
                return;
              }
              const blob = new Blob([new Uint8Array(bytes)], {
                type: resp.content_type || "application/octet-stream",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = resp.original_name;
              a.click();
              URL.revokeObjectURL(url);
            })
            .catch((err: Error) => {
              log.error("Failed to download attachment", {
                id: attachment.id,
                error: err.message,
              });
            });
        });
      })
      .catch((err: Error) => {
        log.error("Failed to get ember key for download", {
          error: err.message,
        });
      });
  }

  function createImageCard(
    attachment: AttachmentData,
    channelId: string,
    getEmberKey: GetEmberKey
  ): HTMLElement {
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
    saveBtn.addEventListener("click", () => {
      downloadAttachmentFile(attachment, channelId, getEmberKey);
    });

    footer.appendChild(nameEl);
    footer.appendChild(saveBtn);
    card.appendChild(imgWrapper);
    card.appendChild(footer);

    loadImageForCard(attachment, img, statusEl, imgWrapper, channelId, getEmberKey);

    return card;
  }

  function createFileCard(
    attachment: AttachmentData,
    channelId: string,
    getEmberKey: GetEmberKey
  ): HTMLElement {
    if (isImageMime(attachment.mime)) {
      return createImageCard(attachment, channelId, getEmberKey);
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
    dlBtn.addEventListener("click", () => {
      downloadAttachmentFile(attachment, channelId, getEmberKey);
    });

    card.appendChild(icon);
    card.appendChild(nameEl);
    card.appendChild(dlBtn);
    return card;
  }

  // ─── Action toolbar ────────────────────────────────────────────────────────

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

  /**
   * Configure and show the delete-confirm modal for a message deletion.
   */
  function showDeleteMessageModal(messageId: string, channelId: string): void {
    (window as any).pendingMessageDelete = { messageId, channelId };
    const titleEl = document.getElementById("delete-modal-title");
    const msgEl = document.getElementById("delete-modal-message");
    if (titleEl) titleEl.textContent = "Delete Message";
    if (msgEl) msgEl.textContent = "Are you sure you want to delete this message? This cannot be undone.";
    document.getElementById("delete-confirm-modal")?.classList.remove("hidden");
  }

  /**
   * Build the hover action toolbar.
   *
   * @param messageId - The message ID (used for ownedMessageIds lookup and edit).
   * @param isOwn     - Explicit ownership override. If omitted, falls back to
   *                    App.ownedMessageIds (text-channel messages only).
   */
  function createActionToolbar(
    messageId?: string,
    isOwn?: boolean
  ): HTMLDivElement {
    const toolbar = document.createElement("div");
    toolbar.className = "message-action-bar";

    // Prefer explicit isOwn; fall back to App.ownedMessageIds for text channels.
    const owned =
      isOwn !== undefined
        ? isOwn
        : !!messageId && App.ownedMessageIds.has(messageId);

    if (owned) {
      toolbar.appendChild(
        createActionButton("✏", "Edit", () => {
          const msgDiv = toolbar.closest(".message") as HTMLElement | null;
          if (msgDiv && messageId) {
            const enterEdit = (window as any).enterEditMode as
              | ((div: HTMLElement, id: string) => void)
              | undefined;
            enterEdit?.(msgDiv, messageId);
          }
        })
      );

      toolbar.appendChild(
        createActionButton("🗑", "Delete", () => {
          if (messageId) {
            const channelId = App.activeChannelId ?? "";
            showDeleteMessageModal(messageId, channelId);
          }
        })
      );
    }

    return toolbar;
  }

  // ─── Message element builder ───────────────────────────────────────────────

  /**
   * Build a single message DOM element.
   *
   * @param author       - Display name for the sender.
   * @param text         - Decrypted plaintext body (may be "" for attachment/GIF-only messages).
   * @param timestamp    - Unix seconds.
   * @param messageId    - Used for data-message-id and action toolbar.
   * @param chatColor    - Optional custom chat colour.
   * @param isOwn        - True if the message was sent by the current user.
   * @param attachment   - Parsed attachment metadata (from `{"t":"file",...}`).
   * @param gif          - Parsed GIF metadata (from `{"t":"gif",...}`).
   * @param channelId    - Channel ID used for attachment download/decryption.
   * @param getEmberKey  - Async callback that resolves the ember key for the channel.
   */
  function createBasicMessageElement(
    author: string,
    text: string,
    timestamp?: number,
    messageId?: string,
    chatColor?: string,
    isOwn?: boolean,
    attachment?: AttachmentData,
    gif?: { url: string; title?: string },
    channelId?: string,
    getEmberKey?: GetEmberKey
  ): HTMLElement {
    const messageDiv = document.createElement("div");
    messageDiv.className = "message";
    if (messageId) messageDiv.dataset["messageId"] = messageId;
    messageDiv.dataset["chumhandle"] = "[" + toChumhandle(author) + "]: ";
    if (isOwn) messageDiv.classList.add("own");
    if (chatColor) messageDiv.style.color = chatColor;

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
    tsEl.textContent = formatTimestamp(timestamp);

    headerEl.appendChild(authorEl);
    headerEl.appendChild(tsEl);

    const textEl = document.createElement("div");
    textEl.className = "message-text";
    renderTextWithLinks(text, textEl);

    contentEl.appendChild(headerEl);
    contentEl.appendChild(textEl);
    messageDiv.appendChild(avatarEl);
    messageDiv.appendChild(contentEl);

    if (attachment && channelId && getEmberKey) {
      messageDiv.appendChild(createFileCard(attachment, channelId, getEmberKey));
    }

    if (gif) {
      messageDiv.appendChild(createGifCard(gif));
    }

    messageDiv.appendChild(createActionToolbar(messageId, isOwn));

    return messageDiv;
  }

  // ─── Expose globals ────────────────────────────────────────────────────────

  window.createBasicMessageElement = createBasicMessageElement;
  window.createActionToolbar = createActionToolbar;
  window.formatTimestamp = formatTimestamp;
  window.toChumhandle = toChumhandle;
})();
