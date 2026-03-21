/**
 * IPC type contracts for Ember's Signal Protocol integration.
 *
 * All types cross the Electron IPC boundary (main process ↔ renderer).
 * Rules enforced here:
 *  - All fields are `readonly` (immutable at the IPC boundary)
 *  - Binary data is represented as `string` (base64) — NEVER `Uint8Array`
 *  - No `any` types
 *
 * @module ember-ipc-types
 */

// ── Command union ────────────────────────────────────────────────────────────

/**
 * Exhaustive union of every valid IPC command name.
 * Organised by domain: Auth, Logging, Signal store, Signal crypto.
 */
export type EmberCmd =
  // Auth / device identity
  | 'GetAuth'
  | 'GetSafeStorage'
  | 'SetSafeStorage'
  | 'DeleteSafeStorage'
  // Logging
  | 'Log'
  // Signal store operations
  | 'StoreSession'
  | 'LoadSession'
  | 'RemoveSession'
  | 'StoreIdentity'
  | 'LoadIdentity'
  | 'StorePreKey'
  | 'LoadPreKey'
  | 'RemovePreKey'
  | 'StoreSignedPreKey'
  | 'LoadSignedPreKey'
  | 'StoreSenderKey'
  | 'LoadSenderKey'
  | 'StoreDistributionId'
  | 'LoadDistributionId'
  | 'StoreLegacyEmberKey'
  | 'LoadLegacyEmberKey'
  // Signal crypto operations (main process only)
  | 'ProcessPreKeyBundle'
  | 'Encrypt'
  | 'DecryptPreKey'
  | 'Decrypt'
  | 'GroupEncrypt'
  | 'GroupDecrypt'
  | 'CreateSenderKeyDistribution'
  | 'ProcessSenderKeyDistribution'
  // Signed pre-key removal
  | 'RemoveSignedPreKey'
  // Kyber pre-key operations
  | 'LoadKyberPreKey'
  | 'StoreKyberPreKey'
  | 'MarkKyberPreKeyUsed'
  | 'RemoveKyberPreKey';

// ── Envelope types ───────────────────────────────────────────────────────────

/**
 * Generic IPC request envelope sent from the renderer to the main process.
 *
 * @template A - Shape of the command-specific arguments object.
 */
export interface EmberIpcMessage<
  A extends object = Record<string, unknown>
> {
  readonly cmd: EmberCmd;
  readonly args: A;
}

/**
 * Generic IPC response envelope returned from the main process.
 *
 * @template D - Shape of the command-specific data object on success.
 */
export interface EmberIpcResponse<D = unknown> {
  readonly success: boolean;
  /** Present on success. */
  readonly data?: D;
  /** Present on failure. Must not contain key material. */
  readonly error?: string;
}

// ── Auth domain ──────────────────────────────────────────────────────────────

/** Args for the `GetAuth` command. No parameters required. */
export interface GetAuthArgs {}

/** Data returned by the `GetAuth` command. */
export interface GetAuthData {
  readonly token: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly hostname: string;
  readonly username: string;
}

/** Args for the `GetSafeStorage` command. */
export interface GetSafeStorageArgs {
  readonly key: string;
}

/** Data returned by the `GetSafeStorage` command. */
export interface GetSafeStorageData {
  readonly value: string | null;
}

/** Args for the `SetSafeStorage` command. */
export interface SetSafeStorageArgs {
  readonly key: string;
  readonly value: string;
}
// SetSafeStorage returns void — no data type needed.

/** Args for the `DeleteSafeStorage` command. */
export interface DeleteSafeStorageArgs {
  readonly key: string;
}
// DeleteSafeStorage returns void.

// ── Logging domain ───────────────────────────────────────────────────────────

/** Args for the `Log` command. */
export interface LogArgs {
  readonly level: string;
  readonly context: string;
  readonly message: string;
  /** Optional JSON-stringified extra data. */
  readonly data?: string;
}
// Log returns void.

