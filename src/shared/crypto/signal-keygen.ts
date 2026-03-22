/**
 * Signal Protocol key generation utilities.
 *
 * Generates Ed25519 identity key pairs, signed prekeys, one-time prekeys,
 * and registration IDs for the Signal Protocol.
 *
 * Byte-size conventions (libsignal):
 *   Identity public key  — 33 bytes (1-byte type prefix + 32-byte key)
 *   Identity private key — 32 bytes
 *   Curve25519 public key — 33 bytes (same prefix convention)
 *   Ed25519 signature    — 64 bytes
 */

import { IdentityKeyPair as LibSignalIKP, PrivateKey } from '@signalapp/libsignal-client';

import type { IdentityKeyPair, SignedPreKey, OneTimePreKey } from './signal-types.js';

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

/**
 * Returns a random registration ID in the range [1, 16383] as per the
 * Signal Protocol specification.
 */
export function generateRegistrationId(): number {
  const buf = new Uint16Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % 16383) + 1;
}

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
  const spkPriv = PrivateKey.generate();
  const spkPub = spkPriv.getPublicKey();
  const spkPubBytes = spkPub.serialize();

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
