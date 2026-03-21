/**
 * Signal Protocol type definitions for the ember messaging system.
 *
 * These types map directly to Signal Protocol concepts. All key material
 * is stored as raw Uint8Array bytes — never as strings or hex.
 */

/** An Ed25519 identity key pair. publicKey is 33 bytes (type prefix + 32), privateKey is 32 bytes. */
export interface IdentityKeyPair {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

/**
 * A prekey bundle fetched from the server for a remote device.
 * Used to initiate an X3DH session. preKeyId / preKey are optional —
 * omitted when the server has no one-time prekeys left (fallback path).
 */
export interface PreKeyBundle {
  readonly registrationId: number;
  readonly deviceId: number;
  readonly preKeyId?: number;
  readonly preKey?: Uint8Array;
  readonly signedPreKeyId: number;
  readonly signedPreKey: Uint8Array;
  readonly signedPreKeySignature: Uint8Array;
  readonly identityKey: Uint8Array;
}

/** A signed prekey record held locally. Rotated periodically (e.g. every 7 days). */
export interface SignedPreKey {
  readonly id: number;
  readonly keyPair: IdentityKeyPair;
  readonly signature: Uint8Array;
  readonly timestamp: number;
}

/** A one-time prekey record held locally. Consumed once per X3DH session initiation. */
export interface OneTimePreKey {
  readonly id: number;
  readonly keyPair: IdentityKeyPair;
}

/**
 * A sender key distribution message sent to a group member's device.
 * senderId is formatted as "userId:deviceId" (e.g. "user-abc:1").
 * distributionMessage is the serialized Signal SenderKeyDistributionMessage bytes.
 */
export interface SenderKeyDistributionMessage {
  readonly groupId: string;
  readonly senderId: string;
  readonly distributionMessage: Uint8Array;
}

/**
 * A persisted Double Ratchet session state for a remote device.
 * deviceAddress is formatted as "userId:deviceId".
 * serialized is the opaque bytes from libsignal's SessionRecord.serialize().
 */
export interface SessionRecord {
  readonly deviceAddress: string;
  readonly serialized: Uint8Array;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Wire format for an encrypted message exchanged over WebSocket.
 *
 * - 'dm'            — Double Ratchet ciphertext for a 1:1 message
 * - 'preKeyMessage' — X3DH initial message that establishes a new session
 * - 'group'         — Sender Key ciphertext for a group channel message
 */
export interface MessageEnvelope {
  readonly type: 'dm' | 'preKeyMessage' | 'group';
  readonly senderDeviceId: number;
  readonly recipientDeviceId?: number;
  readonly groupId?: string;
  readonly ciphertext: Uint8Array;
  /** Present in preKeyMessage: the ephemeral Curve25519 public key from X3DH. */
  readonly ephemeralKey?: Uint8Array;
  readonly registrationId?: number;
  readonly preKeyId?: number;
  readonly signedPreKeyId?: number;
  readonly timestamp: number;
}

/**
 * The plaintext payload serialized inside a MessageEnvelope's ciphertext.
 * All fields are optional — messages may carry only attachments, only text, etc.
 */
export interface MessagePayload {
  readonly text?: string;
  readonly attachments?: AttachmentMeta[];
  readonly replyToId?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Metadata for an encrypted attachment.
 * key: 32-byte AES-256-GCM key (generated per attachment, never reused).
 * iv:  12-byte GCM initialization vector.
 * hash: 32-byte SHA-256 of the plaintext (integrity check after decryption).
 * url: server-side download URL, populated after upload.
 */
export interface AttachmentMeta {
  readonly id: string;
  readonly mimeType: string;
  readonly size: number;
  readonly key: Uint8Array;
  readonly iv: Uint8Array;
  readonly hash: Uint8Array;
  readonly url?: string;
}