// ── Signal store domain ──────────────────────────────────────────────────────
// All binary fields (session records, key material, etc.) are base64 strings
// at the IPC boundary. The main process converts them to/from Uint8Array.

/** Args for the `StoreSession` command. `record` is a base64 serialised session. */
export interface StoreSessionArgs {
  readonly address: string;
  readonly record: string;
}

/** Args for the `LoadSession` command. */
export interface LoadSessionArgs {
  readonly address: string;
}

/** Data returned by the `LoadSession` command. */
export interface LoadSessionData {
  readonly record: string | null;
}

/** Args for the `RemoveSession` command. */
export interface RemoveSessionArgs {
  readonly address: string;
}

/** Args for the `StoreIdentity` command. `identityKey` is a base64 public key. */
export interface StoreIdentityArgs {
  readonly address: string;
  readonly identityKey: string;
}

/** Data returned by the `StoreIdentity` command. */
export interface StoreIdentityData {
  readonly changed: boolean;
}

/** Args for the `LoadIdentity` command. */
export interface LoadIdentityArgs {
  readonly address: string;
}

/** Data returned by the `LoadIdentity` command. */
export interface LoadIdentityData {
  readonly identityKey: string | null;
}

/** Args for the `StorePreKey` command. `record` is a base64 serialised pre-key. */
export interface StorePreKeyArgs {
  readonly id: number;
  readonly record: string;
}

/** Args for the `LoadPreKey` command. */
export interface LoadPreKeyArgs {
  readonly id: number;
}

/** Data returned by the `LoadPreKey` command. */
export interface LoadPreKeyData {
  readonly record: string | null;
}

/** Args for the `RemovePreKey` command. */
export interface RemovePreKeyArgs {
  readonly id: number;
}

/** Args for the `StoreSignedPreKey` command. `record` is a base64 serialised signed pre-key. */
export interface StoreSignedPreKeyArgs {
  readonly id: number;
  readonly record: string;
}

/** Args for the `LoadSignedPreKey` command. */
export interface LoadSignedPreKeyArgs {
  readonly id: number;
}

/** Data returned by the `LoadSignedPreKey` command. */
export interface LoadSignedPreKeyData {
  readonly record: string | null;
}

/** Args for the `StoreSenderKey` command. `record` is a base64 serialised sender key. */
export interface StoreSenderKeyArgs {
  readonly address: string;
  readonly distributionId: string;
  readonly record: string;
}

/** Args for the `LoadSenderKey` command. */
export interface LoadSenderKeyArgs {
  readonly address: string;
  readonly distributionId: string;
}

/** Data returned by the `LoadSenderKey` command. */
export interface LoadSenderKeyData {
  readonly record: string | null;
}

/** Args for the `StoreDistributionId` command. */
export interface StoreDistributionIdArgs {
  readonly address: string;
  readonly distributionId: string;
}

/** Args for the `LoadDistributionId` command. */
export interface LoadDistributionIdArgs {
  readonly address: string;
}

/** Data returned by the `LoadDistributionId` command. */
export interface LoadDistributionIdData {
  readonly distributionId: string | null;
}

/** Args for the `StoreLegacyEmberKey` command. `key` is a base64 symmetric key. */
export interface StoreLegacyEmberKeyArgs {
  readonly emberId: string;
  readonly key: string;
}

/** Args for the `LoadLegacyEmberKey` command. */
export interface LoadLegacyEmberKeyArgs {
  readonly emberId: string;
}

/** Data returned by the `LoadLegacyEmberKey` command. */
export interface LoadLegacyEmberKeyData {
  readonly key: string | null;
}

// ── Signal crypto domain ─────────────────────────────────────────────────────
// All public-key and ciphertext fields are base64 strings at the IPC boundary.

/**
 * Args for the `ProcessPreKeyBundle` command.
 * All key material is base64-encoded Curve25519/Ed25519 public keys.
 */
