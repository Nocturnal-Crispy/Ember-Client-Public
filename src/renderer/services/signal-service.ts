// Types from ../../shared are available globally via globals.d.ts
// fetchPreKeyBundle is inlined in ensureSession() to avoid module import

// ── Constants ─────────────────────────────────────────────────────────────────

const PREKEY_MESSAGE_TYPE = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  // Chunked encoding to prevent stack overflow for large payloads
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(s: string): Uint8Array {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}

// ── EmberIpcError ─────────────────────────────────────────────────────────────

class EmberIpcError extends Error {
  constructor(
    public readonly cmd: EmberCmd,
    message: string
  ) {
    super(message);
    this.name = 'EmberIpcError';
  }
}

// ── IPC session store ─────────────────────────────────────────────────────────

class IpcSessionStore implements ISessionStore {
  async storeSession(address: string, record: Uint8Array): Promise<void> {
    await window.emberAPI.invoke('StoreSession', { address, record: toBase64(record) });
  }

  async loadSession(address: string): Promise<Uint8Array | null> {
    const response = await window.emberAPI.invoke<LoadSessionData>('LoadSession', { address });
    return response.data?.record ? fromBase64(response.data.record) : null;
  }

  async getSubDeviceSessions(_name: string): Promise<number[]> {
    return [];
  }

  async removeSession(address: string): Promise<void> {
    await window.emberAPI.invoke('RemoveSession', { address });
  }

  async removeAllSessions(_name: string): Promise<void> {
    // RemoveAllSessions is not exposed via IPC — no-op in the renderer
  }
}

// ── IPC identity key store ────────────────────────────────────────────────────

class IpcIdentityKeyStore implements IIdentityKeyStore {
  constructor(private readonly auth: AuthData) {}

  async getIdentityKeyPair(): Promise<{
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
  }> {
    // Read private key from identity_key_${user_id}_${device_id}
    const privKey = `identity_key_${this.auth.userId}_${this.auth.deviceId}`;
    const privKeyResponse = await window.emberAPI.invoke<GetSafeStorageData>('GetSafeStorage', {
      key: privKey,
    });
    if (!privKeyResponse.data?.value) {
      throw new Error('Identity private key not found in secure storage');
    }

    // Read public key from identity_pubkey_${user_id}_${device_id}
    const pubKey = `identity_pubkey_${this.auth.userId}_${this.auth.deviceId}`;
    const pubKeyResponse = await window.emberAPI.invoke<GetSafeStorageData>('GetSafeStorage', {
      key: pubKey,
    });
    if (!pubKeyResponse.data?.value) {
      throw new Error('Identity public key not found in secure storage');
    }

    return {
      publicKey: fromBase64(pubKeyResponse.data.value),
      privateKey: fromBase64(privKeyResponse.data.value),
    };
  }

  async getLocalRegistrationId(): Promise<number> {
    const key = `registration_id_${this.auth.userId}_${this.auth.deviceId}`;
    const response = await window.emberAPI.invoke<GetSafeStorageData>('GetSafeStorage', { key });
    if (!response.data?.value) {
      throw new Error('Registration ID not found in secure storage');
    }
    return parseInt(response.data.value, 10);
  }

  async saveIdentity(address: string, identityKey: Uint8Array): Promise<boolean> {
    const response = await window.emberAPI.invoke<StoreIdentityData>('StoreIdentity', {
      address,
      identityKey: toBase64(identityKey),
    });
    return response.data?.changed ?? false;
  }

  async isTrustedIdentity(
    address: string,
    identityKey: Uint8Array,
    _direction: 'sending' | 'receiving'
  ): Promise<boolean> {
    const response = await window.emberAPI.invoke<LoadIdentityData>('LoadIdentity', { address });
    const storedBase64 = response.data?.identityKey;
    if (!storedBase64) {
      return true;
    }
    return bytesEqual(fromBase64(storedBase64), identityKey);
  }

  async getIdentity(address: string): Promise<Uint8Array | null> {
    const response = await window.emberAPI.invoke<LoadIdentityData>('LoadIdentity', { address });
    return response.data?.identityKey ? fromBase64(response.data.identityKey) : null;
  }
}

// ── IPC pre-key store ─────────────────────────────────────────────────────────

