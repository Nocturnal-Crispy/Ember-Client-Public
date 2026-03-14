/**
 * Renderer manager — TypeScript conversion of renderer.js.
 * Application entry point: initializes the UI, health checks, and WebSocket.
 */
(function (): void {
  console.log("[renderer] Renderer manager starting...");
  
  // Wait for electronAPI to be available
  function waitForElectronAPI(): Promise<void> {
    return new Promise((resolve) => {
      if ((window as any).electronAPI) {
        resolve();
        return;
      }
      
      const checkInterval = setInterval(() => {
        if ((window as any).electronAPI) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 10);
      
      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        console.warn("[renderer] electronAPI not available after timeout");
        resolve();
      }, 5000);
    });
  }
  
  // Initialize when API is ready
  waitForElectronAPI().then(() => {
    console.log("[renderer] electronAPI available, initializing...");
    
    const ipcRenderer = (window as any).electronAPI.ipc;
    const log = (window as any).emberLog.createLogger("Renderer");
    const App = (window as any).App;
    
    console.log("[renderer] window.electronAPI:", (window as any).electronAPI);
    console.log("[renderer] window.emberLog:", (window as any).emberLog);

  const messageInput = document.getElementById(
    "messageInput"
  ) as HTMLTextAreaElement | null;

  const minimizeBtn = document.getElementById("minimize-btn");
  const maximizeBtn = document.getElementById("maximize-btn");
  const closeBtn = document.getElementById("close-btn");
  
  console.log("[renderer] Button elements found:", {
    minimizeBtn: !!minimizeBtn,
    maximizeBtn: !!maximizeBtn,
    closeBtn: !!closeBtn
  });
  
  minimizeBtn?.addEventListener("click", () => {
    console.log("[renderer] Minimize button clicked");
    ipcRenderer.send("window-minimize");
  });

  maximizeBtn?.addEventListener("click", () => {
    console.log("[renderer] Maximize button clicked");
    ipcRenderer.send("window-maximize");
  });

  closeBtn?.addEventListener("click", () => {
    console.log("[renderer] Close button clicked");
    ipcRenderer.send("window-close");
  });

  // DM Icon functionality
  const dmIcon = document.getElementById("dm-icon");
  const dmScreen = document.getElementById("dm-screen");
  
  if (dmIcon && dmScreen) {
    dmIcon.addEventListener("click", () => {
      toggleDMScreen();
    });
    
    // Handle Escape key to close DM screen
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && dmScreen.classList.contains("active")) {
        closeDMScreen();
      }
    });
    
    // Handle clicking outside DM screen to close
    dmScreen.addEventListener("click", (e) => {
      if (e.target === dmScreen) {
        closeDMScreen();
      }
    });
  }
  
  function toggleDMScreen() {
    if (dmScreen!.classList.contains("active")) {
      closeDMScreen();
    } else {
      openDMScreen();
    }
  }
  
  function openDMScreen() {
    dmScreen!.classList.add("active");
    dmIcon!.classList.add("active");
    
    // Add class to body for CSS targeting
    document.body.classList.add("dm-screen-open");
    
    // Hide main content but keep user panel visible
    const appContainer = document.querySelector(".app-container");
    if (appContainer) {
      const channelList = appContainer.querySelector(".channel-list");
      const chatContainer = appContainer.querySelector(".chat-container");
      const memberList = appContainer.querySelector(".member-list");
      const welcomeScreen = appContainer.querySelector(".welcome-screen");
      const userPanel = appContainer.querySelector(".user-panel");
      
      if (channelList) {
        // Hide channel list content but keep the container for user panel
        const serverHeader = (channelList as HTMLElement).querySelector(".server-header");
        const channels = (channelList as HTMLElement).querySelector(".channels");
        const voiceControls = (channelList as HTMLElement).querySelector(".voice-controls");
        
        if (serverHeader) (serverHeader as HTMLElement).style.display = "none";
        if (channels) (channels as HTMLElement).style.display = "none";
        if (voiceControls) (voiceControls as HTMLElement).style.display = "none";
        
        // Keep channel list itself visible to show user panel
        (channelList as HTMLElement).style.display = "";
      }
      if (chatContainer) (chatContainer as HTMLElement).style.display = "none";
      if (memberList) (memberList as HTMLElement).style.display = "none";
      if (welcomeScreen) (welcomeScreen as HTMLElement).style.display = "none";
      
      // Ensure user panel stays visible
      if (userPanel) (userPanel as HTMLElement).style.display = "flex";
    }
    
    // Focus on search input
    setTimeout(() => {
      const searchInput = document.getElementById("dm-search-input");
      if (searchInput) {
        (searchInput as HTMLInputElement).focus();
      }
    }, 100);
    
    // Hide version display when DM screen is opened
    const versionDisplay = document.getElementById("version-display");
    if (versionDisplay) {
      versionDisplay.style.display = "none";
    }
    
    log.info("DM Screen opened");
  }
  
  function closeDMScreen() {
    dmScreen!.classList.remove("active");
    dmIcon!.classList.remove("active");
    
    // Remove class from body
    document.body.classList.remove("dm-screen-open");
    
    // Show main content again
    const appContainer = document.querySelector(".app-container");
    if (appContainer) {
      const channelList = appContainer.querySelector(".channel-list");
      const chatContainer = appContainer.querySelector(".chat-container");
      const memberList = appContainer.querySelector(".member-list");
      const welcomeScreen = appContainer.querySelector(".welcome-screen");
      
      if (channelList) {
        // Restore channel list content
        const serverHeader = (channelList as HTMLElement).querySelector(".server-header");
        const channels = (channelList as HTMLElement).querySelector(".channels");
        const voiceControls = (channelList as HTMLElement).querySelector(".voice-controls");
        
        if (serverHeader) (serverHeader as HTMLElement).style.display = "";
        if (channels) (channels as HTMLElement).style.display = "";
        if (voiceControls) (voiceControls as HTMLElement).style.display = "";
      }
      if (chatContainer) (chatContainer as HTMLElement).style.display = "";
      if (memberList) (memberList as HTMLElement).style.display = "";
      if (welcomeScreen) (welcomeScreen as HTMLElement).style.display = "";
    }
    
    // Show version display when DM screen is closed
    const versionDisplay = document.getElementById("version-display");
    if (versionDisplay) {
      versionDisplay.style.display = "block";
    }
    
    log.info("DM Screen closed");
  }
  
  // Function to close DM screen when switching to server
  function closeDMScreenOnServerSwitch() {
    if (dmScreen!.classList.contains("active")) {
      closeDMScreen();
    }
  }
  
  // Expose globally for other modules to call
  window.closeDMScreenOnServerSwitch = closeDMScreenOnServerSwitch;

  const logoutBtn = document.getElementById("logout-btn");
  const logoutModal = document.getElementById("logout-modal");
  const modalCancelBtn = document.getElementById("modal-cancel-btn");
  const modalLogoutBtn = document.getElementById("modal-logout-btn");

  if (logoutBtn && logoutModal) {
    logoutBtn.addEventListener("click", () => {
      logoutModal.classList.remove("hidden");
    });
  }

  if (modalCancelBtn && logoutModal) {
    modalCancelBtn.addEventListener("click", () => {
      logoutModal.classList.add("hidden");
    });
  }

  if (modalLogoutBtn && logoutModal) {
    modalLogoutBtn.addEventListener("click", () => {
      logoutModal.classList.add("hidden");
      forceLogout();
    });
  }

  if (logoutModal) {
    logoutModal.addEventListener("click", (e) => {
      if (e.target === logoutModal) {
        logoutModal.classList.add("hidden");
      }
    });
  }

  // ─── Attachment composer ───────────────────────────────────────────────────

  const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5 MB

  function clearPendingAttachment(): void {
    App.pendingAttachment = null;
    const preview = document.getElementById("attachment-preview");
    if (!preview) return;
    if (attachmentErrorTimer !== null) { clearTimeout(attachmentErrorTimer); attachmentErrorTimer = null; }
    preview.classList.add("hidden");
    preview.classList.remove("attachment-preview-error");
    while (preview.firstChild) preview.removeChild(preview.firstChild);
  }

  function renderAttachmentPreview(): void {
    const preview = document.getElementById("attachment-preview");
    if (!preview) return;
    while (preview.firstChild) preview.removeChild(preview.firstChild);
    if (!App.pendingAttachment) {
      preview.classList.add("hidden");
      return;
    }
    const icon = document.createElement("span");
    icon.className = "attachment-preview-icon";
    icon.textContent = "📎 ";
    const nameEl = document.createElement("span");
    nameEl.className = "attachment-preview-name";
    nameEl.textContent = App.pendingAttachment.name;
    const removeBtn = document.createElement("button");
    removeBtn.className = "attachment-preview-remove";
    removeBtn.title = "Remove attachment";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", clearPendingAttachment);
    preview.appendChild(icon);
    preview.appendChild(nameEl);
    preview.appendChild(removeBtn);
    preview.classList.remove("hidden");
  }

  let attachmentErrorTimer: ReturnType<typeof setTimeout> | null = null;

  function showAttachmentError(message: string): void {
    const preview = document.getElementById("attachment-preview");
    if (!preview) return;
    if (attachmentErrorTimer !== null) clearTimeout(attachmentErrorTimer);
    while (preview.firstChild) preview.removeChild(preview.firstChild);
    const errEl = document.createElement("span");
    errEl.className = "attachment-error-text";
    errEl.textContent = message;
    preview.appendChild(errEl);
    preview.classList.remove("hidden");
    preview.classList.add("attachment-preview-error");
    attachmentErrorTimer = setTimeout(() => {
      preview.classList.add("hidden");
      preview.classList.remove("attachment-preview-error");
      while (preview.firstChild) preview.removeChild(preview.firstChild);
      attachmentErrorTimer = null;
    }, 4000);
  }

  function setPendingAttachment(file: File): void {
    if (file.size === 0) return;
    if (file.size > MAX_ATTACHMENT_SIZE) {
      log.warn("Attachment too large", { name: file.name, size: file.size });
      showAttachmentError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum size is 5 MB.`);
      return;
    }
    App.pendingAttachment = { file, name: file.name, size: file.size, type: file.type };
    renderAttachmentPreview();
  }

  window.clearPendingAttachment = clearPendingAttachment;
  (window as any).showInputError = showAttachmentError;

  // ─── Image viewer lightbox ───────────────────────────────────────────────────

  (function wireImageViewer(): void {
    const overlay = document.getElementById("image-viewer-modal");
    const stage   = document.getElementById("image-viewer-stage");
    const img     = document.getElementById("image-viewer-img") as HTMLImageElement | null;
    const nameEl  = document.getElementById("image-viewer-name");
    const zoomLbl = document.getElementById("image-viewer-zoom-label");
    const btnIn   = document.getElementById("image-viewer-zoom-in");
    const btnOut  = document.getElementById("image-viewer-zoom-out");
    const btnReset= document.getElementById("image-viewer-reset");
    const btnClose= document.getElementById("image-viewer-close");

    if (!overlay || !stage || !img) return;

    let scale = 1;
    let panX = 0;
    let panY = 0;
    const MIN_SCALE = 0.1;
    const MAX_SCALE = 10;
    const ZOOM_STEP = 0.25;

    function applyTransform(): void {
      img!.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
      if (zoomLbl) zoomLbl.textContent = `${Math.round(scale * 100)}%`;
    }

    function clampPan(): void {
      if (!img || !stage) return;
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      const iw = img.naturalWidth  * scale;
      const ih = img.naturalHeight * scale;
      const maxX = Math.max(0, (iw - sw) / 2);
      const maxY = Math.max(0, (ih - sh) / 2);
      panX = Math.max(-maxX, Math.min(maxX, panX));
      panY = Math.max(-maxY, Math.min(maxY, panY));
    }

    function resetView(): void {
      if (!img || !stage) return;
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      const fitScale = Math.min(sw / img.naturalWidth, sh / img.naturalHeight, 1);
      scale = fitScale;
      panX = 0;
      panY = 0;
      applyTransform();
    }

    function zoom(delta: number, originX?: number, originY?: number): void {
      if (!stage) return;
      const prevScale = scale;
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta));
      if (scale === prevScale) return;
      // Adjust pan to zoom toward the cursor position
      if (originX !== undefined && originY !== undefined) {
        const rect = stage.getBoundingClientRect();
        const ox = originX - rect.left - rect.width  / 2;
        const oy = originY - rect.top  - rect.height / 2;
        panX = ox - (scale / prevScale) * (ox - panX);
        panY = oy - (scale / prevScale) * (oy - panY);
      }
      clampPan();
      applyTransform();
    }

    // Mouse wheel zoom
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      zoom(delta, e.clientX, e.clientY);
    }, { passive: false });

    // Button zoom
    btnIn?.addEventListener("click",    () => zoom(ZOOM_STEP));
    btnOut?.addEventListener("click",   () => zoom(-ZOOM_STEP));
    btnReset?.addEventListener("click", resetView);

    // Double-click to reset
    stage.addEventListener("dblclick", resetView);

    // Drag to pan
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panStartX = 0;
    let panStartY = 0;

    stage.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panStartX = panX;
      panStartY = panY;
      stage.classList.add("dragging");
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panX = panStartX + (e.clientX - dragStartX);
      panY = panStartY + (e.clientY - dragStartY);
      clampPan();
      applyTransform();
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      stage.classList.remove("dragging");
    });

    // Close handlers
    function closeViewer(): void {
      overlay!.classList.add("hidden");
      img!.src = "";
    }

    btnClose?.addEventListener("click", closeViewer);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeViewer();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
        closeViewer();
      }
    });

    // Public API
    (window as any).openImageViewer = function(src: string, name: string): void {
      if (!img) return;
      img.src = src;
      img.alt = name;
      if (nameEl) nameEl.textContent = name;
      overlay.classList.remove("hidden");
      // Wait for image dimensions then fit to screen
      if (img.complete && img.naturalWidth) {
        resetView();
      } else {
        img.onload = resetView;
      }
    };
  })();

  // ─── External link confirmation modal ───────────────────────────────────────

  (function wireExternalLinkModal(): void {
    const modal = document.getElementById("external-link-modal");
    const urlEl = document.getElementById("external-link-url");
    const cancelBtn = document.getElementById("external-link-cancel");
    const openBtn = document.getElementById("external-link-open");

    if (!modal) return;

    let pendingUrl = "";

    (window as any).openExternalLinkModal = function (url: string): void {
      pendingUrl = url;
      if (urlEl) urlEl.textContent = url;
      modal.classList.remove("hidden");
    };

    cancelBtn?.addEventListener("click", () => {
      modal.classList.add("hidden");
      pendingUrl = "";
    });

    openBtn?.addEventListener("click", () => {
      modal.classList.add("hidden");
      if (pendingUrl) {
        ipcRenderer.invoke("open-external-url", pendingUrl).catch((err: Error) => {
          log.error("Failed to open external URL", { error: err.message });
        });
      }
      pendingUrl = "";
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.add("hidden");
        pendingUrl = "";
      }
    });
  })();

  // Wire emoji button → picker
  const emojiBtn = document.getElementById("emoji-btn") as HTMLElement | null;
  if (emojiBtn && messageInput) {
    emojiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      (window as any).openEmojiPicker(emojiBtn, messageInput);
    });
  }

  // Wire gif button → picker
  const gifBtn = document.getElementById("gif-btn") as HTMLElement | null;
  if (gifBtn) {
    gifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.openGifPicker(gifBtn);
    });
  }

  // sendGif is called by gif-picker.ts when a GIF is selected
  window.sendGif = (url: string, title: string): void => {
    window.sendGifMessage(url, title).catch((err: Error) => {
      log.error("Failed to send GIF", { error: err.message });
    });
  };

  // Wire attachment button → modal
  const attachmentBtn = document.getElementById("attachment-btn");
  const attachmentModal = document.getElementById("attachment-modal");
  const attachmentModalClose = document.getElementById("attachment-modal-close");
  const uploadFileBtn = document.getElementById("upload-file-btn");
  const fileInput = document.getElementById("attachment-file-input") as HTMLInputElement | null;

  attachmentBtn?.addEventListener("click", () => {
    attachmentModal?.classList.remove("hidden");
  });

  attachmentModalClose?.addEventListener("click", () => {
    attachmentModal?.classList.add("hidden");
  });

  attachmentModal?.addEventListener("click", (e) => {
    if (e.target === attachmentModal) attachmentModal.classList.add("hidden");
  });

  uploadFileBtn?.addEventListener("click", () => {
    attachmentModal?.classList.add("hidden");
    fileInput?.click();
  });

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) setPendingAttachment(file);
    fileInput.value = "";
  });

  // Drag-and-drop onto the messages container
  const messagesEl = document.getElementById("messages");
  messagesEl?.addEventListener("dragover", (e) => {
    e.preventDefault();
    messagesEl.classList.add("drag-over");
  });
  messagesEl?.addEventListener("dragleave", (e) => {
    if (!messagesEl.contains(e.relatedTarget as Node)) {
      messagesEl.classList.remove("drag-over");
    }
  });
  messagesEl?.addEventListener("drop", (e) => {
    e.preventDefault();
    messagesEl.classList.remove("drag-over");
    const file = (e as DragEvent).dataTransfer?.files[0];
    if (file) setPendingAttachment(file);
  });

  // ─── Message input ─────────────────────────────────────────────────────────

  if (messageInput) {
    messageInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        if (e.shiftKey) {
          // Allow Shift+Enter to create a new line
          return;
        } else {
          // Prevent default newline behavior and send message
          e.preventDefault();
          const plaintext = messageInput.value.trim();
          if (plaintext || App.pendingAttachment) {
            messageInput.value = "";
            await window.sendEncryptedMessage(App.activeChannelId, plaintext);
          }
        }
      }
    });

    // Paste image from clipboard
    messageInput.addEventListener("paste", (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) setPendingAttachment(file);
          break;
        }
      }
    });

    // Auto-resize textarea based on content
    const autoResize = (): void => {
      if (!messageInput) return;
      messageInput.style.height = "auto";
      messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
    };

    messageInput.addEventListener("input", autoResize);
    messageInput.addEventListener("focus", autoResize);
    messageInput.addEventListener("blur", () => {
      if (messageInput) {
        messageInput.style.height = "auto";
      }
    });

    // Initial resize
    autoResize();
  }

  const reconnectionOverlay = document.getElementById("reconnection-overlay");
  const reconnectionTimer = document.getElementById("reconnection-timer");
  const reconnectionDisconnectBtn = document.getElementById(
    "reconnection-disconnect-btn"
  );

  async function performHealthcheck(): Promise<void> {
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        hostname?: string;
        token?: string;
      } | null;
      if (!auth || !auth.hostname || !auth.token) return;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${auth.hostname}/api/v1/health`, {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        if (
          reconnectionOverlay &&
          !reconnectionOverlay.classList.contains("hidden")
        ) {
          hideReconnectionOverlay();
        }
      } else {
        showReconnectionOverlay();
      }
    } catch (_) {
      showReconnectionOverlay();
    }
  }

  function showReconnectionOverlay(): void {
    if (
      reconnectionOverlay &&
      reconnectionOverlay.classList.contains("hidden")
    ) {
      reconnectionOverlay.classList.remove("hidden");
      App.reconnectionStartTime = Date.now();
      App.reconnectionTimeout = setTimeout(() => {
        forceLogout();
      }, 60000);
      updateReconnectionTimer();
      App.reconnectionTimerInterval = setInterval(updateReconnectionTimer, 100);
    }
  }

  function hideReconnectionOverlay(): void {
    if (reconnectionOverlay) reconnectionOverlay.classList.add("hidden");
    if (App.reconnectionTimeout) {
      clearTimeout(App.reconnectionTimeout);
      App.reconnectionTimeout = null;
    }
    if (App.reconnectionTimerInterval) {
      clearInterval(App.reconnectionTimerInterval);
      App.reconnectionTimerInterval = null;
    }
    App.reconnectionStartTime = null;
  }

  function updateReconnectionTimer(): void {
    if (!App.reconnectionStartTime || !reconnectionTimer) return;
    const elapsed = Date.now() - App.reconnectionStartTime;
    const remaining = Math.max(0, 60 - Math.floor(elapsed / 1000));
    reconnectionTimer.textContent = `Time remaining: ${remaining}s`;
    if (remaining === 0) {
      clearInterval(App.reconnectionTimerInterval!);
      App.reconnectionTimerInterval = null;
    }
  }

  function forceLogout(): void {
    log.info("Force logout initiated, clearing session state");
    hideReconnectionOverlay();
    window.disconnectWebSocket();
    App.emberKeyCache.clear();
    App.ownedMessageIds.clear();
    App.activeChannelId = null;
    if (App.healthcheckInterval) {
      clearInterval(App.healthcheckInterval);
      App.healthcheckInterval = null;
    }
    log.info("Session cleared, sending auth-logout signal");
    ipcRenderer.send("auth-logout");
  }

  reconnectionDisconnectBtn?.addEventListener("click", () => {
    forceLogout();
  });

  App.healthcheckInterval = setInterval(performHealthcheck, 5000);
  performHealthcheck();

  const userInfo = document.getElementById("user-info");
  const userMenu = document.getElementById("user-menu");
  const menuStatus = document.getElementById("menu-status");
  const statusSubmenu = document.getElementById("status-submenu");
  const menuEditProfile = document.getElementById("menu-edit-profile");
  const menuLogout = document.getElementById("menu-logout");
  const userStatusText = document.getElementById("user-status-text");

  if (userInfo && userMenu) {
    userInfo.addEventListener("click", (e) => {
      e.stopPropagation();
      userMenu.classList.toggle("hidden");
      if (statusSubmenu && !userMenu.classList.contains("hidden")) {
        statusSubmenu.classList.add("hidden");
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (userMenu && !userMenu.classList.contains("hidden")) {
      if (
        !userMenu.contains(e.target as Node) &&
        !userInfo?.contains(e.target as Node)
      ) {
        userMenu.classList.add("hidden");
        statusSubmenu?.classList.add("hidden");
      }
    }
  });

  if (menuStatus && statusSubmenu) {
    menuStatus.addEventListener("mouseenter", () => {
      statusSubmenu.classList.remove("hidden");
    });
    menuStatus.addEventListener("mouseleave", (e) => {
      const relatedTarget = (e as MouseEvent).relatedTarget as Node | null;
      if (!statusSubmenu.contains(relatedTarget)) {
        setTimeout(() => {
          if (!statusSubmenu.matches(":hover"))
            statusSubmenu.classList.add("hidden");
        }, 100);
      }
    });
    statusSubmenu.addEventListener("mouseleave", () => {
      statusSubmenu.classList.add("hidden");
    });
    statusSubmenu.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  if (statusSubmenu) {
    const statusOptions = statusSubmenu.querySelectorAll(".status-option");
    statusOptions.forEach((option) => {
      option.addEventListener("click", async () => {
        const displayStatus =
          (option as HTMLElement).getAttribute("data-status") ?? "Online";
        const statusMap: Record<string, string> = {
          Online: "online",
          Idle: "idle",
          "Do Not Disturb": "dnd",
          Invisible: "invisible",
        };
        const apiStatus = statusMap[displayStatus] ?? "online";
        userMenu?.classList.add("hidden");
        statusSubmenu.classList.add("hidden");
        await updateUserStatus(apiStatus, displayStatus);
      });
    });
  }

  async function updateUserStatus(
    apiStatus: string,
    displayStatus: string
  ): Promise<void> {
    log.debug("Updating user status", { status: apiStatus });
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
        user_id?: string;
        username?: string;
      } | null;
      if (!auth || !auth.token || !auth.hostname) return;
      const response = await fetch(`${auth.hostname}/api/v1/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ status: apiStatus }),
      });
      if (response.ok) {
        log.info("User status updated", {
          status: apiStatus,
          user_id: auth.user_id,
        });
        if (userStatusText) userStatusText.textContent = displayStatus;
        updateUserPanelStatusColor(apiStatus);
        window.handlePresenceUpdate({
          user_id: auth.user_id ?? "",
          username: auth.username ?? "",
          status: apiStatus,
        });
      } else {
        log.warn("Failed to update user status", {
          status: String(response.status),
          api_status: apiStatus,
        });
      }
    } catch (error) {
      const err = error as Error;
      log.error("Error updating user status", { error: err.message });
      console.error("Error updating status:", error);
    }
  }

  function updateUserPanelStatusColor(status: string): void {
    const statusEl = document.getElementById("user-status-text");
    if (!statusEl) return;
    statusEl.classList.remove(
      "status-online",
      "status-idle",
      "status-dnd",
      "status-offline"
    );
    const classMap: Record<string, string> = {
      online: "status-online",
      idle: "status-idle",
      dnd: "status-dnd",
      invisible: "status-offline",
      offline: "status-offline",
    };
    statusEl.classList.add(classMap[status] ?? "status-online");
    const iconMap: Record<string, string> = {
      online: "assets/icons/ember_connected.png",
      idle: "assets/icons/ember_idle.gif",
      dnd: "assets/icons/ember_error.png",
      invisible: "assets/icons/ember_disconnected.png",
      offline: "assets/icons/ember_disconnected.png",
    };
    const iconSrc = iconMap[status] ?? "assets/icons/ember_connected.png";
    const userStatusIcon = document.getElementById(
      "user-status-icon"
    ) as HTMLImageElement | null;
    if (userStatusIcon) userStatusIcon.src = iconSrc;
    const menuStatusIcon = document.getElementById(
      "menu-status-icon"
    ) as HTMLImageElement | null;
    if (menuStatusIcon) menuStatusIcon.src = iconSrc;
  }

  menuEditProfile?.addEventListener("click", () => {
    userMenu?.classList.add("hidden");
    window.openSettingsModal("my-account");
  });

  menuLogout?.addEventListener("click", () => {
    userMenu?.classList.add("hidden");
    if (logoutModal) logoutModal.classList.remove("hidden");
  });

  log.info("Ember renderer initialized");

  async function fetchMembers(emberId: string): Promise<Member[]> {
    log.debug("Fetching members", { ember_id: emberId });
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
        user_id?: string;
        avatar?: string;
      } | null;

      if (!auth || !auth.token || !auth.hostname) {
        log.warn("Cannot fetch members: not authenticated");
        return [];
      }

      const url = `${auth.hostname}/api/v1/embers/${emberId}/members`;
      log.debug("Making members API call", { url });

      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      log.debug("Members API response", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        log.warn("Failed to fetch members", { status: response.status, statusText: response.statusText });
        return [];
      }

      const data = await response.json();
      log.debug("Members API response data", {
        memberCount: data.members?.length || 0,
        members: data.members?.map((m: any) => ({ user_id: m.user_id, username: m.username, status: m.status })) || []
      });

      const members: Member[] = data.members || [];
      // Inject the locally-stored avatar for the current user so it shows
      // even when the server DB hasn't been updated yet.
      if (auth.user_id && auth.avatar) {
        for (const m of members) {
          if (m.user_id === auth.user_id && !m.avatar) {
            m.avatar = auth.avatar;
          }
        }
      }
      return members;
    } catch (error) {
      const err = error as Error;
      log.error("Error fetching members", {
        ember_id: emberId,
        error: err.message,
      });
      console.error("Error fetching members:", error);
      return [];
    }
  }

  function renderMemberList(members: Member[]): void {
    const memberList = document.getElementById("member-list");
    if (!memberList) return;
    memberList.innerHTML = "";
    App.currentMembers = members;
    const groups: Record<string, { label: string; members: Member[] }> = {
      online: { label: "ONLINE", members: [] },
      idle: { label: "IDLE", members: [] },
      dnd: { label: "DO NOT DISTURB", members: [] },
      offline: { label: "OFFLINE", members: [] },
    };
    members.forEach((member) => {
      const key =
        member.status === "invisible"
          ? "offline"
          : (member.status ?? "offline");
      (groups[key] ?? groups["offline"]).members.push(member);
    });
    const statusIconMap: Record<string, string> = {
      online: "assets/icons/ember_connected.png",
      idle: "assets/icons/ember_idle.gif",
      dnd: "assets/icons/ember_error.png",
      offline: "assets/icons/ember_disconnected.png",
    };
    (["online", "idle", "dnd", "offline"] as const).forEach((key) => {
      const group = groups[key];
      if (group.members.length === 0) return;
      const categoryEl = document.createElement("div");
      categoryEl.className = "member-category";
      categoryEl.textContent = `${group.label} — ${group.members.length}`;
      memberList.appendChild(categoryEl);
      group.members.forEach((member) => {
        const memberEl = document.createElement("div");
        memberEl.className = "member";
        memberEl.dataset["userId"] = member.user_id;
        if (key === "offline") memberEl.classList.add("offline");
        const statusClass = key === "dnd" ? "dnd" : key;
        const iconSrc = statusIconMap[key] ?? "assets/icons/ember_disconnected.png";

        const avatarEl = document.createElement("div");
        avatarEl.className = `member-avatar ${statusClass}`;
        if (member.avatar) {
          const img = document.createElement("img");
          img.src = member.avatar;
          img.alt = member.username ?? "avatar";
          img.style.cssText = "width:100%;height:100%;object-fit:cover;";
          avatarEl.appendChild(img);
        } else {
          avatarEl.textContent = (member.username ?? "?").charAt(0).toUpperCase();
        }
        const statusIcon = document.createElement("img");
        statusIcon.className = "status-icon";
        statusIcon.src = iconSrc;
        statusIcon.alt = key;
        avatarEl.appendChild(statusIcon);

        const nameEl = document.createElement("span");
        nameEl.className = "member-name";
        nameEl.textContent = member.username ?? "Unknown";

        memberEl.appendChild(avatarEl);
        memberEl.appendChild(nameEl);
        memberList.appendChild(memberEl);
      });
    });
  }

  function updateChatHeader(channelName: string, description: string): void {
    const chatHeader = document.querySelector(".chat-header");
    if (!chatHeader) return;
    const channelTitle = chatHeader.querySelector(".channel-title");
    const channelDesc = chatHeader.querySelector(".channel-description");
    if (channelTitle) channelTitle.textContent = channelName;
    if (channelDesc) channelDesc.textContent = description ?? "";
  }

  function hideWelcomeScreen(): void {
    const welcomeScreen = document.getElementById("welcome-screen");
    const chatContainer = document.getElementById("chat-container");
    const memberList = document.getElementById("member-list");
    const channels = document.querySelector(".channels") as HTMLElement | null;
    const serverHeader = document.querySelector(
      ".server-header"
    ) as HTMLElement | null;
    welcomeScreen?.classList.add("hidden");
    if (chatContainer) chatContainer.style.display = "";
    if (memberList) (memberList as HTMLElement).style.display = "";
    if (channels) channels.style.display = "";
    if (serverHeader) serverHeader.style.display = "";
  }

  function showWelcomeScreen(): void {
    const welcomeScreen = document.getElementById("welcome-screen");
    const chatContainer = document.getElementById("chat-container");
    const memberList = document.getElementById("member-list");
    const channels = document.querySelector(".channels") as HTMLElement | null;
    const serverHeader = document.querySelector(
      ".server-header"
    ) as HTMLElement | null;
    welcomeScreen?.classList.remove("hidden");
    if (chatContainer) chatContainer.style.display = "none";
    if (memberList) (memberList as HTMLElement).style.display = "none";
    if (channels) channels.style.display = "none";
    if (serverHeader) serverHeader.style.display = "none";
  }

  async function verifyUserExists(): Promise<boolean> {
    log.debug("Verifying user session via /me endpoint");
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
        user_id?: string;
        username?: string;
      } | null;
      if (!auth || !auth.token || !auth.hostname) {
        log.warn("Session verification failed: no auth data in store");
        forceLogout();
        return false;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${auth.hostname}/api/v1/me`, {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        log.warn("Session verification failed: server rejected token", {
          status: String(response.status),
        });
        forceLogout();
        return false;
      }
      log.info("Session verified", {
        user_id: auth.user_id,
        username: auth.username,
      });
      return true;
    } catch (error) {
      const err = error as Error;
      log.error("User verification error", { error: err.message });
      console.error("User verification failed:", error);
      forceLogout();
      return false;
    }
  }

  async function initializeApp(): Promise<void> {
    log.info("Initializing application");
    const isValid = await verifyUserExists();
    if (!isValid) return;
    const auth = (await ipcRenderer.invoke("get-auth")) as {
      username?: string;
      avatar?: string;
      token?: string;
      hostname?: string;
      user_id?: string;
    } | null;
    if (auth?.username) {
      const usernameEl = document.querySelector(".user-panel .username");
      if (usernameEl) usernameEl.textContent = auth.username;

      // Use stored avatar, or fetch from server if missing
      let avatarData = auth.avatar || "";
      if (!avatarData && auth.token && auth.hostname) {
        try {
          const resp = await fetch(`${auth.hostname}/api/v1/me`, {
            headers: { Authorization: `Bearer ${auth.token}` },
          });
          if (resp.ok) {
            const profile = (await resp.json()) as { avatar?: string; username?: string };
            if (profile.avatar) {
              avatarData = profile.avatar;
              // Persist to local store so subsequent launches are instant
              await ipcRenderer.invoke("save-auth", {
                ...auth,
                avatar: avatarData,
                username: profile.username || auth.username,
              });
              log.info("Avatar fetched from server and cached locally");
            }
          }
        } catch (e) {
          log.warn("Failed to fetch profile from server", { error: String(e) });
        }
      }

      if (avatarData) {
        const panelAvatar = document.querySelector(".user-panel .user-avatar") as HTMLElement | null;
        if (panelAvatar) {
          const img = document.createElement("img");
          img.src = avatarData;
          img.alt = "avatar";
          img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:0;";
          panelAvatar.textContent = "";
          panelAvatar.appendChild(img);
        }
      }
      log.info("User panel populated", { username: auth.username });
    }
    
    // Initialize Direct Messaging UI
    try {
      await window.initializeDirectMessagingUI();
      log.info("Direct Messaging UI initialized");
    } catch (error) {
      log.error("Failed to initialize Direct Messaging UI", { error });
    }
    
    // Initialize Direct Messaging system
    try {
      await window.initializeDirectMessaging();
      log.info("Direct Messaging system initialized");
    } catch (error) {
      log.error("Failed to initialize Direct Messaging system", { error });
    }
    const embers = await window.fetchEmbers();
    if (embers.length > 0) {
      log.info("Rendering server list", { count: String(embers.length) });
      hideWelcomeScreen();
      window.renderServerList(embers);
    } else {
      log.info("No embers found, showing welcome screen");
      showWelcomeScreen();
    }
  }

  async function initializeAppWithWS(): Promise<void> {
    log.info("Starting application initialization with WebSocket");
    await initializeApp();
    log.debug("App initialized, connecting WebSocket");
    await window.connectWebSocket();
    log.info("Application startup complete");
  }

  window.fetchMembers = fetchMembers;
  window.renderMemberList = renderMemberList;
  window.updateChatHeader = updateChatHeader;
  window.hideWelcomeScreen = hideWelcomeScreen;
  window.showWelcomeScreen = showWelcomeScreen;

  initializeAppWithWS();
  });
})();
