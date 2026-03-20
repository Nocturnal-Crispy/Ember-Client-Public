/**
 * Ember manager — TypeScript conversion of public/ember-manager.js.
 * Handles ember fetch, server list rendering, server creation, and ember key management.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger("EmberManager");
  const emberCrypto = window.electronAPI.crypto;

  function decodeBase64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // ─── Sender Key Distribution Management ──────────────────────────────────

  const senderKeyDistributionIds = new Map<string, string>();

  async function loadOrCreateDistributionId(emberId: string): Promise<string> {
    const cached = senderKeyDistributionIds.get(emberId);
    if (cached) return cached;
    const response = await window.emberAPI.invoke<{ distribution_id: string | null }>(
      "LoadDistributionId",
      { address: emberId }
    );
    if (response.success && response.data?.distribution_id) {
      senderKeyDistributionIds.set(emberId, response.data.distribution_id);
      return response.data.distribution_id;
    }
    const distributionId = crypto.randomUUID();
    await window.emberAPI.invoke("StoreDistributionId", {
      address: emberId,
      distributionId,
    });
    senderKeyDistributionIds.set(emberId, distributionId);
    log.info("Generated distribution ID", { ember_id: emberId });
    return distributionId;
  }

  async function createSenderKeyForEmber(
    emberId: string
  ): Promise<{ distributionId: string; distributionMessage: string }> {
    const distributionId = await loadOrCreateDistributionId(emberId);
    const response = await window.emberAPI.invoke<{ distributionMessage: string }>(
      "CreateSenderKeyDistribution",
      { distributionId }
    );
    if (!response.success || !response.data?.distributionMessage) {
      throw new Error("Failed to create sender key distribution");
    }
    return {
      distributionId,
      distributionMessage: response.data.distributionMessage,
    };
  }

  async function ensureSignalSession(
    auth: AuthData,
    userId: string,
    deviceId: string
  ): Promise<void> {
    const address = `${userId}.${deviceId}`;
    const sessionResponse = await window.emberAPI.invoke<{ record: string | null }>(
      "LoadSession",
      { address }
    );
    if (sessionResponse.success && sessionResponse.data?.record) return;
    const bundleResponse = await fetch(
      `${auth.hostname}/api/v1/users/${userId}/devices/${deviceId}/prekey-bundle`,
      { headers: { Authorization: `Bearer ${auth.token}` } }
    );
    if (!bundleResponse.ok) {
      throw new Error(`Failed to fetch pre-key bundle for ${address}`);
    }
    const bundle = (await bundleResponse.json()) as Record<string, unknown>;
    await window.emberAPI.invoke("ProcessPreKeyBundle", {
      recipientAddress: address,
      registrationId: bundle["registration_id"],
      deviceId: Number(bundle["device_id"]),
      preKeyId: bundle["prekey_id"] ?? undefined,
      preKey: bundle["prekey_public"] ?? undefined,
      signedPreKeyId: bundle["signed_prekey_id"],
      signedPreKey: bundle["signed_prekey_public"],
      signedPreKeySignature: bundle["signed_prekey_signature"],
      identityKey: bundle["identity_key"],
    });
    log.info("Signal session established", { address });
  }

  async function distributeSenderKeyToMembers(emberId: string): Promise<void> {
    try {
      const auth = await window.getValidAuth();
      if (!auth) return;
      const { distributionMessage } = await createSenderKeyForEmber(emberId);
      const membersResponse = await fetch(
        `${auth.hostname}/api/v1/embers/${emberId}/device-members`,
        { headers: { Authorization: `Bearer ${auth.token}` } }
      );
      if (!membersResponse.ok) {
        log.warn("Failed to fetch device members", { ember_id: emberId });
        return;
      }
      const membersData = (await membersResponse.json()) as {
        members: Array<{ user_id: string; device_id: string }>;
      };
      const members = membersData.members ?? [];
      if (members.length === 0) return;
      const distributions: Array<{
        recipient_user_id: string;
        recipient_device_id: string;
        distribution_message: string;
      }> = [];
      for (const member of members) {
        try {
          await ensureSignalSession(auth, member.user_id, member.device_id);
          const address = `${member.user_id}.${member.device_id}`;
          const encResponse = await window.emberAPI.invoke<{
            ciphertext: string;
            messageType: number;
          }>("Encrypt", {
            recipientAddress: address,
            plaintext: distributionMessage,
          });
          if (!encResponse.success || !encResponse.data) {
            log.warn("Failed to encrypt distribution", { recipient: address });
            continue;
          }
          const envelope = JSON.stringify({
            ct: encResponse.data.ciphertext,
            mt: encResponse.data.messageType,
          });
          distributions.push({
            recipient_user_id: member.user_id,
            recipient_device_id: member.device_id,
            distribution_message: btoa(envelope),
          });
        } catch (memberErr) {
          const err = memberErr as Error;
          log.warn("Skipping member for distribution", {
            user_id: member.user_id,
            error: err.message,
          });
        }
      }
      if (distributions.length > 0) {
        await fetch(
          `${auth.hostname}/api/v1/embers/${emberId}/sender-key-distributions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${auth.token}`,
            },
            body: JSON.stringify({ distributions }),
          }
        );
        log.info("Sender key distributed", {
          ember_id: emberId,
          count: distributions.length,
        });
      }
    } catch (error) {
      const err = error as Error;
      log.error("Failed to distribute sender key", {
        ember_id: emberId,
        error: err.message,
      });
    }
  }

  async function processIncomingSenderKeyDistributions(): Promise<void> {
    try {
      const auth = await window.getValidAuth();
      if (!auth) return;
      const response = await fetch(
        `${auth.hostname}/api/v1/sender-key-distributions/pending`,
        { headers: { Authorization: `Bearer ${auth.token}` } }
      );
      if (!response.ok) return;
      const data = (await response.json()) as {
        distributions: Array<{
          id: string;
          sender_user_id: string;
          sender_device_id: string;
          distribution_message: string;
        }>;
      };
      const pending = data.distributions ?? [];
      if (pending.length === 0) return;
      let processed = 0;
      for (const dist of pending) {
        try {
          const senderAddress = `${dist.sender_user_id}.${dist.sender_device_id}`;
          const envelope = JSON.parse(atob(dist.distribution_message)) as {
            ct: string;
            mt: number;
          };
          const decryptCmd = envelope.mt === 3 ? "DecryptPreKey" : "Decrypt";
          const decResponse = await window.emberAPI.invoke<{ plaintext: string }>(
            decryptCmd,
            { senderAddress, ciphertext: envelope.ct }
          );
          if (!decResponse.success || !decResponse.data?.plaintext) {
            log.warn("Failed to decrypt distribution", {
              id: dist.id,
              sender: senderAddress,
            });
            continue;
          }
          await window.emberAPI.invoke("ProcessSenderKeyDistribution", {
            senderAddress,
            distributionMessage: decResponse.data.plaintext,
          });
          await fetch(
            `${auth.hostname}/api/v1/sender-key-distributions/${dist.id}/ack`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${auth.token}` },
            }
          );
          processed++;
        } catch (distErr) {
          const err = distErr as Error;
          log.warn("Failed to process distribution", {
            id: dist.id,
            error: err.message,
          });
        }
      }
      if (processed > 0) {
        log.info("Processed pending distributions", { count: processed });
      }
    } catch (error) {
      const err = error as Error;
      log.error("Failed to process incoming distributions", {
        error: err.message,
      });
    }
  }

  async function handleSenderKeyMemberJoined(emberId: string): Promise<void> {
    log.info("Member joined — distributing sender key", { ember_id: emberId });
    await distributeSenderKeyToMembers(emberId);
  }

  async function handleSenderKeyMemberLeft(emberId: string): Promise<void> {
    log.info("Member left — rotating sender key", { ember_id: emberId });
    const newDistId = crypto.randomUUID();
    await window.emberAPI.invoke("StoreDistributionId", {
      address: emberId,
      distributionId: newDistId,
    });
    senderKeyDistributionIds.set(emberId, newDistId);
    await window.emberAPI.invoke("CreateSenderKeyDistribution", {
      distributionId: newDistId,
    });
    await distributeSenderKeyToMembers(emberId);
  }

  // ─── Ember order (localStorage) ───────────────────────────────────────────

  const EMBER_ORDER_KEY = "ember_order";

  function saveEmberOrder(): void {
    const icons = document.querySelectorAll<HTMLElement>(
      ".server-icon:not(.add-server)"
    );
    const order = Array.from(icons).map((el) => el.dataset["emberId"]);
    localStorage.setItem(EMBER_ORDER_KEY, JSON.stringify(order));
  }

  function sortEmbersByOrder(embers: Ember[]): Ember[] {
    try {
      const order = JSON.parse(
        localStorage.getItem(EMBER_ORDER_KEY) || "[]"
      ) as string[];
      if (!order.length) return embers;
      return [...embers].sort((a, b) => {
        const ai = order.indexOf(a.id),
          bi = order.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    } catch {
      return embers;
    }
  }

  function clearEmberDragHighlights(): void {
    document
      .querySelectorAll<HTMLElement>(".server-icon.drag-over-ember")
      .forEach((el) => el.classList.remove("drag-over-ember"));
  }

  // ─── Ember fetch, render, switch ──────────────────────────────────────────

  async function fetchEmbers(): Promise<Ember[]> {
    log.debug("Fetching embers list");
    try {
      const auth = await window.getValidAuth();
      if (!auth) {
        log.error("Cannot fetch embers: not authenticated");
        return [];
      }
      const embers = await window.electronAPI.emberService.fetchEmbers(auth);
      log.info("Embers fetched", { count: embers.length });
      return embers;
    } catch (error) {
      const err = error as Error;
      log.error("Error fetching embers", { error: err.message });
      return [];
    }
  }

  function renderServerList(embers: Ember[]): void {
    embers = sortEmbersByOrder(embers);
    const serverList = document.querySelector(".server-list");
    if (!serverList) return;

    const addServerBtn = serverList.querySelector(".add-server");
    const separator = serverList.querySelector(".server-separator");

    serverList
      .querySelectorAll<HTMLElement>(".server-icon:not(.add-server):not(.dm-icon)")
      .forEach((el) => el.remove());

    App.emberMetadata.clear();
    embers.forEach((ember, index) => {
      App.emberMetadata.set(ember.id, { protocol_version: ember.protocol_version ?? 0 });
      const serverIcon = document.createElement("div");
      serverIcon.className = "server-icon";
      serverIcon.dataset["emberId"] = ember.id;

      if (index === 0 && !App.activeEmberId) {
        serverIcon.classList.add("active");
        App.activeEmberId = ember.id;
        loadServerContent(ember.id, ember.name);
      } else if (ember.id === App.activeEmberId) {
        serverIcon.classList.add("active");
      }

      if (ember.icon_data) {
        const img = document.createElement("img");
        img.src = ember.icon_data;
        img.alt = ember.name;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        serverIcon.appendChild(img);
      } else {
        const initial = document.createElement("span");
        initial.textContent = ember.name.charAt(0).toUpperCase();
        serverIcon.appendChild(initial);
      }

      serverIcon.addEventListener("click", () =>
        switchToServer(ember.id, ember.name)
      );

      // Drag-and-drop (client-side reorder only)
      serverIcon.setAttribute("draggable", "true");
      serverIcon.addEventListener("dragstart", (e: DragEvent) => {
        App.dragItem = { type: "ember", id: ember.id };
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        serverIcon.classList.add("dragging");
      });
      serverIcon.addEventListener("dragend", () => {
        serverIcon.classList.remove("dragging");
        clearEmberDragHighlights();
        saveEmberOrder();
      });
      serverIcon.addEventListener("dragover", (e: DragEvent) => {
        if (!App.dragItem || App.dragItem.type !== "ember") return;
        e.preventDefault();
        clearEmberDragHighlights();
        serverIcon.classList.add("drag-over-ember");
      });
      serverIcon.addEventListener("dragleave", () =>
        serverIcon.classList.remove("drag-over-ember")
      );
      serverIcon.addEventListener("drop", (e: DragEvent) => {
        e.preventDefault();
        clearEmberDragHighlights();
        if (
          !App.dragItem ||
          App.dragItem.type !== "ember" ||
          App.dragItem.id === ember.id
        )
          return;
        const draggedId = App.dragItem.id;
        App.dragItem = null;
        const list = document.querySelector(".server-list");
        const draggedEl = list?.querySelector<HTMLElement>(
          `.server-icon[data-ember-id="${draggedId}"]`
        );
        if (draggedEl) list!.insertBefore(draggedEl, serverIcon);
        saveEmberOrder();
      });

      // Right-click context menu (owners only)
      serverIcon.addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        if (ember.is_owner) showEmberContextMenu(e.clientX, e.clientY, ember);
      });

      if (separator) {
        serverList.insertBefore(serverIcon, separator);
      } else {
        serverList.insertBefore(serverIcon, addServerBtn);
      }
    });

    App.currentEmbers = embers;
  }

  function switchToServer(emberId: string, emberName: string): void {
    log.info("Switching to server", { ember_id: emberId, name: emberName });
    
    // Check if DM screen is open - if so, always allow switching
    const dmScreen = document.getElementById("dm-screen");
    const isDmScreenOpen = dmScreen?.classList.contains("active");
    
    // Don't reload if already in this server and not in DM mode
    if (App.activeEmberId === emberId && !isDmScreenOpen) {
      log.debug("Already in server, skipping reload", { ember_id: emberId });
      return;
    }
    
    // Close DM screen if it's active
    if (window.closeDMScreenOnServerSwitch) {
      window.closeDMScreenOnServerSwitch();
    }
    
    document.querySelectorAll<HTMLElement>(".server-icon").forEach((icon) => {
      if (icon.dataset["emberId"] === emberId) {
        icon.classList.add("active");
      } else {
        icon.classList.remove("active");
      }
    });
    App.activeEmberId = emberId;
    loadServerContent(emberId, emberName);
  }

  async function fetchEmberKey(emberId: string): Promise<Uint8Array | null> {
    // Signal embers (protocol_version=1) do not use legacy ember keys
    const emberMeta = App.emberMetadata.get(emberId);
    if ((emberMeta?.protocol_version ?? 0) === 1) {
      log.debug("Signal ember, no legacy key needed", { ember_id: emberId });
      return null;
    }
    if (App.emberKeyCache.has(emberId)) {
      log.debug("Ember key cache hit", { ember_id: emberId });
      return App.emberKeyCache.get(emberId) ?? null;
    }
    // Try loading from local SQLite archive first
    try {
      const archiveResult = await window.emberAPI.invoke<{ key: string | null }>(
        "LoadLegacyEmberKey",
        { emberId },
      );
      if (archiveResult.data?.key) {
        const keyBytes = decodeBase64ToBytes(archiveResult.data.key);
        App.emberKeyCache.set(emberId, keyBytes);
        log.debug("Ember key loaded from SQLite archive", { ember_id: emberId });
        return keyBytes;
      }
    } catch {
      log.debug("SQLite archive lookup failed, falling back to server", { ember_id: emberId });
    }
    // Legacy ember-key server endpoints are removed/unsupported post-cutover.
    // For historical decrypt fallback we rely exclusively on the local SQLite archive.
    return null;
  }

  async function loadServerContent(
    emberId: string,
    emberName: string
  ): Promise<void> {
    const serverHeader = document.querySelector(".server-header h3");
    if (serverHeader) serverHeader.textContent = emberName;

    // Clear messages container to prevent duplicates when switching from DM mode
    const messagesContainer = document.getElementById("messages");
    if (messagesContainer) {
      while (messagesContainer.firstChild) {
        messagesContainer.removeChild(messagesContainer.firstChild);
      }
    }

    // Clear stale voice presence from the previous ember before fetching the new one
    App.voiceChannelPresence.clear();
    // If the user is in an active voice channel, restore their participants immediately
    // from local session state so renderChannels can display them before the server fetch
    if (App.activeVoiceChannelId && App.voiceParticipants.size > 0) {
      App.voiceChannelPresence.set(
        App.activeVoiceChannelId,
        new Map(App.voiceParticipants)
      );
    }

    await fetchEmberKey(emberId);

    try {
      await createSenderKeyForEmber(emberId);
      await processIncomingSenderKeyDistributions();
    } catch (skErr) {
      log.warn("Sender key setup deferred", {
        ember_id: emberId,
        error: (skErr as Error).message,
      });
    }

    const auth = (await ipcRenderer.invoke("get-auth")) as AuthData | null;
    let channels: Channel[] = [];
    let categories: Category[] = [];
    if (auth && auth.token && auth.hostname) {
      const result = await window.electronAPI.channelService.fetchChannels(
        auth,
        emberId
      );
      channels = result.channels;
      categories = result.categories;
    }
    window.renderChannels(channels, categories);
    // Fetch and display current voice presence for all voice channels in this ember
    await window.fetchAndRenderVoicePresence(emberId);
    const members = await window.fetchMembers(emberId);
    window.renderMemberList(members);
    window.wsSubscribeToEmber(emberId);
  }

  // ─── Create Server Modal ───────────────────────────────────────────────────

  const createServerModal = document.getElementById("create-server-modal");
  const createServerBtn = document.getElementById(
    "create-server-btn"
  ) as HTMLButtonElement | null;
  const createServerCancelBtn = document.getElementById(
    "create-server-cancel-btn"
  );
  const serverNameInput = document.getElementById(
    "server-name-input"
  ) as HTMLInputElement | null;
  const serverIconUpload = document.getElementById(
    "server-icon-upload"
  ) as HTMLInputElement | null;
  const uploadIconBtn = document.getElementById("upload-icon-btn");
  const serverIconUrl = document.getElementById(
    "server-icon-url"
  ) as HTMLInputElement | null;
  const loadUrlBtn = document.getElementById("load-url-btn");
  const iconPreview = document.getElementById("icon-preview");
  const removeIconBtn = document.getElementById("remove-icon-btn");
  const createServerError = document.getElementById("create-server-error");
  const uploadSection = document.getElementById("upload-section");
  const urlSection = document.getElementById("url-section");
  const iconToggleBtns =
    document.querySelectorAll<HTMLElement>(".icon-toggle-btn");
  const addServerBtn = document.querySelector<HTMLElement>(".add-server");

  const addServerModal = document.getElementById("add-server-modal");
  const addServerCreateBtn = document.getElementById("add-server-create-btn");
  const addServerJoinBtn = document.getElementById("add-server-join-btn");
  const addServerCancelBtn = document.getElementById("add-server-cancel-btn");

  addServerBtn?.addEventListener("click", () => {
    addServerModal?.classList.remove("hidden");
  });
  addServerCancelBtn?.addEventListener("click", () => {
    addServerModal?.classList.add("hidden");
  });
  addServerModal?.addEventListener("click", (e: Event) => {
    if (e.target === addServerModal) addServerModal?.classList.add("hidden");
  });
  addServerCreateBtn?.addEventListener("click", () => {
    addServerModal?.classList.add("hidden");
    openCreateServerModal();
  });
  addServerJoinBtn?.addEventListener("click", () => {
    addServerModal?.classList.add("hidden");
    window.openJoinServerModal();
  });

  function openCreateServerModal(): void {
    if (createServerModal) {
      createServerModal.classList.remove("hidden");
      resetCreateServerForm();
    }
  }

  function closeCreateServerModal(): void {
    if (createServerModal) {
      createServerModal.classList.add("hidden");
      resetCreateServerForm();
    }
  }

  function resetCreateServerForm(): void {
    if (serverNameInput) serverNameInput.value = "";
    if (serverIconUrl) serverIconUrl.value = "";
    if (serverIconUpload) serverIconUpload.value = "";
    App.currentIconData = null;
    updateIconPreview(null);
    hideCreateServerError();
    App.currentIconSource = "upload";
    updateIconSourceUI();
  }

  function updateIconSourceUI(): void {
    iconToggleBtns.forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset["source"] === App.currentIconSource
      );
    });
    if (App.currentIconSource === "upload") {
      uploadSection?.classList.remove("hidden");
      urlSection?.classList.add("hidden");
    } else {
      uploadSection?.classList.add("hidden");
      urlSection?.classList.remove("hidden");
    }
  }

  iconToggleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      App.currentIconSource = (btn.dataset["source"] ?? "upload") as
        | "upload"
        | "url";
      updateIconSourceUI();
      App.currentIconData = null;
      updateIconPreview(null);
    });
  });

  uploadIconBtn?.addEventListener("click", () => serverIconUpload?.click());

  serverIconUpload?.addEventListener("change", async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      try {
        const resizedBase64 = await resizeImage(file, 512, 512);
        App.currentIconData = resizedBase64;
        updateIconPreview(resizedBase64);
      } catch (error) {
        showCreateServerError("Failed to process image");
        console.error("Image processing error:", error);
      }
    }
  });

  loadUrlBtn?.addEventListener("click", async () => {
    const url = serverIconUrl?.value.trim();
    if (!url) {
      showCreateServerError("Please enter an image URL");
      return;
    }
    if (!isValidUrl(url)) {
      showCreateServerError("Please enter a valid URL");
      return;
    }
    try {
      App.currentIconData = url;
      updateIconPreview(url);
    } catch (error) {
      showCreateServerError("Failed to load image from URL");
    }
  });

  removeIconBtn?.addEventListener("click", () => {
    App.currentIconData = null;
    updateIconPreview(null);
    if (serverIconUpload) serverIconUpload.value = "";
    if (serverIconUrl) serverIconUrl.value = "";
  });

  function updateIconPreview(data: string | null): void {
    if (!iconPreview) return;
    while (iconPreview.firstChild)
      iconPreview.removeChild(iconPreview.firstChild);
    if (data) {
      const img = document.createElement("img");
      img.src = data;
      img.onerror = () => {
        while (iconPreview.firstChild)
          iconPreview.removeChild(iconPreview.firstChild);
        const span = document.createElement("span");
        span.className = "preview-placeholder";
        span.textContent = "Failed to load image";
        iconPreview.appendChild(span);
        removeIconBtn?.classList.add("hidden");
      };
      img.onload = () => removeIconBtn?.classList.remove("hidden");
      iconPreview.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.className = "preview-placeholder";
      span.textContent = "No icon selected";
      iconPreview.appendChild(span);
      removeIconBtn?.classList.add("hidden");
    }
  }

  function isValidUrl(string: string): boolean {
    try {
      const url = new URL(string);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  async function resizeImage(
    file: File,
    maxWidth: number,
    maxHeight: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width,
            height = img.height;
          if (width > maxWidth || height > maxHeight) {
            const ratio = width / height;
            if (width > height) {
              width = maxWidth;
              height = width / ratio;
            } else {
              height = maxHeight;
              width = height * ratio;
            }
          }
          canvas.width = maxWidth;
          canvas.height = maxHeight;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#2f3136";
          ctx.fillRect(0, 0, maxWidth, maxHeight);
          ctx.drawImage(
            img,
            (maxWidth - width) / 2,
            (maxHeight - height) / 2,
            width,
            height
          );
          resolve(canvas.toDataURL(file.type || "image/png"));
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = (e.target as FileReader).result as string;
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  createServerCancelBtn?.addEventListener("click", closeCreateServerModal);
  createServerModal?.addEventListener("click", (e: Event) => {
    if (e.target === createServerModal) closeCreateServerModal();
  });
  createServerBtn?.addEventListener("click", async () => {
    await handleCreateServer();
  });

  async function handleCreateServer(): Promise<void> {
    const serverName = serverNameInput?.value.trim();
    if (!serverName) {
      log.warn("Create server validation failed: name required");
      showCreateServerError("Server name is required");
      return;
    }
    if (serverName.length > 100) {
      log.warn("Create server validation failed: name too long");
      showCreateServerError("Server name must be 100 characters or less");
      return;
    }

    log.info("Creating new server", { name: serverName });
    try {
      if (createServerBtn) {
        createServerBtn.disabled = true;
        createServerBtn.textContent = "Creating...";
      }
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
      } | null;
      if (!auth || !auth.token || !auth.hostname) {
        showCreateServerError("Not authenticated");
        return;
      }
      const requestBody: Record<string, unknown> = {
        name: serverName,
      };
      if (App.currentIconData) requestBody["icon_data"] = App.currentIconData;

      const response = await fetch(`${auth.hostname}/api/v1/embers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errorData.error ?? "Failed to create server");
      }
      const newEmber = (await response.json()) as {
        id?: string;
        name?: string;
      };
      // Signal sender-keys replace legacy ember-keys for new messages.

      if (newEmber.id) {
        try {
          await createSenderKeyForEmber(newEmber.id);
          log.info("Sender key initialized for new ember", { ember_id: newEmber.id });
        } catch (skErr) {
          log.warn("Sender key initialization deferred", {
            ember_id: newEmber.id,
            error: (skErr as Error).message,
          });
        }
      }

      closeCreateServerModal();
      log.info("Server created successfully", {
        ember_id: newEmber.id ?? "",
        name: newEmber.name ?? "",
      });
      window.hideWelcomeScreen();
      const embers = await fetchEmbers();
      renderServerList(embers);
      if (newEmber.id) switchToServer(newEmber.id, newEmber.name ?? "");
    } catch (error) {
      const err = error as Error;
      log.error("Failed to create server", { error: err.message });
      showCreateServerError(err.message || "Failed to create server");
    } finally {
      if (createServerBtn) {
        createServerBtn.disabled = false;
        createServerBtn.textContent = "Create Server";
      }
    }
  }

  function showCreateServerError(message: string): void {
    if (createServerError) {
      createServerError.textContent = message;
      createServerError.classList.remove("hidden");
    }
  }

  function hideCreateServerError(): void {
    createServerError?.classList.add("hidden");
  }

  // ─── Ember context menu ────────────────────────────────────────────────────

  const emberContextMenu = document.getElementById("ember-context-menu");
  let contextMenuEmber: Ember | null = null;

  function showEmberContextMenu(x: number, y: number, ember: Ember): void {
    if (!emberContextMenu) return;
    contextMenuEmber = ember;
    emberContextMenu.classList.remove("hidden");
    // Position off-screen first so getBoundingClientRect returns real dimensions
    emberContextMenu.style.left = "0px";
    emberContextMenu.style.top = "0px";
    const rect = emberContextMenu.getBoundingClientRect();
    emberContextMenu.style.left = `${Math.min(x, window.innerWidth - rect.width - 5)}px`;
    emberContextMenu.style.top = `${Math.min(y, window.innerHeight - rect.height - 5)}px`;
  }

  document.addEventListener("click", () => {
    emberContextMenu?.classList.add("hidden");
  });

  const deleteEmberBtn = document.getElementById("ctx-ember-delete");
  if (deleteEmberBtn) {
    deleteEmberBtn.addEventListener("click", async () => {
      if (!contextMenuEmber) return;
      emberContextMenu?.classList.add("hidden");
      if (!confirm(`Delete "${contextMenuEmber.name}"? This cannot be undone.`))
        return;
      const auth = (await ipcRenderer.invoke("get-auth")) as {
        token?: string;
        hostname?: string;
      } | null;
      if (!auth?.token || !auth?.hostname) return;
      const res = await fetch(
        `${auth.hostname}/api/v1/embers/${contextMenuEmber.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${auth.token}` },
        }
      );
      if (res.ok) {
        if (App.activeEmberId === contextMenuEmber.id) App.activeEmberId = null;
        const embers = await fetchEmbers();
        if (embers.length === 0) {
          renderServerList(embers);
          window.showWelcomeScreen();
        } else {
          renderServerList(embers);
        }
      } else {
        alert("Failed to delete ember.");
      }
      contextMenuEmber = null;
    });
  }

  // ─── Edit Ember Modal ───────────────────────────────────────────────────────

  const editEmberModal = document.getElementById("edit-ember-modal");
  const editEmberBtn = document.getElementById("ctx-ember-edit");
  const editEmberNameInput = document.getElementById("edit-ember-name-input") as HTMLInputElement | null;
  const editEmberIconUpload = document.getElementById("edit-ember-icon-upload") as HTMLInputElement | null;
  const editUploadIconBtn = document.getElementById("edit-upload-icon-btn");
  const editEmberIconUrl = document.getElementById("edit-ember-icon-url") as HTMLInputElement | null;
  const editLoadUrlBtn = document.getElementById("edit-load-url-btn");
  const editIconPreview = document.getElementById("edit-icon-preview");
  const editRemoveIconBtn = document.getElementById("edit-remove-icon-btn");
  const editEmberError = document.getElementById("edit-ember-error");
  const editUploadSection = document.getElementById("edit-upload-section");
  const editUrlSection = document.getElementById("edit-url-section");
  const editIconToggleBtns = document.querySelectorAll<HTMLElement>(".icon-toggle-btn");
  const editEmberSaveBtn = document.getElementById("edit-ember-save-btn") as HTMLButtonElement | null;
  const editEmberCancelBtn = document.getElementById("edit-ember-cancel-btn") as HTMLButtonElement | null;

  let editingEmber: Ember | null = null;
  let editCurrentIconSource: "upload" | "url" = "upload";

  if (editEmberBtn) {
    editEmberBtn.addEventListener("click", () => {
      if (!contextMenuEmber) return;
      emberContextMenu?.classList.add("hidden");
      openEditEmberModal(contextMenuEmber);
    });
  }

  function openEditEmberModal(ember: Ember): void {
    if (!editEmberModal) return;
    editingEmber = ember;
    resetEditEmberForm();
    
    // Pre-fill current values
    if (editEmberNameInput) editEmberNameInput.value = ember.name;
    if (ember.icon_data) {
      App.currentIconData = ember.icon_data;
      updateEditIconPreview(ember.icon_data);
    }

    editEmberModal.classList.remove("hidden");
  }

  function closeEditEmberModal(): void {
    if (editEmberModal) {
      editEmberModal.classList.add("hidden");
      resetEditEmberForm();
    }
    editingEmber = null;
  }

  function resetEditEmberForm(): void {
    if (editEmberNameInput) editEmberNameInput.value = "";
    if (editEmberIconUrl) editEmberIconUrl.value = "";
    if (editEmberIconUpload) editEmberIconUpload.value = "";
    App.currentIconData = null;
    updateEditIconPreview(null);
    hideEditEmberError();
    editCurrentIconSource = "upload";
    updateEditIconSourceUI();
  }

  function updateEditIconSourceUI(): void {
    editIconToggleBtns.forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset["source"] === editCurrentIconSource
      );
    });
    if (editCurrentIconSource === "upload") {
      editUploadSection?.classList.remove("hidden");
      editUrlSection?.classList.add("hidden");
    } else {
      editUploadSection?.classList.add("hidden");
      editUrlSection?.classList.remove("hidden");
    }
  }

  function updateEditIconPreview(data: string | null): void {
    if (!editIconPreview) return;
    while (editIconPreview.firstChild)
      editIconPreview.removeChild(editIconPreview.firstChild);
    if (data) {
      const img = document.createElement("img");
      img.src = data;
      img.onerror = () => {
        while (editIconPreview.firstChild)
          editIconPreview.removeChild(editIconPreview.firstChild);
        const span = document.createElement("span");
        span.className = "preview-placeholder";
        span.textContent = "Failed to load image";
        editIconPreview.appendChild(span);
        editRemoveIconBtn?.classList.add("hidden");
      };
      img.onload = () => editRemoveIconBtn?.classList.remove("hidden");
      editIconPreview.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.className = "preview-placeholder";
      span.textContent = "No icon selected";
      editIconPreview.appendChild(span);
      editRemoveIconBtn?.classList.add("hidden");
    }
  }

  function showEditEmberError(message: string): void {
    if (editEmberError) {
      editEmberError.textContent = message;
      editEmberError.classList.remove("hidden");
    }
  }

  function hideEditEmberError(): void {
    editEmberError?.classList.add("hidden");
  }

  // Edit ember modal event listeners
  editIconToggleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      editCurrentIconSource = (btn.dataset["source"] ?? "upload") as
        | "upload"
        | "url";
      updateEditIconSourceUI();
      App.currentIconData = null;
      updateEditIconPreview(null);
    });
  });

  editUploadIconBtn?.addEventListener("click", () => editEmberIconUpload?.click());

  editEmberIconUpload?.addEventListener("change", async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      try {
        const resizedBase64 = await resizeImage(file, 512, 512);
        App.currentIconData = resizedBase64;
        updateEditIconPreview(resizedBase64);
      } catch (error) {
        showEditEmberError("Failed to process image");
        console.error("Image processing error:", error);
      }
    }
  });

  editLoadUrlBtn?.addEventListener("click", async () => {
    const url = editEmberIconUrl?.value.trim();
    if (!url) {
      showEditEmberError("Please enter an image URL");
      return;
    }
    if (!isValidUrl(url)) {
      showEditEmberError("Please enter a valid URL");
      return;
    }
    try {
      App.currentIconData = url;
      updateEditIconPreview(url);
    } catch (error) {
      showEditEmberError("Failed to load image from URL");
    }
  });

  editRemoveIconBtn?.addEventListener("click", () => {
    App.currentIconData = null;
    updateEditIconPreview(null);
    if (editEmberIconUpload) editEmberIconUpload.value = "";
    if (editEmberIconUrl) editEmberIconUrl.value = "";
  });

  editEmberCancelBtn?.addEventListener("click", closeEditEmberModal);
  editEmberModal?.addEventListener("click", (e: Event) => {
    if (e.target === editEmberModal) closeEditEmberModal();
  });

  editEmberSaveBtn?.addEventListener("click", async () => {
    await handleEditEmber();
  });

  async function handleEditEmber(): Promise<void> {
    if (!editingEmber) return;

    const emberName = editEmberNameInput?.value.trim();
    if (!emberName) {
      showEditEmberError("Server name is required");
      return;
    }
    if (emberName.length > 100) {
      showEditEmberError("Server name must be 100 characters or less");
      return;
    }

    // Check if anything actually changed
    const nameChanged = emberName !== editingEmber.name;
    const iconChanged = App.currentIconData !== editingEmber.icon_data;

    if (!nameChanged && !iconChanged) {
      closeEditEmberModal();
      return;
    }

    log.info("Updating ember", { 
      ember_id: editingEmber.id, 
      name: emberName,
      has_icon_change: iconChanged 
    });

    try {
      if (editEmberSaveBtn) {
        editEmberSaveBtn.disabled = true;
        editEmberSaveBtn.textContent = "Saving...";
      }

      const auth = await window.getValidAuth();
      if (!auth) {
        showEditEmberError("Not authenticated");
        return;
      }

      // Build update request with only changed fields
      const updates: any = {};
      if (nameChanged) updates.name = emberName;
      if (iconChanged) updates.icon_data = App.currentIconData;

      const updatedEmber = await window.electronAPI.emberService.updateEmber(
        auth,
        editingEmber.id,
        updates
      );

      closeEditEmberModal();
      log.info("Ember updated successfully", {
        ember_id: updatedEmber.id,
        name: updatedEmber.name,
      });

      // Refresh ember list and switch back to this ember if it's active
      const embers = await fetchEmbers();
      renderServerList(embers);
      
      if (App.activeEmberId === editingEmber.id) {
        loadServerContent(editingEmber.id, updatedEmber.name);
      }
    } catch (error) {
      const err = error as Error;
      log.error("Failed to update ember", { error: err.message });
      showEditEmberError(err.message || "Failed to update server");
    } finally {
      if (editEmberSaveBtn) {
        editEmberSaveBtn.disabled = false;
        editEmberSaveBtn.textContent = "Save Changes";
      }
    }
  }

  window.fetchEmbers = fetchEmbers;
  window.renderServerList = renderServerList;
  window.switchToServer = switchToServer;
  window.fetchEmberKey = fetchEmberKey;
  window.loadServerContent = loadServerContent;
  window.openCreateServerModal = openCreateServerModal;
  window.closeCreateServerModal = closeCreateServerModal;
  window.handleSenderKeyMemberJoined = handleSenderKeyMemberJoined;
  window.handleSenderKeyMemberLeft = handleSenderKeyMemberLeft;
})();