class IpcPreKeyStore implements IPreKeyStore {
  async storePreKey(id: number, record: Uint8Array): Promise<void> {
    await window.emberAPI.invoke('StorePreKey', { id, record: toBase64(record) });
  }

  async loadPreKey(id: number): Promise<Uint8Array | null> {
    const response = await window.emberAPI.invoke<LoadPreKeyData>('LoadPreKey', { id });
    return response.data?.record ? fromBase64(response.data.record) : null;
  }

  async removePreKey(id: number): Promise<void> {
    await window.emberAPI.invoke('RemovePreKey', { id });
  }
}

// ── IPC signed pre-key store ──────────────────────────────────────────────────

class IpcSignedPreKeyStore implements ISignedPreKeyStore {
  async storeSignedPreKey(id: number, record: Uint8Array): Promise<void> {
    await window.emberAPI.invoke('StoreSignedPreKey', { id, record: toBase64(record) });
  }

  async loadSignedPreKey(id: number): Promise<Uint8Array | null> {
    const response = await window.emberAPI.invoke<LoadSignedPreKeyData>('LoadSignedPreKey', { id });
    return response.data?.record ? fromBase64(response.data.record) : null;
  }

  async removeSignedPreKey(id: number): Promise<void> {
    await window.emberAPI.invoke('RemoveSignedPreKey', { id });
  }
}

// ── IPC Kyber pre-key store stub ──────────────────────────────────────────────

class IpcKyberPreKeyStore implements IKyberPreKeyStore {
  async loadKyberPreKey(id: number): Promise<Uint8Array | null> {
    const response = await window.emberAPI.invoke<LoadKyberPreKeyData>('LoadKyberPreKey', { id });
    return response.data?.record ? fromBase64(response.data.record) : null;
  }

  async storeKyberPreKey(id: number, record: Uint8Array): Promise<void> {
    await window.emberAPI.invoke('StoreKyberPreKey', { id, record: toBase64(record) });
  }

  async markKyberPreKeyUsed(id: number): Promise<void> {
    await window.emberAPI.invoke('MarkKyberPreKeyUsed', { id });
  }

  async removeKyberPreKey(id: number): Promise<void> {
    await window.emberAPI.invoke('RemoveKyberPreKey', { id });
  }
}

// ── Signal service ────────────────────────────────────────────────────────────

class SignalService {
  private readonly auth: AuthData;

  constructor(auth: AuthData) {
    this.auth = auth;
  }

  private async invoke<D>(cmd: EmberCmd, args: object): Promise<D> {
    const response: EmberIpcResponse<D> = await window.emberAPI.invoke<D>(cmd, args);
    if (!response.success) {
      throw new EmberIpcError(cmd, response.error ?? 'Unknown error');
    }
    return response.data as D;
  }

  async getLocalDevice(): Promise<{
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
    readonly registrationId: number;
  }> {
    // Read private key from identity_key_${user_id}_${device_id}
    const identityKey = `identity_key_${this.auth.userId}_${this.auth.deviceId}`;
    const identityResponse = await this.invoke<GetSafeStorageData>('GetSafeStorage', {
      key: identityKey,
    });
    if (!identityResponse.value) {
      throw new Error('Identity private key not found in secure storage');
    }

    // Read public key from identity_pubkey_${user_id}_${device_id}
    const identityPubKey = `identity_pubkey_${this.auth.userId}_${this.auth.deviceId}`;
    const identityPubResponse = await this.invoke<GetSafeStorageData>('GetSafeStorage', {
      key: identityPubKey,
    });
    if (!identityPubResponse.value) {
      throw new Error('Identity public key not found in secure storage');
    }

    const registrationKey = `registration_id_${this.auth.userId}_${this.auth.deviceId}`;
    const registrationResponse = await this.invoke<GetSafeStorageData>('GetSafeStorage', {
      key: registrationKey,
    });
    if (!registrationResponse.value) {
      throw new Error('Registration ID not found in secure storage');
    }

    return {
      publicKey: fromBase64(identityPubResponse.value),
      privateKey: fromBase64(identityResponse.value),
      registrationId: parseInt(registrationResponse.value, 10),
    };
  }

  async hasSession(userId: string, deviceId: string): Promise<boolean> {
    const address = `${userId}.${deviceId}`;
    const sessionData = await this.invoke<LoadSessionData>('LoadSession', { address });
    return sessionData.record !== null;
  }

