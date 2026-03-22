/**
 * Channel Key Service — manages Channel Root Keys (CRK) and Epoch History Keys (EHK).
 *
 * Key hierarchy for Channels/Groups:
 *   CRK (32 bytes, random per epoch) → HKDF → EHK_epoch → HKDF → message_key → AES-256-GCM
 *
 * The CRK is:
 *   - Generated randomly at ember creation and on each epoch rotation
 *   - Encrypted to EACH member device via Signal sessions
 *   - Stored on the server as encrypted envelopes (server never has plaintext)
 *   - Rotated on: member add, member remove, device remove, permission change
 *
 * Epoch rotation guarantees:
 *   - Removed members lose access to future messages (no new CRK)
 *   - Old messages remain readable with previous epoch's CRK
 *   - New members get CRK for current epoch only (no backward access by default)
 */

import { hkdfSha256, uint32BE, uint64BE, concatBytes } from './hkdf';
import { aesGcmEncrypt, aesGcmDecrypt } from './aes-gcm';

const encoder = new TextEncoder();
import type {
  ChannelRootKey,
  EpochHistoryKey,
  AesGcmResult,
  StoreCrkEnvelopesRequest,
  KeyEnvelope,
} from './history-key-types';

// Domain-separation info strings (RFC 5869: info = context/application-specific)
const EPOCH_HISTORY_INFO = 'ember-epoch-history-v1';
const CHANNEL_MSG_INFO = 'ember-channel-msg-v1';

// ── Local Key Caches ───────────────────────────────────────────────────────

const crkCache = new Map<string, ChannelRootKey>();
const ehkCache = new Map<string, EpochHistoryKey>();

function crkCacheKey(emberId: string, epoch: number): string {
  return `${emberId}:${epoch}`;
}

// ── CRK Generation ─────────────────────────────────────────────────────────

/**
 * Generate a new Channel Root Key for an epoch rotation.
 *
 * @param emberId Ember (server/group) ID
 * @param epoch   New epoch number
 * @returns New CRK with 32 random bytes
 */
export function generateCrk(emberId: string, epoch: number): ChannelRootKey {
  const crk: ChannelRootKey = {
    emberId,
    epoch,
    crk: crypto.getRandomValues(new Uint8Array(32)),
    createdAt: Date.now(),
  };
  crkCache.set(crkCacheKey(emberId, epoch), crk);
  return crk;
}

// ── Key Derivation Chain ───────────────────────────────────────────────────

/**
 * Derive an Epoch History Key from a CRK.
 *
 * Per RFC 5869: salt = variable data, info = domain-separation string.
 *   EHK = HKDF-SHA256(ikm: CRK, salt: epoch_number(4B BE), info: "ember-epoch-history-v1")
 *
 * @param crk   Channel Root Key (32 bytes)
 * @param epoch Epoch number
 * @returns 32-byte Epoch History Key
 */
export async function deriveEhk(
  crk: Uint8Array,
  emberId: string,
  epoch: number
): Promise<EpochHistoryKey> {
  const key = crkCacheKey(emberId, epoch);
  const cached = ehkCache.get(key);
  if (cached) return cached;

  const ehkBytes = await hkdfSha256(crk, uint32BE(epoch), EPOCH_HISTORY_INFO, 32);

  const ehk: EpochHistoryKey = { emberId, epoch, ehk: ehkBytes };
  ehkCache.set(key, ehk);
  return ehk;
}

/**
 * Derive a per-message encryption key from an EHK.
 *
 * Per RFC 5869: salt = variable data, info = domain-separation string.
 *   message_key = HKDF-SHA256(ikm: EHK, salt: sequence(8B BE), info: "ember-channel-msg-v1")
 *
 * @param ehk             Epoch History Key (32 bytes)
 * @param messageSequence Server-assigned monotonic sequence number
 * @returns 32-byte AES-256-GCM key
 */
export async function deriveChannelMessageKey(
  ehk: Uint8Array,
  messageSequence: number
): Promise<Uint8Array> {
  return hkdfSha256(ehk, uint64BE(messageSequence), CHANNEL_MSG_INFO, 32);
}

// ── Encrypt / Decrypt ──────────────────────────────────────────────────────

/**
 * Build Additional Authenticated Data (AAD) binding message metadata to the
 * GCM auth tag. Ensures emberId, epoch, and sequence cannot be tampered
 * with without an explicit authentication failure.
 */
function buildChannelAad(emberId: string, epoch: number, messageSequence: number): Uint8Array {
  return concatBytes(encoder.encode(emberId), uint32BE(epoch), uint64BE(messageSequence));
}

