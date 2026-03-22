/**
 * Type definitions for the Encrypted Message History layer (Layer 2).
 *
 * Layer 1 (Signal Protocol) handles transport encryption.
 * Layer 2 (these types) enables reading old messages via derived history keys.
 *
 * Key hierarchy:
 *   DM:      DM_CMK → HKDF → message_key → AES-256-GCM
 *   Channel: CRK → HKDF → EHK_epoch → HKDF → message_key → AES-256-GCM
 */

// ── DM Keys ────────────────────────────────────────────────────────────────

/** DM Conversation Master Key — one per DM conversation, randomly generated. */
export interface DmConversationMasterKey {
  readonly conversationId: string;
  readonly epoch: number;
  readonly cmk: Uint8Array;
  readonly createdAt: number;
}

// ── Channel Keys ───────────────────────────────────────────────────────────

/** Channel Root Key — one per ember per epoch, regenerated on membership change. */
export interface ChannelRootKey {
  readonly emberId: string;
  readonly epoch: number;
  readonly crk: Uint8Array;
  readonly createdAt: number;
}

/** Epoch History Key — derived from CRK via HKDF, one per epoch. */
export interface EpochHistoryKey {
  readonly emberId: string;
  readonly epoch: number;
  readonly ehk: Uint8Array;
}

// ── Key Envelopes (server-stored, encrypted per-device) ────────────────────

/** An encrypted key envelope stored on the server for a specific device. */
export interface KeyEnvelope {
  readonly id: string;
  readonly senderUserId: string;
  readonly senderDeviceId: string;
  readonly targetUserId: string;
  readonly targetDeviceId: string;
  readonly encryptedKey: string;
  readonly messageType: number;
  readonly createdAt: number;
}

/** Request to store DM_CMK envelopes for all participant devices. */
export interface StoreDmKeyEnvelopesRequest {
  readonly conversationId: string;
  readonly epoch: number;
  readonly envelopes: ReadonlyArray<{
    readonly userId: string;
    readonly deviceId: string;
    readonly encryptedKey: string;
    readonly messageType: number;
  }>;
}

/** Request to store CRK envelopes for all member devices. */
export interface StoreCrkEnvelopesRequest {
  readonly emberId: string;
  readonly epoch: number;
  readonly envelopes: ReadonlyArray<{
    readonly userId: string;
    readonly deviceId: string;
    readonly encryptedKey: string;
    readonly messageType: number;
  }>;
}

// ── Device Provisioning ────────────────────────────────────────────────────

/** Key bundle transferred from a trusted device to a new device. */
export interface ProvisioningBundle {
  readonly dmKeys: ReadonlyArray<{
    readonly conversationId: string;
    readonly epoch: number;
    readonly cmk: string;
  }>;
  readonly channelKeys: ReadonlyArray<{
    readonly emberId: string;
    readonly epoch: number;
    readonly crk: string;
  }>;
  readonly metadata: {
    readonly provisionedAt: number;
    readonly sourceDeviceId: string;
  };
}

/** Device provisioning request stored on server. */
export interface DeviceProvisioningRequest {
  readonly id: string;
  readonly userId: string;
  readonly newDeviceId: string;
  readonly requestingDeviceId: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'completed';
  readonly createdAt: number;
  readonly completedAt?: number;
}

// ── Enhanced Message Format ────────────────────────────────────────────────

/** Encrypted message with full Layer 2 metadata. */
export interface EncryptedHistoryMessage {
  readonly messageId: string;
  readonly conversationId: string;
  readonly senderUserId: string;
  readonly senderDeviceId: string;
  readonly epoch: number;
  readonly messageSequence: number;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly envelopeType: 'dm' | 'channel';
}

/** Append-only event for message mutations. */
export interface MessageEvent {
  readonly eventId: string;
  readonly targetMessageId: string;
  readonly eventType: 'edit' | 'delete' | 'reaction';
  readonly senderUserId: string;
  readonly senderDeviceId: string;
  readonly epoch: number;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly createdAt: number;
}

// ── AES-256-GCM Result ─────────────────────────────────────────────────────

/** Result of AES-256-GCM encryption. */
export interface AesGcmResult {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
}