  async ensureSession(userId: string, deviceId: string): Promise<void> {
    const address = `${userId}.${deviceId}`;
    const sessionData = await this.invoke<LoadSessionData>('LoadSession', { address });
    if (sessionData.record !== null) {
      return;
    }
    // Inline fetchPreKeyBundle — server returns base64-encoded keys
    const bundleResp = await fetch(
      `${this.auth.hostname}/api/v1/users/${userId}/devices/${deviceId}/prekey-bundle`,
      { headers: { Authorization: `Bearer ${this.auth.token}` } }
    );
    if (!bundleResp.ok) throw new Error(`Failed to fetch prekey bundle: ${bundleResp.status}`);
    const bd = await bundleResp.json();
    // Server returns base64 strings — pass directly to IPC (no double-convert)
    const bundleArgs: ProcessPreKeyBundleArgs = {
      recipientAddress: address,
      registrationId: bd.registrationId,
      deviceId: bd.signedPreKey?.deviceId,
      preKeyId: bd.oneTimePreKey?.id,
      preKey: bd.oneTimePreKey?.publicKey,
      signedPreKeyId: bd.signedPreKey?.id,
      signedPreKey: bd.signedPreKey?.publicKey,
      signedPreKeySignature: bd.signedPreKey?.signature,
      identityKey: bd.identityKey,
    };
    await this.invoke<undefined>('ProcessPreKeyBundle', bundleArgs);
  }

  async encrypt(
    recipientAddress: string,
    plaintext: Uint8Array
  ): Promise<{ ciphertext: Uint8Array; messageType: number }> {
    const args: EncryptArgs = { recipientAddress, plaintext: toBase64(plaintext) };
    const data = await this.invoke<EncryptData>('Encrypt', args);
    return { ciphertext: fromBase64(data.ciphertext), messageType: data.messageType };
  }

  async decrypt(
    senderAddress: string,
    ciphertext: Uint8Array,
    messageType: number
  ): Promise<Uint8Array> {
    if (messageType === PREKEY_MESSAGE_TYPE) {
      const args: DecryptPreKeyArgs = {
        senderAddress,
        ciphertext: toBase64(ciphertext),
        messageType,
      };
      const data = await this.invoke<DecryptData>('DecryptPreKey', args);
      return fromBase64(data.plaintext);
    }
    const args: DecryptArgs = { senderAddress, ciphertext: toBase64(ciphertext) };
    const data = await this.invoke<DecryptData>('Decrypt', args);
    return fromBase64(data.plaintext);
  }

  async groupEncrypt(distributionId: string, plaintext: Uint8Array): Promise<Uint8Array> {
    const args: GroupEncryptArgs = { distributionId, plaintext: toBase64(plaintext) };
    const data = await this.invoke<GroupEncryptData>('GroupEncrypt', args);
    return fromBase64(data.ciphertext);
  }

  async groupDecrypt(senderAddress: string, ciphertext: Uint8Array): Promise<Uint8Array> {
    const args: GroupDecryptArgs = { senderAddress, ciphertext: toBase64(ciphertext) };
    const data = await this.invoke<GroupDecryptData>('GroupDecrypt', args);
    return fromBase64(data.plaintext);
  }

  async createSenderKeyDistribution(distributionId: string): Promise<Uint8Array> {
    const args: CreateSenderKeyDistributionArgs = { distributionId };
    const data = await this.invoke<CreateSenderKeyDistributionData>(
      'CreateSenderKeyDistribution',
      args
    );
    return fromBase64(data.distributionMessage);
  }

  async processSenderKeyDistribution(
    senderAddress: string,
    distributionMessage: Uint8Array
  ): Promise<void> {
    const args: ProcessSenderKeyDistributionArgs = {
      senderAddress,
      distributionMessage: toBase64(distributionMessage),
    };
    await this.invoke<undefined>('ProcessSenderKeyDistribution', args);
  }
}

// Export globally for script loading compatibility
(window as any).SignalService = SignalService;
(window as any).IpcSessionStore = IpcSessionStore;
(window as any).IpcIdentityKeyStore = IpcIdentityKeyStore;
(window as any).IpcPreKeyStore = IpcPreKeyStore;
(window as any).IpcSignedPreKeyStore = IpcSignedPreKeyStore;
(window as any).IpcKyberPreKeyStore = IpcKyberPreKeyStore;
(window as any).EmberIpcError = EmberIpcError;
