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
        if (!response.ok) return null;

        const data = (await response.json()) as { envelopes: CrkEnvelopeFromServer[] };
        if (!data.envelopes || data.envelopes.length === 0) return null;

        const envelope = data.envelopes.find(e => e.epoch === epoch);
        if (!envelope) return null;

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
      } catch {
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
        const data = (await response.json()) as { epochs?: Array<{ epoch_number: number }> };
        const epochs = data.epochs ?? [];
        return epochs.length > 0 ? epochs[0].epoch_number : 0;
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
      if (!crk) return null;

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
      if (!crk) return null;

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
        if (!signalManager) return false;

        const crk = crypto.getRandomValues(new Uint8Array(32));
        crkCache.set(cacheKey(emberId, epoch), { emberId, epoch, crk });

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

        // Also encrypt to self
        try {
          const selfAddress = `${this.auth.userId}.${this.auth.deviceId}`;
          const selfEncrypted = await signalManager.encrypt(selfAddress, crk);
          envelopes.push({
            userId: this.auth.userId,
            deviceId: this.auth.deviceId,
            encryptedKey: btoa(String.fromCharCode(...selfEncrypted.ciphertext)),
            messageType: selfEncrypted.messageType,
          });
        } catch {
          // Self-encryption may fail if no self-session exists — CRK is still cached locally
        }

        if (envelopes.length === 0) return true; // CRK cached locally, no envelopes to upload

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

    clear(): void {
      crkCache.clear();
    }
  }

  (window as any).HistoryCryptoService = HistoryCryptoService;
})();
