/**
 * Renderer manager — TypeScript conversion of public/src/js/renderer.js.
 * Application entry point: initializes the UI, health checks, and WebSocket.
 */
(function (): void {
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger("Renderer");
  const App = window.App;

  const messageInput = document.getElementById(
    "messageInput"
  ) as HTMLTextAreaElement | null;

  document.getElementById("minimize-btn")?.addEventListener("click", () => {
    ipcRenderer.send("window-minimize");
  });

  document.getElementById("maximize-btn")?.addEventListener("click", () => {
    ipcRenderer.send("window-maximize");
  });

  document.getElementById("close-btn")?.addEventListener("click", () => {
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
    
    // Hide main content but keep server list visible
    const appContainer = document.querySelector(".app-container");
    if (appContainer) {
      const channelList = appContainer.querySelector(".channel-list");
      const chatContainer = appContainer.querySelector(".chat-container");
      const memberList = appContainer.querySelector(".member-list");
      const welcomeScreen = appContainer.querySelector(".welcome-screen");
      
      if (channelList) (channelList as HTMLElement).style.display = "none";
      if (chatContainer) (chatContainer as HTMLElement).style.display = "none";
      if (memberList) (memberList as HTMLElement).style.display = "none";
      if (welcomeScreen) (welcomeScreen as HTMLElement).style.display = "none";
    }
    
    // Focus on search input
    setTimeout(() => {
      const searchInput = document.getElementById("dm-search-input");
      if (searchInput) {
        (searchInput as HTMLInputElement).focus();
      }
    }, 100);
    
    log.info("DM Screen opened");
  }
  
  function closeDMScreen() {
    dmScreen!.classList.remove("active");
    dmIcon!.classList.remove("active");
    
    // Show main content again
    const appContainer = document.querySelector(".app-container");
    if (appContainer) {
      const channelList = appContainer.querySelector(".channel-list");
      const chatContainer = appContainer.querySelector(".chat-container");
      const memberList = appContainer.querySelector(".member-list");
      const welcomeScreen = appContainer.querySelector(".welcome-screen");
      
      if (channelList) (channelList as HTMLElement).style.display = "";
      if (chatContainer) (chatContainer as HTMLElement).style.display = "";
      if (memberList) (memberList as HTMLElement).style.display = "";
      if (welcomeScreen) (welcomeScreen as HTMLElement).style.display = "";
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
          if (plaintext) {
            messageInput.value = "";
            await window.sendEncryptedMessage(plaintext);
          }
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
      online: "Icons/ember_connected.png",
      idle: "Icons/ember_idle.gif",
      dnd: "Icons/ember_error.png",
      invisible: "Icons/ember_disconnected.png",
      offline: "Icons/ember_disconnected.png",
    };
    const iconSrc = iconMap[status] ?? "Icons/ember_connected.png";
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
      } | null;
      if (!auth || !auth.token || !auth.hostname) return [];
      const response = await fetch(
        `${auth.hostname}/api/v1/embers/${emberId}/members`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${auth.token}` },
        }
      );
      if (!response.ok) {
        log.error("Failed to fetch members", {
          status: String(response.status),
          ember_id: emberId,
        });
        return [];
      }
      const data = (await response.json()) as { members?: Member[] };
      const members = data.members ?? [];
      log.debug("Members fetched", {
        ember_id: emberId,
        count: String(members.length),
      });
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
      online: "Icons/ember_connected.png",
      idle: "Icons/ember_idle.gif",
      dnd: "Icons/ember_error.png",
      offline: "Icons/ember_disconnected.png",
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
        const iconSrc = statusIconMap[key] ?? "Icons/ember_disconnected.png";
        memberEl.innerHTML = `
        <div class="member-avatar ${statusClass}">
          ${window.escapeHtml((member.username ?? "?").charAt(0).toUpperCase())}
          <img class="status-icon" src="${iconSrc}" alt="${key}">
        </div>
        <span class="member-name">${window.escapeHtml(member.username ?? "Unknown")}</span>
      `;
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
    } | null;
    if (auth?.username) {
      const usernameEl = document.querySelector(".user-panel .username");
      if (usernameEl) usernameEl.textContent = auth.username;
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
})();
