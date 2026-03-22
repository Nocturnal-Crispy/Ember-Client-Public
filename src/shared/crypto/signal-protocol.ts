/**
 * Signal Protocol wrapper implementing X3DH and Double Ratchet.
 *
 * This module provides pure async functions for Signal Protocol operations
 * using @signalapp/libsignal-client. All functions are side-effect free
 * except for store writes, and all dependencies are explicitly injected.
 */

import {
  ProtocolAddress,
  CiphertextMessageType,
  processPreKeyBundle,
  signalEncrypt,
  signalDecrypt,
  signalDecryptPreKey,
  PreKeySignalMessage,
  SignalMessage,
  SessionStore,
  IdentityKeyStore,
  PreKeyStore,
  SignedPreKeyStore,
  KyberPreKeyStore,
  SenderKeyStore,
  SenderKeyDistributionMessage,
  processSenderKeyDistributionMessage,
  groupEncrypt,
  groupDecrypt,
  IdentityKeyPair as LibSignalIdentityKeyPair,
  PreKeyBundle as LibSignalPreKeyBundle,
} from '@signalapp/libsignal-client';
import type { Uuid } from '@signalapp/libsignal-client';

// ── Contract Types ─────────────────────────────────────────────────────────────

/** Combines all Signal Protocol store interfaces for a single dependency injection point. */
export type SignalStores = {
  readonly sessionStore: SessionStore;
  readonly identityStore: IdentityKeyStore;
  readonly preKeyStore: PreKeyStore;
  readonly signedPreKeyStore: SignedPreKeyStore;
  readonly kyberPreKeyStore: KyberPreKeyStore;
};

/** Local device identity for Signal Protocol operations. */
export type LocalDevice = {
  readonly address: ProtocolAddress;
  readonly identityKeyPair: LibSignalIdentityKeyPair;
  readonly registrationId: number;
};

/** Encrypted message result from Double Ratchet encryption. */
export type EncryptedSignalMessage = {
  readonly ciphertext: Uint8Array;
  readonly type: CiphertextMessageType;
  readonly senderDeviceId: string;
  readonly senderRegistrationId: number;
};

// ── Public API Functions ───────────────────────────────────────────────────────

/**
 * Initiates an X3DH session with a remote device.
 *
 * @param localDevice - The local device identity and keys
 * @param peerBundle - The remote device's pre-key bundle
 * @param peerAddress - The remote device's protocol address
 * @param stores - Signal Protocol store implementations
 * @returns Promise that resolves when session is established
 */
export async function initiateSession(
  localDevice: LocalDevice,
  peerBundle: LibSignalPreKeyBundle,
  peerAddress: ProtocolAddress,
  stores: SignalStores
): Promise<void> {
  // Use libsignal's processPreKeyBundle directly with real stores
  await processPreKeyBundle(peerBundle, peerAddress, stores.sessionStore, stores.identityStore);
}

/**
 * Encrypts a message using the Double Ratchet algorithm.
 *
 * @param plaintext - The message to encrypt
 * @param recipientAddress - The recipient's protocol address
 * @param stores - Signal Protocol store implementations
 * @returns Encrypted message with metadata
 */
export async function encryptMessage(
  plaintext: Uint8Array,
  recipientAddress: ProtocolAddress,
  stores: SignalStores
): Promise<EncryptedSignalMessage> {
  // Check if session exists using libsignal's getSession method
  const sessionRecord = await stores.sessionStore.getSession(recipientAddress);

  if (!sessionRecord) {
    throw new Error('No session exists with the recipient');
  }

  // Encrypt the message using libsignal
  // Convert Uint8Array to proper ArrayBuffer type for libsignal
  const arrayBuffer = plaintext.buffer.slice(
    plaintext.byteOffset,
    plaintext.byteOffset + plaintext.byteLength
  ) as ArrayBuffer;
  const plaintextBuffer = new Uint8Array(arrayBuffer);
  const ciphertextMessage = await signalEncrypt(
    plaintextBuffer,
    recipientAddress,
    stores.sessionStore,
    stores.identityStore
  );

  return {
    ciphertext: new Uint8Array(ciphertextMessage.serialize()),
    type: ciphertextMessage.type(),
    senderDeviceId: recipientAddress.deviceId().toString(),
    senderRegistrationId: await stores.identityStore.getLocalRegistrationId(),
  };
}

/**
 * Decrypts a message using the Double Ratchet algorithm.
 *
 * @param msg - The encrypted message to decrypt
 * @param senderAddress - The sender's protocol address
 * @param stores - Signal Protocol store implementations
 * @returns Decrypted plaintext
 */
