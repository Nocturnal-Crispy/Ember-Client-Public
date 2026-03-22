/**
 * DM Key Service — manages DM Conversation Master Keys (DM_CMK).
 *
 * Key hierarchy for Direct Messages:
 *   DM_CMK (32 bytes, random) → HKDF → message_key → AES-256-GCM
 *
 * The DM_CMK is:
 *   - Generated randomly when a DM conversation is created
 *   - Encrypted to EACH participant's device via Signal sessions
 *   - Stored on the server as encrypted envelopes (server never has plaintext)
 *   - Cached locally after first decryption
 *
 * Message key derivation:
 *   message_key = HKDF-SHA256(
 *     ikm:  DM_CMK,
 *     salt: epoch(4 bytes BE) || message_sequence(8 bytes BE),
 *     info: "ember-dm-msg-v1" || sender_device_id
 *   )
 */

import { hkdfSha256, uint32BE, uint64BE, concatBytes } from './hkdf';
import { aesGcmEncrypt, aesGcmDecrypt } from './aes-gcm';
import type {
  DmConversationMasterKey,
  AesGcmResult,
  StoreDmKeyEnvelopesRequest,
  KeyEnvelope,
} from './history-key-types';

const DM_MSG_INFO_PREFIX = 'ember-dm-msg-v1';
const encoder = new TextEncoder();

// ── Local DM_CMK Cache ─────────────────────────────────────────────────────

const dmCmkCache = new Map<string, DmConversationMasterKey>();

/** Cache key: conversationId:epoch */
function cacheKey(conversationId: string, epoch: number): string {
  return `${conversationId}:${epoch}`;
}

// ── DM_CMK Generation ──────────────────────────────────────────────────────

/**
 * Generate a new DM Conversation Master Key.
 *
 * @param conversationId The DM conversation (ember) ID
 * @param epoch          Epoch number (0 for initial creation)
 * @returns New DM_CMK with 32 random bytes
 */
export function generateDmCmk(conversationId: string, epoch: number = 0): DmConversationMasterKey {
  const cmk: DmConversationMasterKey = {
    conversationId,
    epoch,
    cmk: crypto.getRandomValues(new Uint8Array(32)),
    createdAt: Date.now(),
  };
  dmCmkCache.set(cacheKey(conversationId, epoch), cmk);
  return cmk;
}

// ── Message Key Derivation ─────────────────────────────────────────────────

/**
 * Derive a per-message encryption key from a DM_CMK.
 *
 * @param cmk             The DM Conversation Master Key (32 bytes)
 * @param epoch           Current epoch number
 * @param messageSequence Server-assigned monotonic sequence number
 * @param senderDeviceId  Sender's device ID (binds key to sender)
 * @returns 32-byte AES-256-GCM key
 */
export async function deriveDmMessageKey(
  cmk: Uint8Array,
  epoch: number,
  messageSequence: number,
  senderDeviceId: string
): Promise<Uint8Array> {
  const salt = concatBytes(uint32BE(epoch), uint64BE(messageSequence));
  const info = DM_MSG_INFO_PREFIX + senderDeviceId;
  return hkdfSha256(cmk, salt, info, 32);
}

// ── Encrypt / Decrypt ──────────────────────────────────────────────────────

/**
 * Build Additional Authenticated Data (AAD) binding message metadata to the
 * GCM auth tag. This ensures epoch, sequence, and sender cannot be tampered
 * with without an explicit authentication failure.
 */
function buildDmAad(epoch: number, messageSequence: number, senderDeviceId: string): Uint8Array {
  return concatBytes(uint32BE(epoch), uint64BE(messageSequence), encoder.encode(senderDeviceId));
}

/**
 * Encrypt a DM message using DM_CMK-derived keys.
 *
 * @param cmk             The DM_CMK for this conversation
 * @param plaintext       Message plaintext bytes (serialized MessagePayload)
 * @param epoch           Current epoch number
 * @param messageSequence Server-assigned sequence number
 * @param senderDeviceId  Sender's device ID
 * @returns AES-256-GCM ciphertext and nonce
 */