export interface ProcessPreKeyBundleArgs {
  readonly recipientAddress: string;
  readonly registrationId: number;
  readonly deviceId: number;
  /** Optional one-time pre-key id. */
  readonly preKeyId?: number;
  /** Optional one-time pre-key — base64 Curve25519 public key. */
  readonly preKey?: string;
  readonly signedPreKeyId: number;
  /** base64 Curve25519 public key. */
  readonly signedPreKey: string;
  /** base64 Ed25519 signature over the signed pre-key. */
  readonly signedPreKeySignature: string;
  /** base64 identity key. */
  readonly identityKey: string;
}
// ProcessPreKeyBundle returns void.

/** Args for the `Encrypt` command. `plaintext` is base64-encoded. */
export interface EncryptArgs {
  readonly recipientAddress: string;
  /** base64 plaintext bytes. */
  readonly plaintext: string;
}

/** Data returned by the `Encrypt` command. */
export interface EncryptData {
  /** base64 ciphertext bytes. */
  readonly ciphertext: string;
  /** Signal message type (1 = WhisperMessage, 3 = PreKeyWhisperMessage). */
  readonly messageType: number;
}

/** Args for the `DecryptPreKey` command. `ciphertext` is base64-encoded. */
export interface DecryptPreKeyArgs {
  readonly senderAddress: string;
  /** base64 ciphertext bytes. */
  readonly ciphertext: string;
  readonly messageType: number;
}

/** Data returned by both `DecryptPreKey` and `Decrypt` commands. */
export interface DecryptData {
  /** base64 plaintext bytes. */
  readonly plaintext: string;
}

/** Args for the `Decrypt` command. `ciphertext` is base64-encoded. */
export interface DecryptArgs {
  readonly senderAddress: string;
  /** base64 ciphertext bytes. */
  readonly ciphertext: string;
}

/** Args for the `GroupEncrypt` command. `plaintext` is base64-encoded. */
export interface GroupEncryptArgs {
  readonly distributionId: string;
  /** base64 plaintext bytes. */
  readonly plaintext: string;
}

/** Data returned by the `GroupEncrypt` command. */
export interface GroupEncryptData {
  /** base64 ciphertext bytes. */
  readonly ciphertext: string;
}

/** Args for the `GroupDecrypt` command. `ciphertext` is base64-encoded. */
export interface GroupDecryptArgs {
  readonly senderAddress: string;
  /** base64 ciphertext bytes. */
  readonly ciphertext: string;
}

/** Data returned by the `GroupDecrypt` command. */
export interface GroupDecryptData {
  /** base64 plaintext bytes. */
  readonly plaintext: string;
}

/** Args for the `CreateSenderKeyDistribution` command. */
export interface CreateSenderKeyDistributionArgs {
  readonly distributionId: string;
}

/** Data returned by the `CreateSenderKeyDistribution` command. */
export interface CreateSenderKeyDistributionData {
  /** base64 serialised SenderKeyDistributionMessage. */
  readonly distributionMessage: string;
}

/** Args for the `ProcessSenderKeyDistribution` command. */
export interface ProcessSenderKeyDistributionArgs {
  readonly senderAddress: string;
  /** base64 serialised SenderKeyDistributionMessage. */
  readonly distributionMessage: string;
}
// ProcessSenderKeyDistribution returns void.

/** Args for the `RemoveSignedPreKey` command. */
export interface RemoveSignedPreKeyArgs {
  readonly id: number;
}

/** Args for the `LoadKyberPreKey` command. */
export interface LoadKyberPreKeyArgs {
  readonly id: number;
}

/** Data returned by the `LoadKyberPreKey` command. */
export interface LoadKyberPreKeyData {
  readonly record: string | null;
}

/** Args for the `StoreKyberPreKey` command. `record` is a base64 serialised Kyber pre-key. */
export interface StoreKyberPreKeyArgs {
  readonly id: number;
  readonly record: string;
}

/** Args for the `MarkKyberPreKeyUsed` command. */
export interface MarkKyberPreKeyUsedArgs {
  readonly id: number;
}

/** Args for the `RemoveKyberPreKey` command. */
export interface RemoveKyberPreKeyArgs {
  readonly id: number;
}