export async function decryptMessage(
  msg: EncryptedSignalMessage,
  senderAddress: ProtocolAddress,
  stores: SignalStores
): Promise<Uint8Array> {
  // Security: callers may pass malformed ciphertext. We must not crash and must
  // avoid error-message differences that could act as a decryption oracle.
  try {
    if (!msg?.ciphertext || msg.ciphertext.byteLength === 0) {
      throw new Error('Decryption failed');
    }

    // For Whisper (Double Ratchet) messages, a session must already exist.
    // For PreKey messages, no session exists yet — signalDecryptPreKey creates it.
    if (msg.type !== CiphertextMessageType.PreKey) {
      const sessionRecord = await stores.sessionStore.getSession(senderAddress);
      if (!sessionRecord) {
        throw new Error('Decryption failed');
      }
    }

    // Deserialize the ciphertext message
    const arrayBuffer = msg.ciphertext.buffer.slice(
      msg.ciphertext.byteOffset,
      msg.ciphertext.byteOffset + msg.ciphertext.byteLength
    ) as ArrayBuffer;
    const ciphertextBuffer = new Uint8Array(arrayBuffer);

    const ciphertextMessage =
      msg.type === CiphertextMessageType.PreKey
        ? PreKeySignalMessage.deserialize(ciphertextBuffer)
        : SignalMessage.deserialize(ciphertextBuffer);

    // Decrypt the message using libsignal
    const plaintext =
      msg.type === CiphertextMessageType.PreKey
        ? await signalDecryptPreKey(
            ciphertextMessage as PreKeySignalMessage,
            senderAddress,
            stores.sessionStore,
            stores.identityStore,
            stores.preKeyStore,
            stores.signedPreKeyStore,
            stores.kyberPreKeyStore
          )
        : await signalDecrypt(
            ciphertextMessage as SignalMessage,
            senderAddress,
            stores.sessionStore,
            stores.identityStore
          );

    return new Uint8Array(plaintext);
  } catch {
    // Keep error details identical for all failures.
    throw new Error('Decryption failed');
  }
}

/**
 * Checks if a session exists with the given address.
 *
 * @param address - The protocol address to check
 * @param sessionStore - Session store implementation
 * @returns True if a session exists, false otherwise
 */
export async function hasSession(
  address: ProtocolAddress,
  sessionStore: SessionStore
): Promise<boolean> {
  // Use libsignal's getSession method directly
  const sessionRecord = await sessionStore.getSession(address);
  return sessionRecord !== null;
}

// ── Sender Key (Group Messaging) Functions ──────────────────────────────────

/** Serialised SenderKeyDistributionMessage bytes suitable for transport. */
export type SenderKeyDistributionBytes = Uint8Array;

/**
 * Creates a new Sender Key distribution for a group.
 *
 * @param senderAddress - The local sender's protocol address
 * @param distributionId - UUID identifying this distribution (one per group per sender)
 * @param senderKeyStore - Sender key store to persist the new sender key
 * @returns Serialised SenderKeyDistributionMessage bytes for distribution to group members
 */
export async function createSenderKeyDistribution(
  senderAddress: ProtocolAddress,
  distributionId: Uuid,
  senderKeyStore: SenderKeyStore
): Promise<SenderKeyDistributionBytes> {
  const skdm = await SenderKeyDistributionMessage.create(
    senderAddress,
    distributionId,
    senderKeyStore
  );
  return new Uint8Array(skdm.serialize());
}

/**
 * Processes a received SenderKeyDistributionMessage from a group member.
 *
 * @param senderAddress - The remote sender's protocol address
 * @param distributionBytes - Serialised SenderKeyDistributionMessage bytes
 * @param recipientSenderKeyStore - Local sender key store to install the key into
 */
export async function processSenderKeyDistribution(
  senderAddress: ProtocolAddress,
  distributionBytes: Uint8Array,
  recipientSenderKeyStore: SenderKeyStore
): Promise<void> {
  const skdm = SenderKeyDistributionMessage.deserialize(
    distributionBytes as Uint8Array<ArrayBuffer>
  );
  await processSenderKeyDistributionMessage(senderAddress, skdm, recipientSenderKeyStore);
}

/**
 * Encrypts a message using Sender Keys for group messaging.
 *
 * @param senderAddress - The local sender's protocol address
 * @param distributionId - UUID of the sender key distribution for this group
 * @param plaintext - The message to encrypt
 * @param senderKeyStore - Sender key store containing the sender's key
 * @returns Serialised SenderKeyMessage ciphertext bytes
 */
export async function groupEncryptMessage(
  senderAddress: ProtocolAddress,
  distributionId: Uuid,
  plaintext: Uint8Array,
  senderKeyStore: SenderKeyStore
): Promise<Uint8Array> {
  const arrayBuffer = plaintext.buffer.slice(
    plaintext.byteOffset,
    plaintext.byteOffset + plaintext.byteLength
  ) as ArrayBuffer;
  const plaintextBuffer = new Uint8Array(arrayBuffer);
  const ciphertext = await groupEncrypt(
    senderAddress,
    distributionId,
    senderKeyStore,
    plaintextBuffer
  );
  return new Uint8Array(ciphertext.serialize());
}

/**
 * Decrypts a Sender Key group message from a remote sender.
 *
 * @param senderAddress - The remote sender's protocol address
 * @param ciphertextBytes - Serialised SenderKeyMessage ciphertext bytes
 * @param recipientSenderKeyStore - Local sender key store containing the sender's distributed key
 * @returns Decrypted plaintext bytes
 */
export async function groupDecryptMessage(
  senderAddress: ProtocolAddress,
  ciphertextBytes: Uint8Array,
  recipientSenderKeyStore: SenderKeyStore
): Promise<Uint8Array> {
  const plaintext = await groupDecrypt(
    senderAddress,
    recipientSenderKeyStore,
    ciphertextBytes as Uint8Array<ArrayBuffer>
  );
  return new Uint8Array(plaintext);
}
