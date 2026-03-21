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

  // ─── Auth Consistency Validation ───────────────────────────────────────

  function validateAuthConsistency(auth1: AuthData | null, auth2: AuthData | null, context: string): void {
    if (!auth1 || !auth2) {
      throw new Error(`Auth data missing in ${context}`);
    }
    
    if (auth1.user_id !== auth2.user_id || auth1.device_id !== auth2.device_id) {
      log.error('Auth data inconsistency detected', {
        context,
        auth1_user_id: auth1.user_id,
        auth1_device_id: auth1.device_id,
        auth2_user_id: auth2.user_id,
        auth2_device_id: auth2.device_id
      });
      throw new Error(`Auth data inconsistency in ${context}: user_id or device_id mismatch`);
    }
    
    if (auth1.token !== auth2.token || auth1.hostname !== auth2.hostname) {
      log.error('Auth token/hostname inconsistency detected', {
        context,
        auth1_hostname: auth1.hostname,
        auth2_hostname: auth2.hostname,
        token_match: auth1.token === auth2.token
      });
      throw new Error(`Auth data inconsistency in ${context}: token or hostname mismatch`);
    }
  }

  async function validateCryptoState(auth: AuthData): Promise<void> {
    try {
      // Test basic crypto operation by loading a distribution ID
      // This validates that the Signal database is accessible and using correct keys
      const testResult = await window.emberAPI.invoke<{ distributionId: string | null }>(
        "LoadDistributionId",
        { address: `${auth.user_id}.${auth.device_id}` }
      );

      // Check if the operation succeeded
      if (!testResult.success) {
        throw new Error(`Crypto validation failed: ${testResult.error || 'Unknown error'}`);
      }

      log.debug('Crypto state validation passed', {
        user_id: auth.user_id,
        device_id: auth.device_id,
        has_distribution_id: testResult.data?.distributionId ? true : false
      });
      
    } catch (error) {
      const err = error as Error;
      
      // Check for crypto authentication failures
      if (err.message.includes('Authentication failed') || 
          err.message.includes('corrupted or tampered') ||
          err.message.includes('data may be corrupted')) {
        log.error('Crypto state validation failed - authentication error', {
          user_id: auth.user_id,
          device_id: auth.device_id,
          error: err.message,
          security_impact: 'high'
        });
        throw new Error(`Crypto state corrupted: ${err.message}. Please restart the application.`);
      }
      
      // Other errors might be network-related or temporary
      log.warn('Crypto state validation failed - non-authentication error', {
        user_id: auth.user_id,
        device_id: auth.device_id,
        error: err.message
      });
      throw new Error(`Crypto state validation failed: ${err.message}`);
    }
  }

  // ─── Sender Key Distribution Management ──────────────────────────────────

  const senderKeyDistributionIds = new Map<string, string>();

  // ─── Group Crypto State Machine ──────────────────────────────────────

  type CryptoMode = 'pairwise_bootstrap' | 'sender_key_active';
  type SenderKeyStatus = 'not_initialized' | 'distributing' | 'active' | 'rotation_required';

  interface ConversationCryptoState {
    cryptoMode: CryptoMode;
    senderKeyStatus: SenderKeyStatus;
    activeDistributionId: string | null;
    senderKeyEpoch: number;
  }

  const DEFAULT_CRYPTO_STATE: ConversationCryptoState = {
    cryptoMode: 'pairwise_bootstrap',
    senderKeyStatus: 'not_initialized',
    activeDistributionId: null,
    senderKeyEpoch: 0,
  };

  const emberCryptoStates = new Map<string, ConversationCryptoState>();

  function getCryptoState(emberId: string): ConversationCryptoState {
    return emberCryptoStates.get(emberId) ?? { ...DEFAULT_CRYPTO_STATE };
  }

  function setCryptoState(emberId: string, update: Partial<ConversationCryptoState>): ConversationCryptoState {
    const current = getCryptoState(emberId);
    const next: ConversationCryptoState = {
      cryptoMode: update.cryptoMode ?? current.cryptoMode,
      senderKeyStatus: update.senderKeyStatus ?? current.senderKeyStatus,
      activeDistributionId: update.activeDistributionId !== undefined ? update.activeDistributionId : current.activeDistributionId,
      senderKeyEpoch: update.senderKeyEpoch ?? current.senderKeyEpoch,
    };
    emberCryptoStates.set(emberId, next);
    log.debug('Crypto state updated', {
      ember_id: emberId,
      crypto_mode: next.cryptoMode,
      sender_key_status: next.senderKeyStatus,
      epoch: next.senderKeyEpoch,
      has_distribution_id: next.activeDistributionId !== null,
    });
    return next;
  }

  function shouldUseSenderKey(emberId: string, memberCount: number): boolean {
    const state = getCryptoState(emberId);
    return (
      memberCount >= 3 &&
      state.senderKeyStatus === 'active'
    );
  }

  /** Sync crypto state from server response. */
  function syncCryptoStateFromServer(emberId: string, serverState: {
    crypto_mode?: string;
    sender_key_status?: string;
    active_distribution_id?: string | null;
    sender_key_epoch?: number;
  }): void {
    setCryptoState(emberId, {
      cryptoMode: (serverState.crypto_mode as CryptoMode) ?? 'pairwise_bootstrap',
      senderKeyStatus: (serverState.sender_key_status as SenderKeyStatus) ?? 'not_initialized',
      activeDistributionId: serverState.active_distribution_id ?? null,
      senderKeyEpoch: serverState.sender_key_epoch ?? 0,
    });
  }

  // CRITICAL FIX: Add comprehensive instrumentation for crypto operations
  const senderKeyOperationLog = new Map<string, {
    createdAt: number;
    operation: 'encrypt' | 'decrypt' | 'distribute' | 'load';
    address: string;
    distributionId: string;
    success: boolean;
    error?: string;
    duration?: number;
  }>();

  function logCryptoOperation(
    operation: 'encrypt' | 'decrypt' | 'distribute' | 'load',
    address: string, 
    distributionId: string,
    success: boolean,
    error?: string,
    duration?: number
  ): void {
    const logEntry = {
      createdAt: Date.now(),
      operation,
      address,
      distributionId,
      success,
      error,
      duration
    };
    
    const key = `${operation}:${address}:${distributionId}`;
    senderKeyOperationLog.set(key, logEntry);
    
    // Keep only last 100 operations to prevent memory leaks
    if (senderKeyOperationLog.size > 100) {
      const oldestKey = senderKeyOperationLog.keys().next().value;
      if (oldestKey) {
        senderKeyOperationLog.delete(oldestKey);
      }
    }
    
    // Log the operation
    if (success) {
      log.debug('Crypto operation succeeded', {
        operation,
        address,
        distributionId,
        duration
      });
    } else {
      log.error('Crypto operation failed', {
        operation,
        address,
        distributionId,
        error,
        duration
      });
    }
  }

  function getCryptoOperationHistory(): Array<{
    createdAt: number;
    operation: string;
    address: string;
    distributionId: string;
    success: boolean;
    error?: string;
    duration?: number;
  }> {
    return Array.from(senderKeyOperationLog.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20); // Return last 20 operations
  }

  async function loadOrCreateDistributionId(emberId: string): Promise<string> {
    const cached = senderKeyDistributionIds.get(emberId);
    if (cached) return cached;
    const response = await window.emberAPI.invoke<{ distributionId: string | null }>(
      "LoadDistributionId",
      { address: emberId }
    );
    if (response.success && response.data?.distributionId) {
      senderKeyDistributionIds.set(emberId, response.data.distributionId);
      return response.data.distributionId;
    }
    // Fail fast: if the DB itself is unavailable, no point trying StoreDistributionId
    if (!response.success && (response as any).error?.includes('Signal database not available')) {
      throw new Error('Signal database not available');
    }
    // DB is available but no ID stored yet — create a fresh one
    const distributionId = crypto.randomUUID();
    const storeResp = await window.emberAPI.invoke("StoreDistributionId", {
      address: emberId,
      distributionId,
    });
    if (!storeResp.success) {
      throw new Error('Signal database not available - cannot store distribution ID');
    }
    senderKeyDistributionIds.set(emberId, distributionId);
    log.info("Generated distribution ID", { ember_id: emberId });
    return distributionId;
  }

  async function createSenderKeyForEmber(
    emberId: string
  ): Promise<{ distributionId: string; distributionMessage: string }> {
    try {
      // CRITICAL FIX: Ensure authentication is properly synchronized before creating sender keys
      const auth = await getValidAuth();
      if (!auth || !auth.token || !auth.user_id || !auth.device_id) {
        throw new Error('Not authenticated — cannot determine local address');
      }

      const distributionId = await loadOrCreateDistributionId(emberId);
      const response = await window.emberAPI.invoke<{ distributionMessage: string; error?: string }>(
        "CreateSenderKeyDistribution",
        { distributionId }
      );
      if (!response.success || !response.data?.distributionMessage) {
        const errorMessage = response.error ?? 'Unknown error';
        throw new Error(`Failed to create sender key distribution: ${errorMessage}`);
      }
      return {
        distributionId,
        distributionMessage: response.data.distributionMessage,
      };
    } catch (error) {
      // Enhance error message with context
      const err = error as Error;
      if (err.message.includes('Signal database not available')) {
        throw new Error('Signal database not available - please check database configuration and restart the application');
      }
      if (err.message.includes('Failed to create sender key distribution')) {
        // Re-throw enhanced error
        throw err;
      }
      // Wrap other errors
      throw new Error(`Failed to create sender key distribution: ${err.message}`);
    }
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
    
    // CRITICAL FIX: Check if this is a self-session (user establishing session with own device)
    const isSelfSession = userId === auth.user_id && deviceId === auth.device_id;
    
    // CRITICAL FIX: Even for self-sessions, we need to establish a proper Signal session
    // The previous assumption that Signal Protocol can handle self-encryption without a session was incorrect
    if (isSelfSession) {
      log.debug("Establishing self-session for self-encryption", { address });
      
      // For self-sessions, we need to fetch our own pre-key bundle and establish a session
      // This is required because Signal Protocol needs a session even for self-encryption
      try {
        const bundleResponse = await fetch(
          `${auth.hostname}/api/v1/users/${userId}/devices/${deviceId}/prekey-bundle`,
          { headers: { Authorization: `Bearer ${auth.token}` } }
        );
        
        if (bundleResponse.ok) {
          const bundle = (await bundleResponse.json()) as Record<string, unknown>;
          const signedPreKey = bundle["signed_pre_key"] as Record<string, unknown> | undefined;
          const oneTimePreKey = bundle["one_time_pre_key"] as Record<string, unknown> | undefined;
          const pkbResult = await window.emberAPI.invoke("ProcessPreKeyBundle", {
            recipientAddress: address,
            registrationId: bundle["registration_id"],
            deviceId: 1,
            preKeyId: oneTimePreKey?.["id"] ?? undefined,
            preKey: oneTimePreKey?.["public_key"] ?? undefined,
            signedPreKeyId: signedPreKey?.["id"],
            signedPreKey: signedPreKey?.["public_key"],
            signedPreKeySignature: signedPreKey?.["signature"],
            identityKey: bundle["identity_key"],
          });
          if (!pkbResult.success) {
            throw new Error(`ProcessPreKeyBundle failed for ${address}: ${pkbResult.error ?? 'unknown'}`);
          }
          log.info("Self-session established successfully", { address });
          return;
        } else {
          throw new Error(`Failed to fetch self pre-key bundle for ${address} (HTTP ${bundleResponse.status})`);
        }
      } catch (error) {
        const err = error as Error;
        log.error("Failed to establish self-session", {
          address,
          user_id: userId,
          device_id: deviceId,
          error: err.message
        });
        throw err;
      }
    }
    
    // For non-self sessions, use the existing pre-key bundle fetch logic
    // CRITICAL FIX: Add retry logic for pre-key bundle fetch failures
    let retries = 0;
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second base delay
    
    while (retries < maxRetries) {
      try {
        const bundleResponse = await fetch(
          `${auth.hostname}/api/v1/users/${userId}/devices/${deviceId}/prekey-bundle`,
          { headers: { Authorization: `Bearer ${auth.token}` } }
        );
        
        if (bundleResponse.ok) {
          const bundle = (await bundleResponse.json()) as Record<string, unknown>;
          const signedPreKey = bundle["signed_pre_key"] as Record<string, unknown> | undefined;
          const oneTimePreKey = bundle["one_time_pre_key"] as Record<string, unknown> | undefined;
          const pkbResult = await window.emberAPI.invoke("ProcessPreKeyBundle", {
            recipientAddress: address,
            registrationId: bundle["registration_id"],
            deviceId: 1,
            preKeyId: oneTimePreKey?.["id"] ?? undefined,
            preKey: oneTimePreKey?.["public_key"] ?? undefined,
            signedPreKeyId: signedPreKey?.["id"],
            signedPreKey: signedPreKey?.["public_key"],
            signedPreKeySignature: signedPreKey?.["signature"],
            identityKey: bundle["identity_key"],
          });
          if (!pkbResult.success) {
            throw new Error(`ProcessPreKeyBundle failed for ${address}: ${pkbResult.error ?? 'unknown'}`);
          }
          log.info("Signal session established", { address });
          return; // Success - exit retry loop
        } else {
          throw new Error(`Failed to fetch pre-key bundle for ${address} (HTTP ${bundleResponse.status})`);
        }
      } catch (error) {
        retries++;
        const err = error as Error;
        
        if (retries >= maxRetries) {
          // Final attempt failed - log with enhanced context
          log.error("Failed to establish Signal session after retries", {
            address,
            user_id: userId,
            device_id: deviceId,
            error: err.message,
            retries,
            maxRetries
          });
          throw err; // Re-throw for caller to handle
        } else {
          // Retry attempt - log and wait briefly
          log.warn("Signal session setup failed, retrying", {
            address,
            error: err.message,
            retry: retries,
            maxRetries: maxRetries,
            delay: retryDelay * Math.pow(2, retries - 1)
          });
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, retries - 1)));
        }
      }
    }
  }

  async function distributeSenderKeyToMembers(emberId: string, auth: AuthData): Promise<void> {
    const startTime = Date.now();
    const distributionId = await loadOrCreateDistributionId(emberId);
    
    try {
      // CRITICAL FIX: Use provided auth data instead of fetching again
      // This prevents auth inconsistencies that cause crypto failures
      if (!auth || !auth.token || !auth.hostname) {
        throw new Error('Invalid auth data provided to distributeSenderKeyToMembers');
      }
      
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
      
      const distributions: Array<{
        recipient_user_id: string;
        recipient_device_id: string;
        distribution_message: string;
      }> = [];
      
      // Install a self-receive copy of the sender key. The IPC handler stores it
      // under a "self-recv::" prefixed address so it doesn't corrupt the encrypt
      // chain. This allows self-decrypt of own messages on history reload.
      const selfAddress = `${auth.user_id}.${auth.device_id}`;
      const selfProcessResult = await window.emberAPI.invoke(
        "ProcessSenderKeyDistribution",
        { senderAddress: selfAddress, distributionMessage }
      );
      if (!selfProcessResult.success) {
        log.error("Failed to install self-receive sender key", {
          ember_id: emberId,
          error: selfProcessResult.error ?? 'Unknown error',
        });
      }

      // Distribute to other members (if any)
      for (const member of members) {
        // Skip if this is the current user's device (already added above)
        if (member.user_id === auth.user_id && member.device_id === auth.device_id) {
          continue;
        }
        
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
          self_included: true,
        });
        
        // CRITICAL FIX: Log successful distribution operation
        const duration = Date.now() - startTime;
        logCryptoOperation('distribute', auth.user_id, distributionId, true, undefined, duration);
      } else {
        // No other members to distribute to — this is normal for solo users.
        // The sender already has the key from createSenderKeyDistribution.
        log.debug("No remote distributions needed", { ember_id: emberId });
        const duration = Date.now() - startTime;
        logCryptoOperation('distribute', auth.user_id, distributionId, true, undefined, duration);
      }
    } catch (error) {
      const err = error as Error;
      const duration = Date.now() - startTime;
      
      // CRITICAL FIX: Log failed distribution operation
      logCryptoOperation('distribute', auth.user_id, distributionId, false, err.message, duration);
      
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
    const auth = await getValidAuth();
    if (!auth || !auth.token || !auth.hostname) {
      throw new Error('Not authenticated for sender key distribution');
    }
    await distributeSenderKeyToMembers(emberId, auth);

    // Signal distribution complete to the crypto routing state machine
    const distId = senderKeyDistributionIds.get(emberId);
    if (distId) {
      window.cryptoRouting.onDistributionComplete(emberId, distId);
    }
  }

  async function handleSenderKeyMemberLeft(emberId: string): Promise<void> {
    log.info("Member left — rotating sender key", { ember_id: emberId });

    const auth = await getValidAuth();
    if (!auth || !auth.token || !auth.hostname) {
      throw new Error('Not authenticated for sender key rotation');
    }

    const newDistId = crypto.randomUUID();
    await window.emberAPI.invoke("StoreDistributionId", {
      address: emberId,
      distributionId: newDistId,
    });
    senderKeyDistributionIds.set(emberId, newDistId);
    await window.emberAPI.invoke("CreateSenderKeyDistribution", {
      distributionId: newDistId,
    });
    await distributeSenderKeyToMembers(emberId, auth);

    // Signal rotation complete to the crypto routing state machine
    window.cryptoRouting.onRotationComplete(emberId, newDistId);
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

    embers.forEach((ember, index) => {
      const serverIcon = document.createElement("div");
      serverIcon.className = "server-icon";
      serverIcon.dataset["emberId"] = ember.id;

      if (index === 0 && !App.activeEmberId) {
        serverIcon.classList.add("active");
        App.activeEmberId = ember.id;
        loadServerContent(ember.id, ember.name).catch((err: Error) =>
          log.error("Failed to load server content on render", { ember_id: ember.id, error: err.message })
        );
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
    loadServerContent(emberId, emberName).catch((err: Error) =>
      log.error("Failed to load server content on switch", { ember_id: emberId, error: err.message })
    );
  }

  async function fetchEmberKey(_emberId: string): Promise<Uint8Array | null> {
    // Signal Protocol sender keys handle all group message encryption.
    // Per-ember symmetric keys are not used.
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

    // CRITICAL FIX: Capture auth data once and use consistently throughout
    // Don't fetch auth again - it could be different and cause crypto inconsistencies
    const auth = await getValidAuth();
    if (!auth || !auth.token || !auth.hostname || !auth.user_id || !auth.device_id) {
      throw new Error('Not authenticated - cannot load server content');
    }

    // Attempt crypto setup before loading messages — degrade gracefully if Signal DB is unavailable.
    // Only hard-fail on actual cryptographic corruption (authentication failures).
    try {
      await validateCryptoState(auth);
      await createSenderKeyForEmber(emberId);
      await processIncomingSenderKeyDistributions();
      await distributeSenderKeyToMembers(emberId, auth);
    } catch (skErr) {
      const errorMessage = (skErr as Error).message;

      if (errorMessage.includes('Authentication failed') ||
          errorMessage.includes('corrupted or tampered') ||
          errorMessage.includes('data may be corrupted') ||
          errorMessage.includes('Crypto state corrupted')) {
        const criticalError = `Critical crypto authentication failure: ${errorMessage}. This indicates corrupted cryptographic state or a security issue. Please restart the application.`;
        log.error("Critical crypto authentication failure detected", {
          ember_id: emberId,
          error: errorMessage,
          action: "Stopping all operations - requires application restart",
          security_impact: "high"
        });
        alert('Security Alert: Cryptographic state corruption detected. Please restart the application.');
        throw new Error(criticalError);
      }

      // Signal DB unavailable or network error — warn and continue loading non-crypto content
      log.warn("Sender key setup deferred — crypto unavailable, loading content without encryption support", {
        ember_id: emberId,
        error: errorMessage,
      });
    }
    
    let channels: Channel[] = [];
    let categories: Category[] = [];
    
    const result = await window.electronAPI.channelService.fetchChannels(
      auth,
      emberId
    );
    channels = result.channels;
    categories = result.categories;
    window.renderChannels(channels, categories);
    // Fetch and display current voice presence for all voice channels in this ember
    await window.fetchAndRenderVoicePresence(emberId);
    const members = await window.fetchMembers(emberId);
    window.renderMemberList(members);
    window.wsSubscribeToEmber(emberId);

    // Sync crypto state from server
    try {
      const cryptoResp = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/crypto-state`, {
        headers: { 'Authorization': `Bearer ${auth.token}` },
      });
      if (cryptoResp.ok) {
        const cryptoData = await cryptoResp.json();
        syncCryptoStateFromServer(emberId, cryptoData);
      }
    } catch (cryptoErr) {
      log.warn('Failed to sync crypto state from server', { ember_id: emberId, error: (cryptoErr as Error).message });
    }
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
      const auth = await window.getValidAuth();
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
      // Signal sender-keys are used for all ember message encryption.

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
      const auth = await window.getValidAuth();
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
        await loadServerContent(editingEmber.id, updatedEmber.name);
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

  // Wrapper function for global assignment (IIFE module pattern)
  const distributeSenderKeyToMembersWrapper = async (emberId: string): Promise<void> => {
    const auth = await getValidAuth();
    if (!auth || !auth.token || !auth.hostname) {
      throw new Error('Not authenticated for sender key distribution');
    }
    await distributeSenderKeyToMembers(emberId, auth);
  };

  async function ensureSenderKeyForEmber(emberId: string): Promise<string | null> {
    try {
      const { distributionId } = await createSenderKeyForEmber(emberId);
      return distributionId;
    } catch (err) {
      log.warn('ensureSenderKeyForEmber failed', { ember_id: emberId, error: (err as Error).message });
      return null;
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
  window.processIncomingDistributions = processIncomingSenderKeyDistributions;
  window.distributeSenderKeyToMembers = distributeSenderKeyToMembersWrapper;
  window.ensureSenderKeyForEmber = ensureSenderKeyForEmber;
  window.getCryptoState = getCryptoState;
  window.setCryptoState = setCryptoState;
  window.shouldUseSenderKey = shouldUseSenderKey;
  window.syncCryptoStateFromServer = syncCryptoStateFromServer;
})();