/**
 * Encrypt a channel message using CRK-derived keys.
 *
 * @param crk             The CRK for the current epoch
 * @param emberId         Ember ID
 * @param plaintext       Message plaintext bytes
 * @param epoch           Current epoch number
 * @param messageSequence Server-assigned sequence number
 * @returns AES-256-GCM ciphertext and nonce
 */
export async function encryptChannelMessage(
  crk: Uint8Array,
  emberId: string,
  plaintext: Uint8Array,
  epoch: number,
  messageSequence: number
): Promise<AesGcmResult> {
  const ehk = await deriveEhk(crk, emberId, epoch);
  const messageKey = await deriveChannelMessageKey(ehk.ehk, messageSequence);
  const aad = buildChannelAad(emberId, epoch, messageSequence);
  return aesGcmEncrypt(messageKey, plaintext, aad);
}

/**
 * Decrypt a channel message using CRK-derived keys.
 *
 * @param crk             The CRK for the message's epoch
 * @param emberId         Ember ID
 * @param ciphertext      Encrypted message (includes GCM auth tag)
 * @param nonce           12-byte nonce
 * @param epoch           Epoch at time of encryption
 * @param messageSequence Sequence at time of encryption
 * @returns Decrypted plaintext bytes
 */
export async function decryptChannelMessage(
  crk: Uint8Array,
  emberId: string,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  epoch: number,
  messageSequence: number
): Promise<Uint8Array> {
  const ehk = await deriveEhk(crk, emberId, epoch);
  const messageKey = await deriveChannelMessageKey(ehk.ehk, messageSequence);
  const aad = buildChannelAad(emberId, epoch, messageSequence);
  return aesGcmDecrypt(messageKey, ciphertext, nonce, aad);
}

// ── CRK Distribution ──────────────────────────────────────────────────────

/**
 * Build encrypted key envelopes for distributing a CRK to all member devices.
 *
 * @param crk            The CRK to distribute (32 bytes)
 * @param emberId        Ember ID
 * @param epoch          Epoch number
 * @param deviceMembers  All member devices [{userId, deviceId}]
 * @param encryptFn      Signal session encryption function
 * @returns Request object for the server API
 */
export async function buildCrkEnvelopes(
  crk: Uint8Array,
  emberId: string,
  epoch: number,
  deviceMembers: ReadonlyArray<{ readonly userId: string; readonly deviceId: string }>,
  encryptFn: (
    recipientAddress: string,
    plaintext: Uint8Array
  ) => Promise<{ ciphertext: Uint8Array; messageType: number }>
): Promise<StoreCrkEnvelopesRequest> {
  const envelopes = await Promise.all(
    deviceMembers.map(async member => {
      const address = `${member.userId}.${member.deviceId}`;
      const encrypted = await encryptFn(address, crk);
      return {
        userId: member.userId,
        deviceId: member.deviceId,
        encryptedKey: Buffer.from(encrypted.ciphertext).toString('base64'),
        messageType: encrypted.messageType,
      };
    })
  );

  return { emberId, epoch, envelopes };
}

/**
 * Decrypt a CRK envelope received from the server.
 *
 * @param envelope   Encrypted key envelope for this device
 * @param decryptFn  Signal session decryption function (needs sender address)
 * @returns Decrypted CRK (32 bytes)
 */
export async function decryptCrkEnvelope(
  envelope: KeyEnvelope,
  decryptFn: (
    senderAddress: string,
    ciphertext: Uint8Array,
    messageType: number
  ) => Promise<Uint8Array>
): Promise<Uint8Array> {
  const ciphertext = new Uint8Array(Buffer.from(envelope.encryptedKey, 'base64'));
  const crk = await decryptFn(
    `${envelope.senderUserId}.${envelope.senderDeviceId}`,
    ciphertext,
    envelope.messageType
  );
  if (crk.length !== 32) {
    throw new Error(`Decrypted CRK must be 32 bytes, got ${crk.length}`);
  }
  return crk;
}

// ── Cache Management ───────────────────────────────────────────────────────

/** Store a CRK in the local cache. */
export function cacheCrk(crk: ChannelRootKey): void {
  crkCache.set(crkCacheKey(crk.emberId, crk.epoch), crk);
}

/** Retrieve a cached CRK, or null if not cached. */
export function getCachedCrk(emberId: string, epoch: number): ChannelRootKey | null {
  return crkCache.get(crkCacheKey(emberId, epoch)) ?? null;
}

/** Clear all cached keys (e.g. on logout). */
export function clearChannelKeyCache(): void {
  crkCache.clear();
  ehkCache.clear();
}
