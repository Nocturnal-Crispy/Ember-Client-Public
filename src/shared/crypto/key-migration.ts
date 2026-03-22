/**
 * Key migration utilities for transitioning devices from the legacy TweetNaCl
 * (Curve25519 XSalsa20-Poly1305) system to the Signal Protocol
 * (libsignal-client Ed25519 / X3DH / Double Ratchet).
 *
 * All functions are async to allow for future WASM warm-up overhead and to
 * keep the API consistent.
 *
 * Byte-size conventions (libsignal):
 *   Identity public key  — 33 bytes (1-byte type prefix + 32-byte key)
 *   Identity private key — 32 bytes
 *   Curve25519 public key — 33 bytes (same prefix convention)
 *   Ed25519 signature    — 64 bytes
 */

import { IdentityKeyPair as LibSignalIKP, PrivateKey } from '@signalapp/libsignal-client';

import type { IdentityKeyPair, SignedPreKey, OneTimePreKey } from './signal-types.js';

// ------------------------------------------------------------------ //
// MigrationResult
// ------------------------------------------------------------------ //

/**
 * The complete result of migrating a device from the legacy TweetNaCl key
 * system to Signal Protocol.
 *
 * - `identityKeyPair`  — newly generated Ed25519 identity key pair
 * - `registrationId`   — random integer in [1, 16383] (Signal spec)
 * - `signedPreKey`     — first signed prekey (id=1) signed by identityKeyPair
 * - `oneTimePreKeys`   — 100 one-time prekeys (IDs 0–99)
 * - `legacyPublicKey`  — Curve25519 public key derived from `legacyPrivateKey`
 * - `legacyPrivateKey` — verbatim copy of the caller-supplied bytes
 */
export interface MigrationResult {
  readonly identityKeyPair: IdentityKeyPair;
  readonly registrationId: number;
  readonly signedPreKey: SignedPreKey;
  readonly oneTimePreKeys: OneTimePreKey[];
  readonly legacyPublicKey: Uint8Array;
  readonly legacyPrivateKey: Uint8Array;
}

// ------------------------------------------------------------------ //
// generateIdentityKey
// ------------------------------------------------------------------ //

/**
 * Generates a new Ed25519 identity key pair using libsignal.
 *
 * @returns An `IdentityKeyPair` where both fields are raw `Uint8Array` bytes:
 *          `publicKey` is 33 bytes (type prefix + 32), `privateKey` is 32 bytes.
 */
export async function generateIdentityKey(): Promise<IdentityKeyPair> {
  const libIkp = LibSignalIKP.generate();
  return {
    publicKey: libIkp.publicKey.serialize(),
    privateKey: libIkp.privateKey.serialize(),
  };
}

// ------------------------------------------------------------------ //
// generateRegistrationId
// ------------------------------------------------------------------ //

/**
 * Returns a random registration ID in the range [1, 16383] as per the
 * Signal Protocol specification.
 */
export function generateRegistrationId(): number {
  // crypto.getRandomValues is available in Node >= 15 and in browsers.
  const buf = new Uint16Array(1);
  crypto.getRandomValues(buf);
  // Map the 0-65535 range onto [0, 16382] then shift by 1 → [1, 16383]
  return (buf[0] % 16383) + 1;
}

// ------------------------------------------------------------------ //
// generateSignedPreKey
// ------------------------------------------------------------------ //

/**
 * Generates a Curve25519 key pair, signs its public key bytes with the
 * provided identity key pair's Ed25519 private key, and returns a
 * `SignedPreKey` record.
 *
 * @param identityKeyPair - Our application `IdentityKeyPair` (Uint8Array fields).
 * @param id              - The signed prekey ID to embed in the record.
 */
export async function generateSignedPreKey(
  identityKeyPair: IdentityKeyPair,
  id: number
): Promise<SignedPreKey> {
  // Generate a fresh Curve25519 key pair for the signed prekey
  const spkPriv = PrivateKey.generate();
  const spkPub = spkPriv.getPublicKey();
  const spkPubBytes = spkPub.serialize();

  // Reconstruct the libsignal PrivateKey from our Uint8Array so we can sign
  const libPrivKey = PrivateKey.deserialize(identityKeyPair.privateKey as Uint8Array<ArrayBuffer>);
  const signature = libPrivKey.sign(spkPubBytes);

  return {
    id,
    keyPair: {
      publicKey: spkPubBytes,
      privateKey: spkPriv.serialize(),
    },
    signature,
    timestamp: Date.now(),
  };
}

// ------------------------------------------------------------------ //
// generateOneTimePreKeys
// ------------------------------------------------------------------ //

/**
 * Generates `count` Curve25519 one-time prekey pairs with IDs in the range
 * `[startId, startId + count - 1]`.
 *
 * @param startId - The ID to assign to the first generated key.
 * @param count   - How many keys to generate. Returns an empty array when 0.
 */
export async function generateOneTimePreKeys(
  startId: number,
  count: number
): Promise<OneTimePreKey[]> {
  const keys: OneTimePreKey[] = [];
  for (let i = 0; i < count; i++) {
    const priv = PrivateKey.generate();
    keys.push({
      id: startId + i,
      keyPair: {
        publicKey: priv.getPublicKey().serialize(),
        privateKey: priv.serialize(),
      },
    });
  }
  return keys;
}

// ------------------------------------------------------------------ //
// migrateDeviceIdentity
// ------------------------------------------------------------------ //

/**
 * Generates a complete Signal Protocol identity for a device that was
 * previously using the legacy TweetNaCl key system.
 *
 * The legacy private key is preserved verbatim so that the server-side
 * migration can verify the device's prior identity before accepting the
 * new Signal keys.
 *
 * @param legacyPrivateKey - Raw 32-byte Curve25519 private key bytes from
 *                           the legacy TweetNaCl identity key pair.
 * @throws If `legacyPrivateKey` cannot be deserialized as a Curve25519
 *         private key (e.g. wrong length or invalid bytes).
 */
export async function migrateDeviceIdentity(
  legacyPrivateKey: Uint8Array
): Promise<MigrationResult> {
  // Derive the legacy public key — will throw for invalid input (e.g. empty)
  const legacyLibPriv = PrivateKey.deserialize(legacyPrivateKey as Uint8Array<ArrayBuffer>);
  const legacyPublicKey = legacyLibPriv.getPublicKey().serialize();

  // Generate fresh Signal Protocol credentials
  const identityKeyPair = await generateIdentityKey();
  const registrationId = generateRegistrationId();
  const signedPreKey = await generateSignedPreKey(identityKeyPair, 1);
  const oneTimePreKeys = await generateOneTimePreKeys(0, 100);

  return {
    identityKeyPair,
    registrationId,
    signedPreKey,
    oneTimePreKeys,
    legacyPublicKey,
    legacyPrivateKey: Uint8Array.from(legacyPrivateKey),
  };
}
