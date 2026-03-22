/**
 * Recovery code generation and key encryption/decryption.
 *
 * Uses PBKDF2 for key derivation and AES-256-GCM for encryption.
 * These operations are protocol-agnostic — they work for both
 * legacy NaCl keys and Signal Protocol identity keys.
 */

import * as nodeCrypto from 'crypto';

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 32;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function generateRecoveryCode(length = 16): string {
  const digits = nodeCrypto.randomBytes(length);
  const code = Array.from(digits)
    .map(b => b % 10)
    .join('');
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`;
}

function deriveKey(recoveryCode: string, salt: Uint8Array): Buffer {
  const normalized = recoveryCode.replace(/-/g, '');
  return nodeCrypto.pbkdf2Sync(normalized, salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256');
}

export async function encryptPrivateKeyWithRecoveryCode(
  privateKey: Uint8Array,
  recoveryCode: string
): Promise<{ encrypted: string; salt: string }> {
  const salt = nodeCrypto.randomBytes(SALT_BYTES);
  const key = deriveKey(recoveryCode, salt);
  const iv = nodeCrypto.randomBytes(IV_BYTES);

  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: iv (12) + tag (16) + ciphertext
  const combined = Buffer.concat([iv, tag, ciphertext]);

  return {
    encrypted: combined.toString('base64'),
    salt: salt.toString('base64'),
  };
}

export async function decryptPrivateKeyWithRecoveryCode(
  encryptedBase64: string,
  recoveryCode: string,
  saltBase64: string
): Promise<Uint8Array | null> {
  try {
    const combined = Buffer.from(encryptedBase64, 'base64');
    const salt = Buffer.from(saltBase64, 'base64');
    const key = deriveKey(recoveryCode, salt);

    const iv = combined.subarray(0, IV_BYTES);
    const tag = combined.subarray(IV_BYTES, IV_BYTES + 16);
    const ciphertext = combined.subarray(IV_BYTES + 16);

    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}
