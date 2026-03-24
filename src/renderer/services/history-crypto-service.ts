/**
 * HistoryCryptoService — renderer-facing service for Layer 2 history key encryption.
 *
 * Uses SubtleCrypto (available in renderer) for HKDF and AES-GCM.
 * Does NOT use `import` statements — all dependencies accessed via inline
 * crypto.subtle calls to avoid CommonJS/require issues in the renderer.
 *
 * Key hierarchy: CRK → HKDF → EHK → HKDF → message_key → AES-256-GCM
 */
(function (): void {
  const log = window.emberLog.createLogger('HistoryCrypto');

  interface AuthData {
    token: string;
    userId: string;
    deviceId: string;
    hostname: string;
    username: string;
  }

  interface CrkEnvelopeFromServer {
    id: string;
    emberId: string;
    epoch: number;
    senderUserId: string;
    senderDeviceId: string;
    userId: string;
    deviceId: string;
    encryptedKey: string;
    messageType: number;
  }

  interface CachedCrk {
    emberId: string;
    epoch: number;
    crk: Uint8Array;
  }

  // ── Local CRK cache ────────────────────────────────────────────────────────

  const crkCache = new Map<string, CachedCrk>();

  function cacheKey(emberId: string, epoch: number): string {
    return `${emberId}:${epoch}`;
  }

  // ── Local DM CMK cache ──────────────────────────────────────────────────────

  const dmCmkCache = new Map<string, Uint8Array>();

  interface DmKeyEnvelopeFromServer {
    id: string;
    conversationId: string;
    epoch: number;
    senderUserId: string;
    senderDeviceId: string;
    userId: string;
    deviceId: string;
    encryptedKey: string;
    messageType: number;
  }

  // ── Inline HKDF-SHA256 (no imports needed) ─────────────────────────────────

  function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async function hkdf(
    ikm: Uint8Array,
    salt: Uint8Array | string,
    info: Uint8Array | string,
    length: number
  ): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const saltBytes = typeof salt === 'string' ? enc.encode(salt) : salt;
    const infoBytes = typeof info === 'string' ? enc.encode(info) : info;
    const baseKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(ikm),
      { name: 'HKDF' },
      false,
      ['deriveBits']
    );
    const derived = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: toArrayBuffer(saltBytes),
        info: toArrayBuffer(infoBytes),
      },
      baseKey,
      length * 8
    );
    return new Uint8Array(derived);
  }

  function uint32BE(n: number): Uint8Array {
    const buf = new Uint8Array(4);
    buf[0] = (n >>> 24) & 0xff;
    buf[1] = (n >>> 16) & 0xff;
    buf[2] = (n >>> 8) & 0xff;
    buf[3] = n & 0xff;
    return buf;
  }

  function concat(...arrays: Uint8Array[]): Uint8Array {
    const len = arrays.reduce((s, a) => s + a.length, 0);
    const result = new Uint8Array(len);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  // ── Inline AES-256-GCM ────────────────────────────────────────────────────

  async function aesEncrypt(
    key: Uint8Array,
    plaintext: Uint8Array,
    aad?: Uint8Array
  ): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(key),
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    const params: AesGcmParams = { name: 'AES-GCM', iv: toArrayBuffer(nonce), tagLength: 128 };
    if (aad) params.additionalData = toArrayBuffer(aad);
    const ct = await crypto.subtle.encrypt(params, cryptoKey, toArrayBuffer(plaintext));
    return { ciphertext: new Uint8Array(ct), nonce };
  }

  async function aesDecrypt(
    key: Uint8Array,
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    aad?: Uint8Array
  ): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(key),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const params: AesGcmParams = { name: 'AES-GCM', iv: toArrayBuffer(nonce), tagLength: 128 };
    if (aad) params.additionalData = toArrayBuffer(aad);
    const pt = await crypto.subtle.decrypt(params, cryptoKey, toArrayBuffer(ciphertext));
    return new Uint8Array(pt);
  }

  // ── Key derivation ────────────────────────────────────────────────────────

  const EPOCH_HISTORY_INFO = 'ember-epoch-history-v1';
  const CHANNEL_MSG_INFO = 'ember-channel-msg-v1';
  const DM_MSG_INFO_PREFIX = 'ember-dm-msg-v1';
  const enc = new TextEncoder();

  async function deriveEhk(crk: Uint8Array, epoch: number): Promise<Uint8Array> {
    return hkdf(crk, uint32BE(epoch), EPOCH_HISTORY_INFO, 32);
  }

  async function deriveMessageKey(ehk: Uint8Array): Promise<Uint8Array> {
    // Use sequence 0 — per-message uniqueness from random GCM nonce
    return hkdf(ehk, new Uint8Array(8), CHANNEL_MSG_INFO, 32);
  }

  function buildAad(emberId: string, epoch: number): Uint8Array {
    return concat(enc.encode(emberId), uint32BE(epoch), new Uint8Array(8));
  }

  async function deriveDmMessageKey(cmk: Uint8Array, epoch: number): Promise<Uint8Array> {
    // Fixed salt/info — per-message uniqueness from random GCM nonce (same pattern as channels)
    return hkdf(cmk, uint32BE(epoch), DM_MSG_INFO_PREFIX, 32);
  }

  function buildDmAad(conversationId: string, epoch: number): Uint8Array {
    return concat(enc.encode(conversationId), uint32BE(epoch));
  }

  // ── HistoryCryptoService class ─────────────────────────────────────────────

  class HistoryCryptoService {
    private auth: AuthData;

    constructor(auth: AuthData) {
      this.auth = auth;
    }

    private getBaseUrl(): string {
      return this.auth.hostname.startsWith('http')
        ? this.auth.hostname
        : `https://${this.auth.hostname}`;
    }

    async getCrk(emberId: string, epoch: number): Promise<Uint8Array | null> {
      const cached = crkCache.get(cacheKey(emberId, epoch));
      if (cached) return cached.crk;

      try {
        const response = await fetch(`${this.getBaseUrl()}/api/v1/embers/${emberId}/crk`, {
          headers: { Authorization: `Bearer ${this.auth.token}` },
        });
        if (!response.ok) {
          log.warn('getCrk: server returned non-OK', { emberId, epoch, status: response.status });
          return null;
        }

        const data = (await response.json()) as { envelopes: CrkEnvelopeFromServer[] };
        if (!data.envelopes || data.envelopes.length === 0) {
          log.warn('getCrk: no envelopes from server', { emberId, epoch });
          return null;
        }

        const envelope = data.envelopes.find(e => e.epoch === epoch);
        if (!envelope) return null;

        // Try OS safeStorage first (Signal self-session may not survive re-login)
        try {
          const resp = await (window as any).emberAPI.invoke('GetSafeStorage', {
            key: `crk_${emberId}_${epoch}`,
          });
          if (resp?.success && resp.data?.value) {
            const crkBytes = Uint8Array.from(atob(resp.data.value), c => c.charCodeAt(0));
            if (crkBytes.length === 32) {
              crkCache.set(cacheKey(emberId, epoch), { emberId, epoch, crk: crkBytes });
              return crkBytes;
            }
          }
        } catch {
          /* fall through to Signal decrypt */
        }

        const signalManager = (window as any).App?.signalSessionManager;
        if (!signalManager) return null;

        const ct = Uint8Array.from(atob(envelope.encryptedKey), c => c.charCodeAt(0));
        const crkBytes = await signalManager.decrypt(
          `${envelope.senderUserId}.${envelope.senderDeviceId}`,
          ct,
          envelope.messageType
        );

        if (crkBytes.length !== 32) return null;

        crkCache.set(cacheKey(emberId, epoch), { emberId, epoch, crk: crkBytes });
        return crkBytes;
      } catch (err) {
        log.warn('getCrk: exception', { emberId, epoch, error: (err as Error).message });
        return null;
      }
    }

    async getCurrentEpoch(emberId: string): Promise<number> {
      try {
        const response = await fetch(
          `${this.getBaseUrl()}/api/v1/embers/${emberId}/epochs?limit=1`,
          { headers: { Authorization: `Bearer ${this.auth.token}` } }
        );
        if (!response.ok) return 0;
        const data = (await response.json()) as { epochs?: Array<{ epochNumber: number }> };
        const epochs = data.epochs ?? [];
        return epochs.length > 0 ? epochs[0].epochNumber : 0;
      } catch {
        return 0;
      }
    }

    async encrypt(
      emberId: string,
      plaintext: string
    ): Promise<{ ciphertext: string; nonce: string; epoch: number } | null> {
      const epoch = await this.getCurrentEpoch(emberId);
      const crk = await this.getCrk(emberId, epoch);
      if (!crk) {
        log.warn('encrypt failed: no CRK', { emberId, epoch, cacheSize: crkCache.size });
        return null;
      }

      const ehk = await deriveEhk(crk, epoch);
      const msgKey = await deriveMessageKey(ehk);
      const aad = buildAad(emberId, epoch);
      const plaintextBytes = new TextEncoder().encode(plaintext);
      const result = await aesEncrypt(msgKey, plaintextBytes, aad);

      return {
        ciphertext: btoa(String.fromCharCode(...result.ciphertext)),
        nonce: btoa(String.fromCharCode(...result.nonce)),
        epoch,
      };
    }

    async decrypt(
      emberId: string,
      ciphertextB64: string,
      nonceB64: string,
      epoch: number,
      _messageSequence: number
    ): Promise<string | null> {
      const crk = await this.getCrk(emberId, epoch);
      if (!crk) {
        log.warn('decrypt: getCrk returned null', { emberId, epoch });
        return null;
      }

      try {
        const ehk = await deriveEhk(crk, epoch);
        const msgKey = await deriveMessageKey(ehk);
        const aad = buildAad(emberId, epoch);
        const ct = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
        const nonce = Uint8Array.from(atob(nonceB64), c => c.charCodeAt(0));
        const pt = await aesDecrypt(msgKey, ct, nonce, aad);
        return new TextDecoder().decode(pt);
      } catch {
        return null;
      }
    }

    async createAndDistributeCrk(
      emberId: string,
      deviceMembers: Array<{ userId: string; deviceId: string }>,
      epoch: number = 0
    ): Promise<boolean> {
      try {
        const signalManager = (window as any).App?.signalSessionManager;
        if (!signalManager) {
          log.warn('createAndDistributeCrk: signalSessionManager is null');
          return false;
        }
        log.debug('createAndDistributeCrk: starting', {
          emberId,
          epoch,
          members: deviceMembers.length,
        });

        const crk = crypto.getRandomValues(new Uint8Array(32));
        crkCache.set(cacheKey(emberId, epoch), { emberId, epoch, crk });
        // Persist to OS safeStorage so CRK survives logout/re-login
        try {
          await (window as any).emberAPI.invoke('SetSafeStorage', {
            key: `crk_${emberId}_${epoch}`,
            value: btoa(String.fromCharCode(...crk)),
          });
        } catch {
          /* non-critical — CRK still in memory cache */
        }

        const envelopes = [];
        for (const member of deviceMembers) {
          if (member.userId === this.auth.userId && member.deviceId === this.auth.deviceId)
            continue;
          try {
            await signalManager.ensureSession(member.userId, member.deviceId);
            const address = `${member.userId}.${member.deviceId}`;
            const encrypted = await signalManager.encrypt(address, crk);
            envelopes.push({
              userId: member.userId,
              deviceId: member.deviceId,
              encryptedKey: btoa(String.fromCharCode(...encrypted.ciphertext)),
              messageType: encrypted.messageType,
            });
          } catch {
            // Skip devices we can't reach
          }
        }

        // Also encrypt to self for recovery after re-login
        try {
          const selfAddress = `${this.auth.userId}.${this.auth.deviceId}`;
          await signalManager.ensureSession(this.auth.userId, this.auth.deviceId);
          const selfEncrypted = await signalManager.encrypt(selfAddress, crk);
          envelopes.push({
            userId: this.auth.userId,
            deviceId: this.auth.deviceId,
            encryptedKey: btoa(String.fromCharCode(...selfEncrypted.ciphertext)),
            messageType: selfEncrypted.messageType,
          });
        } catch (selfErr) {
          log.warn('createAndDistributeCrk: self-encrypt failed', {
            error: (selfErr as Error).message,
          });
        }

        log.debug('createAndDistributeCrk: envelopes', { count: envelopes.length });
        if (envelopes.length === 0) {
          log.warn('createAndDistributeCrk: no envelopes to upload, CRK cached locally only');
          return true;
        }

        const response = await fetch(`${this.getBaseUrl()}/api/v1/embers/${emberId}/crk`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.auth.token}`,
          },
          body: JSON.stringify({ epoch, envelopes }),
        });

        return response.ok;
      } catch {
        return false;
      }
    }

    // ── DM CMK Methods ──────────────────────────────────────────────────────

    async getDmCmk(conversationId: string, epoch: number = 0): Promise<Uint8Array | null> {
      const cached = dmCmkCache.get(`${conversationId}:${epoch}`);
      if (cached) return cached;

      try {
        const response = await fetch(`${this.getBaseUrl()}/api/v1/dm/${conversationId}/keys`, {
          headers: { Authorization: `Bearer ${this.auth.token}` },
        });
        if (!response.ok) return null;

        const data = (await response.json()) as { envelopes: DmKeyEnvelopeFromServer[] };
        if (!data.envelopes || data.envelopes.length === 0) return null;

        const envelope = data.envelopes.find(e => e.epoch === epoch);
        if (!envelope) return null;

        const signalManager = (window as any).App?.signalSessionManager;
        if (!signalManager) return null;

        const ct = Uint8Array.from(atob(envelope.encryptedKey), c => c.charCodeAt(0));
        const cmkBytes = await signalManager.decrypt(
          `${envelope.senderUserId}.${envelope.senderDeviceId}`,
          ct,
          envelope.messageType
        );

        if (cmkBytes.length !== 32) return null;

        dmCmkCache.set(`${conversationId}:${epoch}`, cmkBytes);
        return cmkBytes;
      } catch {
        return null;
      }
    }

    async createAndDistributeDmCmk(
      conversationId: string,
      deviceMembers: Array<{ userId: string; deviceId: string }>,
      epoch: number = 0
    ): Promise<boolean> {
      try {
        const signalManager = (window as any).App?.signalSessionManager;
        if (!signalManager) return false;

        const cmk = crypto.getRandomValues(new Uint8Array(32));
        dmCmkCache.set(`${conversationId}:${epoch}`, cmk);

        const envelopes = [];
        for (const member of deviceMembers) {
          try {
            await signalManager.ensureSession(member.userId, member.deviceId);
            const address = `${member.userId}.${member.deviceId}`;
            const encrypted = await signalManager.encrypt(address, cmk);
            envelopes.push({
              userId: member.userId,
              deviceId: member.deviceId,
              encryptedKey: btoa(String.fromCharCode(...encrypted.ciphertext)),
              messageType: encrypted.messageType,
            });
          } catch {
            // Skip unreachable devices
          }
        }

        // Also encrypt to self so we can recover dmCmk after restart
        try {
          const selfAddress = `${this.auth.userId}.${this.auth.deviceId}`;
          const selfEncrypted = await signalManager.encrypt(selfAddress, cmk);
          envelopes.push({
            userId: this.auth.userId,
            deviceId: this.auth.deviceId,
            encryptedKey: btoa(String.fromCharCode(...selfEncrypted.ciphertext)),
            messageType: selfEncrypted.messageType,
          });
        } catch {
          // Self-encryption may fail if no self-session — CMK is still cached locally
        }

        if (envelopes.length === 0) return true;

        const response = await fetch(`${this.getBaseUrl()}/api/v1/dm/${conversationId}/keys`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.auth.token}`,
          },
          body: JSON.stringify({ conversationId, epoch, envelopes }),
        });

        return response.ok;
      } catch {
        return false;
      }
    }

    async encryptDm(
      conversationId: string,
      plaintext: string
    ): Promise<{ ciphertext: string; nonce: string; epoch: number } | null> {
      const epoch = 0;
      const cmk = await this.getDmCmk(conversationId, epoch);
      if (!cmk) return null;

      const msgKey = await deriveDmMessageKey(cmk, epoch);
      const aad = buildDmAad(conversationId, epoch);
      const plaintextBytes = new TextEncoder().encode(plaintext);
      const result = await aesEncrypt(msgKey, plaintextBytes, aad);

      return {
        ciphertext: btoa(String.fromCharCode(...result.ciphertext)),
        nonce: btoa(String.fromCharCode(...result.nonce)),
        epoch,
      };
    }

    async decryptDm(
      conversationId: string,
      ciphertextB64: string,
      nonceB64: string,
      epoch: number,
      _messageSequence: number,
      _senderDeviceId: string
    ): Promise<string | null> {
      const cmk = await this.getDmCmk(conversationId, epoch);
      if (!cmk) return null;

      try {
        const msgKey = await deriveDmMessageKey(cmk, epoch);
        const aad = buildDmAad(conversationId, epoch);
        const ct = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
        const nonce = Uint8Array.from(atob(nonceB64), c => c.charCodeAt(0));
        const pt = await aesDecrypt(msgKey, ct, nonce, aad);
        return new TextDecoder().decode(pt);
      } catch {
        return null;
      }
    }

    // Sync all CRK envelopes for a single ember — decrypts and caches any missing epochs.
    async syncCrksForEmber(emberId: string): Promise<number> {
      try {
        const response = await fetch(`${this.getBaseUrl()}/api/v1/embers/${emberId}/crk`, {
          headers: { Authorization: `Bearer ${this.auth.token}` },
        });
        if (!response.ok) return 0;

        const data = (await response.json()) as { envelopes: CrkEnvelopeFromServer[] };
        if (!data.envelopes || data.envelopes.length === 0) return 0;

        const signalManager = (window as any).App?.signalSessionManager;
        if (!signalManager) return 0;

        let synced = 0;
        for (const envelope of data.envelopes) {
          const key = cacheKey(emberId, envelope.epoch);
          if (crkCache.has(key)) continue;

          try {
            const ct = Uint8Array.from(atob(envelope.encryptedKey), c => c.charCodeAt(0));
            const crkBytes = await signalManager.decrypt(
              `${envelope.senderUserId}.${envelope.senderDeviceId}`,
              ct,
              envelope.messageType
            );
            if (crkBytes.length === 32) {
              crkCache.set(key, { emberId, epoch: envelope.epoch, crk: crkBytes });
              synced++;
            }
          } catch {
            // Skip envelopes we can't decrypt (e.g. from a different sender session)
          }
        }
        return synced;
      } catch {
        return 0;
      }
    }

    // Sync CRK envelopes for all embers the user belongs to.
    // Call on WebSocket reconnect to catch up on missed epoch rotations.
    // Parallelized to avoid slow sequential fetching across many embers.
    async syncAllCrks(): Promise<void> {
      try {
        const embers = await window.fetchEmbers();
        await Promise.allSettled(embers.map(ember => this.syncCrksForEmber(ember.id)));
      } catch {
        // Non-fatal — will be retried on next reconnect or message receive
      }
    }

    // Returns all cached CRK epochs for a given ember (used for re-wrapping to new members).
    getCachedCrkEpochs(emberId: string): Array<{ epoch: number; crk: Uint8Array }> {
      const results: Array<{ epoch: number; crk: Uint8Array }> = [];
      for (const [key, value] of crkCache) {
        if (key.startsWith(`${emberId}:`)) {
          results.push({ epoch: value.epoch, crk: value.crk });
        }
      }
      return results.sort((a, b) => a.epoch - b.epoch);
    }

    // Returns all cached DM CMKs (used for provisioning bundle).
    getCachedDmCmks(): Array<{ conversationId: string; epoch: number; cmk: Uint8Array }> {
      const results: Array<{ conversationId: string; epoch: number; cmk: Uint8Array }> = [];
      for (const [key, cmk] of dmCmkCache) {
        const parts = key.split(':');
        if (parts.length === 2) {
          results.push({
            conversationId: parts[0],
            epoch: parseInt(parts[1], 10),
            cmk,
          });
        }
      }
      return results;
    }

    // Re-wrap all cached CRK epochs for a newly added member's devices.
    // Enables new members to read prior message history.
    async rewrapCrksForNewMember(
      emberId: string,
      newMemberDevices: Array<{ userId: string; deviceId: string }>
    ): Promise<number> {
      const signalManager = (window as any).App?.signalSessionManager;
      if (!signalManager) return 0;

      // First sync to ensure we have all available epochs
      await this.syncCrksForEmber(emberId);
      const epochs = this.getCachedCrkEpochs(emberId);
      if (epochs.length === 0) return 0;

      let rewrapped = 0;
      for (const { epoch, crk } of epochs) {
        const envelopes = [];
        for (const device of newMemberDevices) {
          try {
            await signalManager.ensureSession(device.userId, device.deviceId);
            const address = `${device.userId}.${device.deviceId}`;
            const encrypted = await signalManager.encrypt(address, crk);
            envelopes.push({
              userId: device.userId,
              deviceId: device.deviceId,
              encryptedKey: btoa(String.fromCharCode(...encrypted.ciphertext)),
              messageType: encrypted.messageType,
            });
          } catch {
            // Skip unreachable devices
          }
        }

        if (envelopes.length === 0) continue;

        try {
          const response = await fetch(`${this.getBaseUrl()}/api/v1/embers/${emberId}/crk`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.auth.token}`,
            },
            body: JSON.stringify({ epoch, envelopes }),
          });
          if (response.ok) rewrapped++;
        } catch {
          // Non-fatal — new member won't be able to read this epoch
        }
      }

      return rewrapped;
    }

    // Import a provisioning bundle's keys directly into caches.
    // Called by provisioning-service after decrypting the bundle from the existing device.
    importBundle(bundle: {
      channelKeys: Array<{ emberId: string; epoch: number; crk: string }>;
      dmKeys: Array<{ conversationId: string; epoch: number; cmk: string }>;
    }): void {
      importProvisioningBundle(bundle);
    }

    // Import a CRK directly into the cache, bypassing Signal session decryption.
    // Used by invite-time pre-computation (Strategy B) where the CRK was encrypted
    // with HKDF(invite_code) instead of a Signal session.
    importCrk(emberId: string, epoch: number, crk: Uint8Array): void {
      const key = cacheKey(emberId, epoch);
      crkCache.set(key, { emberId, epoch, crk });
      const b64 = btoa(String.fromCharCode(...crk));
      window.emberAPI
        .invoke('SetSafeStorage', { key: `crk_${emberId}_${epoch}`, value: b64 })
        .catch(() => {
          /* non-critical — in-memory cache is the primary */
        });
    }

    clear(): void {
      crkCache.clear();
      dmCmkCache.clear();
    }
  }

  // ── Replay Protection (inline — shared module can't be imported in renderer IIFE) ──

  const REPLAY_WINDOW_SIZE = 2048;
  const REPLAY_STORAGE_PREFIX = 'ember_replay_';

  interface ReplayChannelState {
    highestSequence: number;
    seen: Set<number>;
  }

  const replayState = new Map<string, ReplayChannelState>();

  function replayKey(conversationId: string, epoch: number, senderDeviceId: string): string {
    return `${conversationId}:${epoch}:${senderDeviceId}`;
  }

  function loadPersistedFloor(key: string): number {
    try {
      const stored = localStorage.getItem(REPLAY_STORAGE_PREFIX + key);
      if (stored !== null) {
        const val = parseInt(stored, 10);
        if (!isNaN(val)) return val;
      }
    } catch {
      // localStorage may be unavailable
    }
    return -1;
  }

  function persistFloor(key: string, highestSequence: number): void {
    try {
      localStorage.setItem(REPLAY_STORAGE_PREFIX + key, String(highestSequence));
    } catch {
      // localStorage may be unavailable
    }
  }

  function removePersistedFloor(key: string): void {
    try {
      localStorage.removeItem(REPLAY_STORAGE_PREFIX + key);
    } catch {
      // ignore
    }
  }

  function acceptMessage(
    conversationId: string,
    epoch: number,
    senderDeviceId: string,
    messageSequence: number
  ): boolean {
    const key = replayKey(conversationId, epoch, senderDeviceId);
    let state = replayState.get(key);

    if (!state) {
      const persisted = loadPersistedFloor(key);
      state = { highestSequence: persisted, seen: new Set() };
      replayState.set(key, state);
    }

    if (state.seen.has(messageSequence)) return false;

    const floor = state.highestSequence - REPLAY_WINDOW_SIZE;
    if (messageSequence < floor) return false;

    state.seen.add(messageSequence);

    if (messageSequence > state.highestSequence) {
      state.highestSequence = messageSequence;
      persistFloor(key, state.highestSequence);
      const newFloor = state.highestSequence - REPLAY_WINDOW_SIZE;
      if (newFloor > 0) {
        for (const seq of state.seen) {
          if (seq < newFloor) state.seen.delete(seq);
        }
      }
    }

    return true;
  }

  function clearReplayStateForConversation(conversationId: string): void {
    for (const key of Array.from(replayState.keys())) {
      if (key.startsWith(`${conversationId}:`)) {
        replayState.delete(key);
        removePersistedFloor(key);
      }
    }
  }

  // Import a provisioning bundle's keys directly into caches.
  // Called by provisioning-service after decrypting the bundle from the existing device.
  function importProvisioningBundle(bundle: {
    channelKeys: Array<{ emberId: string; epoch: number; crk: string }>;
    dmKeys: Array<{ conversationId: string; epoch: number; cmk: string }>;
  }): void {
    for (const ck of bundle.channelKeys) {
      const crk = Uint8Array.from(atob(ck.crk), c => c.charCodeAt(0));
      if (crk.length === 32) {
        crkCache.set(cacheKey(ck.emberId, ck.epoch), {
          emberId: ck.emberId,
          epoch: ck.epoch,
          crk,
        });
      }
    }
    for (const dk of bundle.dmKeys) {
      const cmk = Uint8Array.from(atob(dk.cmk), c => c.charCodeAt(0));
      if (cmk.length === 32) {
        dmCmkCache.set(`${dk.conversationId}:${dk.epoch}`, cmk);
      }
    }
  }

  (window as any).HistoryCryptoService = HistoryCryptoService;
  (window as any).replayProtection = { acceptMessage, clearReplayStateForConversation };
})();
