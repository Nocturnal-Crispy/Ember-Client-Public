import type {
  EmberCmd,
  EmberIpcResponse,
  LoadSessionData,
  LoadIdentityData,
  StoreIdentityData,
  LoadPreKeyData,
  LoadSignedPreKeyData,
  ProcessPreKeyBundleArgs,
  EncryptArgs,
  EncryptData,
  DecryptArgs,
  DecryptData,
  DecryptPreKeyArgs,
  GroupEncryptArgs,
  GroupEncryptData,
  GroupDecryptArgs,
  GroupDecryptData,
  CreateSenderKeyDistributionArgs,
  CreateSenderKeyDistributionData,
  ProcessSenderKeyDistributionArgs,
  GetSafeStorageData,
  ISessionStore,
  IIdentityKeyStore,
  IPreKeyStore,
  ISignedPreKeyStore,
  IKyberPreKeyStore,
  AuthData,
  PreKeyBundle,
} from 'ember-shared';
import { fetchPreKeyBundle } from 'ember-shared';

// ── Constants ─────────────────────────────────────────────────────────────────

const PREKEY_MESSAGE_TYPE = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(s: string): Uint8Array {
  return new Uint8Array(atob(s).split('').map((c) => c.charCodeAt(0)));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}

// ── EmberIpcError ─────────────────────────────────────────────────────────────

export class EmberIpcError extends Error {
  constructor(
    public readonly cmd: EmberCmd,
    message: string,
  ) {
    super(message);
    this.name = 'EmberIpcError';
  }
}

// ── IPC session store ─────────────────────────────────────────────────────────

export class IpcSessionStore implements ISessionStore {
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

export class IpcIdentityKeyStore implements IIdentityKeyStore {
  constructor(private readonly auth: AuthData) {}

  async getIdentityKeyPair(): Promise<{ readonly publicKey: Uint8Array; readonly privateKey: Uint8Array }> {
    const key = `identity_key_${this.auth.user_id}_${this.auth.device_id}`;
    const response = await window.emberAPI.invoke<GetSafeStorageData>('GetSafeStorage', { key });
    if (!response.data?.value) {
      throw new Error('Identity public key not found in secure storage');
    }
    return { publicKey: fromBase64(response.data.value), privateKey: new Uint8Array(0) };
  }

  async getLocalRegistrationId(): Promise<number> {
    const key = `registration_id_${this.auth.user_id}_${this.auth.device_id}`;
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
    _direction: 'sending' | 'receiving',
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

export class IpcPreKeyStore implements IPreKeyStore {
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

export class IpcSignedPreKeyStore implements ISignedPreKeyStore {
  async storeSignedPreKey(id: number, record: Uint8Array): Promise<void> {
    await window.emberAPI.invoke('StoreSignedPreKey', { id, record: toBase64(record) });
  }

  async loadSignedPreKey(id: number): Promise<Uint8Array | null> {
    const response = await window.emberAPI.invoke<LoadSignedPreKeyData>('LoadSignedPreKey', { id });
    return response.data?.record ? fromBase64(response.data.record) : null;
  }

  async removeSignedPreKey(_id: number): Promise<void> {
    // RemoveSignedPreKey is not exposed via IPC — no-op in the renderer
  }
}

// ── IPC Kyber pre-key store stub ──────────────────────────────────────────────

export class IpcKyberPreKeyStore implements IKyberPreKeyStore {
  async loadKyberPreKey(_id: number): Promise<Uint8Array | null> {
    return null;
  }

  async storeKyberPreKey(_id: number, _record: Uint8Array): Promise<void> {
    // Kyber pre-keys are not yet implemented at the IPC layer
  }

  async removeKyberPreKey(_id: number): Promise<void> {
    // Kyber pre-keys are not yet implemented at the IPC layer
  }

  async markKyberPreKeyUsed(_id: number): Promise<void> {
    // Kyber pre-keys are not yet implemented at the IPC layer
  }
}

// ── Signal service ────────────────────────────────────────────────────────────

export class SignalService {
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

  async getLocalDevice(): Promise<{ readonly publicKey: Uint8Array; readonly privateKey: Uint8Array; readonly registrationId: number }> {
    const identityKey = `identity_key_${this.auth.user_id}_${this.auth.device_id}`;
    const identityResponse = await this.invoke<GetSafeStorageData>('GetSafeStorage', { key: identityKey });
    if (!identityResponse.value) {
      throw new Error('Identity key not found in secure storage');
    }

    const registrationKey = `registration_id_${this.auth.user_id}_${this.auth.device_id}`;
    const registrationResponse = await this.invoke<GetSafeStorageData>('GetSafeStorage', { key: registrationKey });
    if (!registrationResponse.value) {
      throw new Error('Registration ID not found in secure storage');
    }

    return {
      publicKey: fromBase64(identityResponse.value),
      privateKey: new Uint8Array(0), // Private key not exposed to renderer
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
    const bundle: PreKeyBundle = await fetchPreKeyBundle(this.auth, userId, deviceId);
    const bundleArgs: ProcessPreKeyBundleArgs = {
      recipientAddress: address,
      registrationId: bundle.registrationId,
      deviceId: bundle.deviceId,
      preKeyId: bundle.preKeyId,
      preKey: bundle.preKey ? toBase64(bundle.preKey) : undefined,
      signedPreKeyId: bundle.signedPreKeyId,
      signedPreKey: toBase64(bundle.signedPreKey),
      signedPreKeySignature: toBase64(bundle.signedPreKeySignature),
      identityKey: toBase64(bundle.identityKey),
    };
    await this.invoke<undefined>('ProcessPreKeyBundle', bundleArgs);
  }

  async encrypt(
    recipientAddress: string,
    plaintext: Uint8Array,
  ): Promise<{ ciphertext: Uint8Array; messageType: number }> {
    const args: EncryptArgs = { recipientAddress, plaintext: toBase64(plaintext) };
    const data = await this.invoke<EncryptData>('Encrypt', args);
    return { ciphertext: fromBase64(data.ciphertext), messageType: data.messageType };
  }

  async decrypt(
    senderAddress: string,
    ciphertext: Uint8Array,
    messageType: number,
  ): Promise<Uint8Array> {
    if (messageType === PREKEY_MESSAGE_TYPE) {
      const args: DecryptPreKeyArgs = { senderAddress, ciphertext: toBase64(ciphertext), messageType };
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
      args,
    );
    return fromBase64(data.distributionMessage);
  }

  async processSenderKeyDistribution(
    senderAddress: string,
    distributionMessage: Uint8Array,
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
