/**
 * AES-256-GCM authenticated encryption utility.
 *
 * Used by Layer 2 (Encrypted Message History) to encrypt/decrypt messages
 * and attachments with derived keys from HKDF.
 */

import type { AesGcmResult } from './history-key-types';

const NONCE_LENGTH = 12;
const TAG_LENGTH_BITS = 128;

/** Safely extract an ArrayBuffer from a Uint8Array (avoids SharedArrayBuffer issues). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * @param key       32-byte AES key (from HKDF derivation)
 * @param plaintext Data to encrypt
 * @param aad       Optional additional authenticated data
 * @returns Ciphertext (includes GCM auth tag) and random nonce
 */
export async function aesGcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array
): Promise<AesGcmResult> {
  if (key.length !== 32) {
    throw new Error(`AES-256-GCM key must be 32 bytes, got ${key.length}`);
  }

  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const params: AesGcmParams = {
    name: 'AES-GCM',
    iv: toArrayBuffer(nonce),
    tagLength: TAG_LENGTH_BITS,
  };
  if (aad) {
    params.additionalData = toArrayBuffer(aad);
  }

  const ciphertext = await crypto.subtle.encrypt(params, cryptoKey, toArrayBuffer(plaintext));

  return {
    ciphertext: new Uint8Array(ciphertext),
    nonce,
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 *
 * @param key        32-byte AES key (from HKDF derivation)
 * @param ciphertext Encrypted data (includes GCM auth tag)
 * @param nonce      12-byte nonce used during encryption
 * @param aad        Optional additional authenticated data (must match encryption)
 * @returns Decrypted plaintext
 */
export async function aesGcmDecrypt(
  key: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  if (key.length !== 32) {
    throw new Error(`AES-256-GCM key must be 32 bytes, got ${key.length}`);
  }
  if (nonce.length !== NONCE_LENGTH) {
    throw new Error(`AES-256-GCM nonce must be ${NONCE_LENGTH} bytes, got ${nonce.length}`);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const params: AesGcmParams = {
    name: 'AES-GCM',
    iv: toArrayBuffer(nonce),
    tagLength: TAG_LENGTH_BITS,
  };
  if (aad) {
    params.additionalData = toArrayBuffer(aad);
  }

  const plaintext = await crypto.subtle.decrypt(params, cryptoKey, toArrayBuffer(ciphertext));

  return new Uint8Array(plaintext);
}
