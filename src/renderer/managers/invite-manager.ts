/**
 * Invite manager — TypeScript conversion of public/invite-manager.js.
 * Handles invite creation, deep link processing, and the accept-invite modal.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger("InviteManager");
  const emberCrypto = window.electronAPI.crypto;
  const naclUtil = window.electronAPI.naclUtil;

  // Setup IPC listener immediately to avoid missing messages
  log.debug("Setting up IPC listener for handle-invite-link");
  ipcRenderer.on(
    "handle-invite-link",
    () => {
      log.info("Received invite link notification from main process");
      // Get the pending invite data via invoke to work around context bridge issues
      handleInviteNotification();
    }
  );
  log.debug("IPC listener setup complete");

  async function handleInviteNotification(): Promise<void> {
    try {
      log.debug("Getting pending invite data...");
      const invite = await ipcRenderer.invoke("get-pending-invite") as { code: string; hostname: string | null } | null;
      if (!invite) {
        log.error("No pending invite data found!");
        return;
      }
      log.debug("Retrieved pending invite:", { code: invite.code, hostname: invite.hostname });
      processInviteLink(invite.code, invite.hostname);
    } catch (error) {
      const err = error as Error;
      log.error("Error handling invite notification:", { error: err.message });
    }
  }

  // ─── Join Server Modal ─────────────────────────────────────────────────────

  function getJoinServerModal(): HTMLElement | null {
    return document.getElementById("join-server-modal");
  }

  function getJoinInviteInput(): HTMLInputElement | null {
    return document.getElementById("join-invite-input") as HTMLInputElement | null;
  }

  function getJoinServerBtn(): HTMLButtonElement | null {
    return document.getElementById("join-server-btn") as HTMLButtonElement | null;
  }

  function getJoinServerCancelBtn(): HTMLElement | null {
    return document.getElementById("join-server-cancel-btn");
  }

  function getJoinServerError(): HTMLElement | null {
    return document.getElementById("join-server-error");
  }

  function openJoinServerModal(): void {
    const joinServerModal = getJoinServerModal();
    const joinInviteInput = getJoinInviteInput();
    const joinServerError = getJoinServerError();
    const joinServerBtn = getJoinServerBtn();
    
    if (!joinServerModal) return;
    if (joinInviteInput) joinInviteInput.value = "";
    if (joinServerError) joinServerError.classList.add("hidden");
    if (joinServerBtn) {
      joinServerBtn.disabled = false;
      joinServerBtn.textContent = "Join";
    }
    joinServerModal.classList.remove("hidden");
    joinInviteInput?.focus();
  }

  function closeJoinServerModal(): void {
    const joinServerModal = getJoinServerModal();
    joinServerModal?.classList.add("hidden");
  }

  function showJoinServerError(message: string): void {
    const joinServerError = getJoinServerError();
    if (joinServerError) {
      joinServerError.textContent = message;
      joinServerError.classList.remove("hidden");
    }
  }

  // Setup event listeners when DOM is ready
  function setupJoinServerEventListeners(): void {
    const joinServerCancelBtn = getJoinServerCancelBtn();
    const joinServerModal = getJoinServerModal();
    
    joinServerCancelBtn?.addEventListener("click", closeJoinServerModal);
    joinServerModal?.addEventListener("click", (e: Event) => {
      if (e.target === joinServerModal) closeJoinServerModal();
    });
  }

  interface ParsedInvite {
    code: string;
    hostname: string | null;
  }

  function parseInviteInput(input: string): ParsedInvite | null {
    const trimmed = input.trim();
    const urlMatch = trimmed.match(/\/invite\/([A-Za-z0-9]+)\/?$/);
    if (urlMatch) {
      try {
        const url = new URL(trimmed);
        return { code: urlMatch[1], hostname: url.origin };
      } catch (_) {
        return { code: urlMatch[1], hostname: null };
      }
    }
    const codeMatch = trimmed.match(/^[A-Za-z0-9]+$/);
    if (codeMatch) return { code: trimmed, hostname: null };
    return null;
  }

  getJoinServerBtn()?.addEventListener("click", async () => {
    const joinInviteInput = getJoinInviteInput();
    const joinServerBtn = getJoinServerBtn();
    const value = joinInviteInput ? joinInviteInput.value : "";
    if (!value.trim()) {
      showJoinServerError("Please enter an invite link or code");
      return;
    }
    const parsed = parseInviteInput(value);
    if (!parsed) {
      showJoinServerError("Invalid invite link or code");
      return;
    }
    if (joinServerBtn) {
      joinServerBtn.disabled = true;
      joinServerBtn.textContent = "Loading...";
    }
    closeJoinServerModal();
    await processInviteLink(parsed.code, parsed.hostname);
  });

  getJoinInviteInput()?.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") getJoinServerBtn()?.click();
  });

  // ─── Server Header Dropdown ────────────────────────────────────────────────

  const serverHeader = document.getElementById("server-header");
  const serverHeaderMenu = document.getElementById("server-header-menu");
  const invitePeopleBtn = document.getElementById("invite-people-btn");

  if (serverHeader && serverHeaderMenu) {
    serverHeader.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      serverHeaderMenu.classList.toggle("hidden");
    });
    document.addEventListener("click", (e: Event) => {
      if (
        !serverHeaderMenu.classList.contains("hidden") &&
        !serverHeaderMenu.contains(e.target as Node)
      ) {
        serverHeaderMenu.classList.add("hidden");
      }
    });
  }

  // ─── Create Invite Modal ───────────────────────────────────────────────────

  function getCreateInviteModal(): HTMLElement | null {
    return document.getElementById("create-invite-modal");
  }

  function getCreateInviteBtn(): HTMLButtonElement | null {
    return document.getElementById("create-invite-btn") as HTMLButtonElement | null;
  }

  function getCreateInviteCancelBtn(): HTMLElement | null {
    return document.getElementById("create-invite-cancel-btn");
  }

  function getInviteExpirationSelect(): HTMLSelectElement | null {
    return document.getElementById("invite-expiration") as HTMLSelectElement | null;
  }

  function getInviteMaxUsesSelect(): HTMLSelectElement | null {
    return document.getElementById("invite-max-uses") as HTMLSelectElement | null;
  }

  function getInviteLinkResult(): HTMLElement | null {
    return document.getElementById("invite-link-result");
  }

  function getInviteLinkInput(): HTMLInputElement | null {
    return document.getElementById("invite-link-input") as HTMLInputElement | null;
  }

  function getInviteCopyBtn(): HTMLButtonElement | null {
    return document.getElementById("invite-copy-btn") as HTMLButtonElement | null;
  }

  function getCreateInviteError(): HTMLElement | null {
    return document.getElementById("create-invite-error");
  }

  invitePeopleBtn?.addEventListener("click", () => {
    serverHeaderMenu?.classList.add("hidden");
    openCreateInviteModal();
  });

  function openCreateInviteModal(): void {
    const createInviteModal = getCreateInviteModal();
    if (!createInviteModal) return;
    resetCreateInviteForm();
    createInviteModal.classList.remove("hidden");
  }

  function closeCreateInviteModal(): void {
    const createInviteModal = getCreateInviteModal();
    createInviteModal?.classList.add("hidden");
    resetCreateInviteForm();
  }

  function resetCreateInviteForm(): void {
    const inviteExpirationSelect = getInviteExpirationSelect();
    const inviteMaxUsesSelect = getInviteMaxUsesSelect();
    const inviteLinkResult = getInviteLinkResult();
    const inviteLinkInput = getInviteLinkInput();
    const createInviteBtn = getCreateInviteBtn();
    
    if (inviteExpirationSelect) inviteExpirationSelect.value = "86400";
    if (inviteMaxUsesSelect) inviteMaxUsesSelect.value = "0";
    inviteLinkResult?.classList.add("hidden");
    if (inviteLinkInput) inviteLinkInput.value = "";
    if (createInviteBtn) {
      createInviteBtn.disabled = false;
      createInviteBtn.textContent = "Generate Link";
    }
    hideCreateInviteError();
  }

  function showCreateInviteError(message: string): void {
    const createInviteError = getCreateInviteError();
    if (createInviteError) {
      createInviteError.textContent = message;
      createInviteError.classList.remove("hidden");
    }
  }

  function hideCreateInviteError(): void {
    const createInviteError = getCreateInviteError();
    createInviteError?.classList.add("hidden");
  }

  // Setup event listeners for create invite modal
  function setupCreateInviteEventListeners(): void {
    const createInviteCancelBtn = getCreateInviteCancelBtn();
    const createInviteModal = getCreateInviteModal();
    const createInviteBtn = getCreateInviteBtn();
    const inviteCopyBtn = getInviteCopyBtn();
    
    createInviteCancelBtn?.addEventListener("click", closeCreateInviteModal);
    createInviteModal?.addEventListener("click", (e: Event) => {
      if (e.target === createInviteModal) closeCreateInviteModal();
    });
    createInviteBtn?.addEventListener("click", async () => {
      await handleCreateInvite();
    });
    
    inviteCopyBtn?.addEventListener("click", () => {
      const inviteLinkInput = getInviteLinkInput();
      if (inviteLinkInput?.value) {
        navigator.clipboard.writeText(inviteLinkInput.value).then(() => {
          const inviteCopyBtn = getInviteCopyBtn();
          if (inviteCopyBtn) {
            inviteCopyBtn.textContent = "Copied!";
            setTimeout(() => {
              const btn = getInviteCopyBtn();
              if (btn) btn.textContent = "Copy";
            }, 2000);
          }
        });
      }
    });
  }

  async function handleCreateInvite(): Promise<void> {
    if (!App.activeEmberId) {
      log.warn("Cannot create invite: no active ember");
      showCreateInviteError("No server selected");
      return;
    }
    const emberKey = App.emberKeyCache.get(App.activeEmberId);
    if (!emberKey) {
      log.error("Cannot create invite: ember key not in cache", {
        ember_id: App.activeEmberId,
      });
      showCreateInviteError("Ember key not available");
      return;
    }

    log.info("Creating invite", { ember_id: App.activeEmberId });
    try {
      const createInviteBtn = getCreateInviteBtn();
      if (createInviteBtn) {
        createInviteBtn.disabled = true;
        createInviteBtn.textContent = "Generating...";
      }
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
      } | null;
      if (!auth || !auth.token || !auth.hostname) {
        showCreateInviteError("Not authenticated");
        return;
      }

      const inviteExpirationSelect = getInviteExpirationSelect();
      const inviteMaxUsesSelect = getInviteMaxUsesSelect();
      const expiresIn = parseInt(inviteExpirationSelect?.value ?? "0") || 0;
      const maxUses = parseInt(inviteMaxUsesSelect?.value ?? "0") || 0;
      const inviteCode = Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const inviteKeyData = await emberCrypto.encryptEmberKeyForInvite(
        emberKey,
        inviteCode
      );
      const requestBody: Record<string, unknown> = {
        code: inviteCode,
        encrypted_ember_key: inviteKeyData.encrypted,
        key_salt: inviteKeyData.salt,
      };
      if (expiresIn > 0) requestBody["expires_in"] = expiresIn;
      if (maxUses > 0) requestBody["max_uses"] = maxUses;

      const response = await fetch(
        `${auth.hostname}/api/v1/embers/${App.activeEmberId}/invites`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify(requestBody),
        }
      );
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errorData.error ?? "Failed to create invite");
      }
      const data = (await response.json()) as { invite_url?: string };
      const inviteLinkInput = getInviteLinkInput();
      const inviteLinkResult = getInviteLinkResult();
      if (inviteLinkInput) inviteLinkInput.value = data.invite_url ?? "";
      inviteLinkResult?.classList.remove("hidden");
      log.info("Invite created successfully", { ember_id: App.activeEmberId });
    } catch (error) {
      const err = error as Error;
      log.error("Failed to create invite", {
        ember_id: App.activeEmberId ?? "",
        error: err.message,
      });
      showCreateInviteError(err.message || "Failed to create invite");
    } finally {
      const createInviteBtn = getCreateInviteBtn();
      if (createInviteBtn) {
        createInviteBtn.disabled = false;
        createInviteBtn.textContent = "Generate Link";
      }
    }
  }

  // ─── Accept Invite Modal ───────────────────────────────────────────────────

  function getAcceptInviteModal(): HTMLElement | null {
    return document.getElementById("accept-invite-modal");
  }

  function getAcceptInviteCancelBtn(): HTMLElement | null {
    return document.getElementById("accept-invite-cancel-btn");
  }

  function getAcceptInviteJoinBtn(): HTMLButtonElement | null {
    return document.getElementById("accept-invite-join-btn") as HTMLButtonElement | null;
  }

  function getAcceptInviteIcon(): HTMLElement | null {
    return document.getElementById("accept-invite-icon");
  }

  function getAcceptInviteName(): HTMLElement | null {
    return document.getElementById("accept-invite-name");
  }

  function getAcceptInviteMembers(): HTMLElement | null {
    return document.getElementById("accept-invite-members");
  }

  function getAcceptInviteError(): HTMLElement | null {
    return document.getElementById("accept-invite-error");
  }

  interface InviteInfo {
    ember_name?: string;
    ember_icon?: string;
    member_count?: number;
    encrypted_ember_key: string;
    code: string;
    key_salt: string;
    hostname?: string;
  }

  function openAcceptInviteModal(inviteInfo: Record<string, unknown>): void {
    log.debug("openAcceptInviteModal called");
    const acceptInviteModal = getAcceptInviteModal();
    log.debug("acceptInviteModal element found:", { found: !!acceptInviteModal });
    if (!acceptInviteModal) {
      log.error("acceptInviteModal element not found!");
      return;
    }
    App.pendingInvite = inviteInfo;
    const info = inviteInfo as unknown as InviteInfo;

    const acceptInviteIcon = getAcceptInviteIcon();
    const acceptInviteName = getAcceptInviteName();
    const acceptInviteMembers = getAcceptInviteMembers();
    const acceptInviteError = getAcceptInviteError();
    const acceptInviteJoinBtn = getAcceptInviteJoinBtn();

    log.debug("Populating modal with invite info...");
    if (acceptInviteIcon) {
      while (acceptInviteIcon.firstChild)
        acceptInviteIcon.removeChild(acceptInviteIcon.firstChild);
      if (info.ember_icon) {
        const img = document.createElement("img");
        img.src = info.ember_icon;
        img.alt = "icon";
        Object.assign(img.style, {
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: "50%",
        });
        acceptInviteIcon.appendChild(img);
      } else {
        acceptInviteIcon.textContent = (info.ember_name ?? "?")
          .charAt(0)
          .toUpperCase();
      }
    }
    if (acceptInviteName)
      acceptInviteName.textContent = info.ember_name ?? "Unknown Server";
    if (acceptInviteMembers)
      acceptInviteMembers.textContent = `${info.member_count ?? 0} members`;
    acceptInviteError?.classList.add("hidden");
    if (acceptInviteJoinBtn) {
      acceptInviteJoinBtn.disabled = false;
      acceptInviteJoinBtn.textContent = "Join Server";
    }
    log.debug("Removing hidden class from modal...");
    acceptInviteModal.classList.remove("hidden");
    log.debug("Modal should now be visible");
  }

  function closeAcceptInviteModal(): void {
    const acceptInviteModal = getAcceptInviteModal();
    acceptInviteModal?.classList.add("hidden");
    App.pendingInvite = null;
  }

  function showAcceptInviteError(message: string): void {
    const acceptInviteError = getAcceptInviteError();
    if (acceptInviteError) {
      acceptInviteError.textContent = message;
      acceptInviteError.classList.remove("hidden");
    }
  }

  // Setup event listeners for accept invite modal
  function setupAcceptInviteEventListeners(): void {
    const acceptInviteCancelBtn = getAcceptInviteCancelBtn();
    const acceptInviteModal = getAcceptInviteModal();
    const acceptInviteJoinBtn = getAcceptInviteJoinBtn();
    
    acceptInviteCancelBtn?.addEventListener("click", closeAcceptInviteModal);
    acceptInviteModal?.addEventListener("click", (e: Event) => {
      if (e.target === acceptInviteModal) closeAcceptInviteModal();
    });
    acceptInviteJoinBtn?.addEventListener("click", async () => {
      await handleAcceptInvite();
    });
  }

  async function handleAcceptInvite(): Promise<void> {
    if (!App.pendingInvite) return;
    log.info("Accepting invite");
    try {
      const acceptInviteJoinBtn = getAcceptInviteJoinBtn();
      if (acceptInviteJoinBtn) {
        acceptInviteJoinBtn.disabled = true;
        acceptInviteJoinBtn.textContent = "Joining...";
      }
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
      } | null;
      const device = (await ipcRenderer.invoke("get-device-identity")) as {
        public_key?: string;
        private_key?: string;
      } | null;
      if (!auth || !auth.token || !device) {
        showAcceptInviteError("Not authenticated");
        return;
      }

      const info = App.pendingInvite as unknown as InviteInfo;
      const hostname = info.hostname ?? auth.hostname;
      const emberKey = await emberCrypto.decryptEmberKeyFromInvite(
        info.encrypted_ember_key,
        info.code,
        info.key_salt
      );
      if (!emberKey) {
        log.error("Failed to decrypt ember key from invite");
        showAcceptInviteError("Failed to decrypt ember key from invite");
        return;
      }

      log.debug("Ember key decrypted from invite successfully");
      const publicKeyBytes = naclUtil.decodeBase64(device.public_key!);
      const privateKeyBytes = naclUtil.decodeBase64(device.private_key!);
      const encryptedEmberKey = emberCrypto.encryptEmberKeyForUser(
        emberKey,
        publicKeyBytes,
        privateKeyBytes
      );

      const response = await fetch(
        `${hostname}/api/v1/invites/${info.code}/accept`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ encrypted_ember_key: encryptedEmberKey }),
        }
      );
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errorData.error ?? "Failed to join server");
      }
      const data = (await response.json()) as {
        ember_id?: string;
        ember_name?: string;
      };
      if (data.ember_id) {
        App.emberKeyCache.set(data.ember_id, emberKey);
        log.info("Joined server via invite", {
          ember_id: data.ember_id,
          name: data.ember_name ?? "",
        });
      }
      closeAcceptInviteModal();
      window.hideWelcomeScreen();
      const embers = await window.fetchEmbers();
      window.renderServerList(embers);
      if (data.ember_id)
        window.switchToServer(data.ember_id, data.ember_name ?? "");
    } catch (error) {
      const err = error as Error;
      log.error("Failed to accept invite", { error: err.message });
      showAcceptInviteError(err.message || "Failed to join server");
    } finally {
      const acceptInviteJoinBtn = getAcceptInviteJoinBtn();
      if (acceptInviteJoinBtn) {
        acceptInviteJoinBtn.disabled = false;
        acceptInviteJoinBtn.textContent = "Join Server";
      }
    }
  }

  async function processInviteLink(
    code: string,
    hostname: string | null
  ): Promise<void> {
    log.info("Processing invite link", { code, hostname });
    try {
      log.debug("Getting auth data...");
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
      } | null;
      log.debug("Auth data retrieved:", { hasAuth: !!auth, hasToken: !!auth?.token });
      if (!auth || !auth.token) {
        log.error("Cannot process invite link: not authenticated");
        return;
      }
      const targetHostname = hostname ?? auth.hostname!;
      log.debug("Making request to:", { targetHostname, code });
      const response = await fetch(`${targetHostname}/api/v1/invites/${code}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      log.debug("Response received:", { status: response.status, ok: response.ok });
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        log.error("Failed to fetch invite info", { status: response.status });
        console.error(
          "Failed to fetch invite info:",
          errorData.error ?? response.status
        );
        return;
      }
      const inviteInfo = (await response.json()) as Record<string, unknown>;
      inviteInfo["hostname"] = targetHostname;
      log.info("Invite info retrieved, opening accept modal", {
        ember_name: String(inviteInfo["ember_name"] ?? ""),
      });
      log.debug("Calling openAcceptInviteModal...");
      openAcceptInviteModal(inviteInfo);
      log.debug("openAcceptInviteModal called");
    } catch (error) {
      const err = error as Error;
      log.error("Error processing invite link", { error: err.message });
    }
  }

  window.openJoinServerModal = openJoinServerModal;
  window.closeJoinServerModal = closeJoinServerModal;
  window.openCreateInviteModal = openCreateInviteModal;
  window.closeCreateInviteModal = closeCreateInviteModal;
  window.openAcceptInviteModal = openAcceptInviteModal;
  window.closeAcceptInviteModal = closeAcceptInviteModal;
  window.processInviteLink = processInviteLink;

  // Setup event listeners when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupJoinServerEventListeners();
      setupCreateInviteEventListeners();
      setupAcceptInviteEventListeners();
    });
  } else {
    // DOM is already ready
    setupJoinServerEventListeners();
    setupCreateInviteEventListeners();
    setupAcceptInviteEventListeners();
  }
})();