export async function encryptDmMessage(
  cmk: Uint8Array,
  plaintext: Uint8Array,
  epoch: number,
  messageSequence: number,
  senderDeviceId: string
): Promise<AesGcmResult> {
  const messageKey = await deriveDmMessageKey(cmk, epoch, messageSequence, senderDeviceId);
  const aad = buildDmAad(epoch, messageSequence, senderDeviceId);
  return aesGcmEncrypt(messageKey, plaintext, aad);
}

/**
 * Decrypt a DM message using DM_CMK-derived keys.
 *
 * @param cmk             The DM_CMK for this conversation
 * @param ciphertext      Encrypted message (includes GCM auth tag)
 * @param nonce           12-byte nonce from encryption
 * @param epoch           Epoch number at time of encryption
 * @param messageSequence Sequence number at time of encryption
 * @param senderDeviceId  Sender's device ID
 * @returns Decrypted plaintext bytes
 */
export async function decryptDmMessage(
  cmk: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  epoch: number,
  messageSequence: number,
  senderDeviceId: string
): Promise<Uint8Array> {
  const messageKey = await deriveDmMessageKey(cmk, epoch, messageSequence, senderDeviceId);
  const aad = buildDmAad(epoch, messageSequence, senderDeviceId);
  return aesGcmDecrypt(messageKey, ciphertext, nonce, aad);
}

// ── DM_CMK Distribution ────────────────────────────────────────────────────

/**
 * Build encrypted key envelopes for distributing a DM_CMK to all participant devices.
 *
 * Each device receives the DM_CMK encrypted via their Signal session.
 *
 * @param cmk             The DM_CMK to distribute
 * @param conversationId  Conversation ID
 * @param epoch           Epoch number
 * @param deviceMembers   All participant devices [{userId, deviceId}]
 * @param encryptFn       Function that encrypts bytes via Signal session to a device
 * @returns Request object for the server API
 */
export async function buildDmKeyEnvelopes(
  cmk: Uint8Array,
  conversationId: string,
  epoch: number,
  deviceMembers: ReadonlyArray<{ readonly userId: string; readonly deviceId: string }>,
  encryptFn: (
    recipientAddress: string,
    plaintext: Uint8Array
  ) => Promise<{ ciphertext: Uint8Array; messageType: number }>
): Promise<StoreDmKeyEnvelopesRequest> {
  const envelopes = await Promise.all(
    deviceMembers.map(async member => {
      const address = `${member.userId}.${member.deviceId}`;
      const encrypted = await encryptFn(address, cmk);
      return {
        userId: member.userId,
        deviceId: member.deviceId,
        encryptedKey: Buffer.from(encrypted.ciphertext).toString('base64'),
        messageType: encrypted.messageType,
      };
    })
  );

  return { conversationId, epoch, envelopes };
}

/**
 * Decrypt a DM_CMK envelope received from the server.
 *
 * @param envelope    Encrypted key envelope for this device
 * @param decryptFn   Function that decrypts bytes via Signal session (needs sender address)
 * @returns Decrypted DM_CMK (32 bytes)
 */
export async function decryptDmKeyEnvelope(
  envelope: KeyEnvelope,
  decryptFn: (
    senderAddress: string,
    ciphertext: Uint8Array,
    messageType: number
  ) => Promise<Uint8Array>
): Promise<Uint8Array> {
  const ciphertext = new Uint8Array(Buffer.from(envelope.encryptedKey, 'base64'));
  const cmk = await decryptFn(
    `${envelope.senderUserId}.${envelope.senderDeviceId}`,
    ciphertext,
    envelope.messageType
  );
  if (cmk.length !== 32) {
    throw new Error(`Decrypted DM_CMK must be 32 bytes, got ${cmk.length}`);
  }
  return cmk;
}

// ── Cache Management ───────────────────────────────────────────────────────

/** Store a DM_CMK in the local cache. */
export function cacheDmCmk(cmk: DmConversationMasterKey): void {
  dmCmkCache.set(cacheKey(cmk.conversationId, cmk.epoch), cmk);
}

/** Retrieve a cached DM_CMK, or null if not cached. */
export function getCachedDmCmk(
  conversationId: string,
  epoch: number
): DmConversationMasterKey | null {
  return dmCmkCache.get(cacheKey(conversationId, epoch)) ?? null;
}

/** Clear all cached DM_CMKs (e.g. on logout). */
export function clearDmCmkCache(): void {
  dmCmkCache.clear();
}
