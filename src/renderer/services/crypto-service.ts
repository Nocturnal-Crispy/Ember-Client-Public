/**
 * Crypto service — TypeScript implementation of public/crypto.js.
 * Provides NaCl-based encryption/decryption functions.
 * This module is intended for use both by the preload script (CommonJS require)
 * and eventually by the renderer via the compiled output.
 */

import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

/**
 * Generate a random 16-digit numeric recovery code formatted as XXXX-XXXX-XXXX-XXXX.
 */
export function generateRecoveryCode(): string {
  const digits = new Uint8Array(16);
  crypto.getRandomValues(digits);
  const code = Array.from(digits).map(b => b % 10).join('');
  console.debug('[Crypto] Recovery code generated');
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`;
}

/**
 * Derive a 32-byte encryption key from a recovery code using PBKDF2.
 */
async function deriveKeyFromRecoveryCode(recoveryCode: string, salt: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(recoveryCode.replace(/-/g, '')),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return new Uint8Array(derivedBits);
}

/**
 * Encrypt the device private key with the recovery code using PBKDF2 + NaCl secretbox.
 */
export async function encryptPrivateKeyWithRecoveryCode(
  privateKey: Uint8Array,
  recoveryCode: string
): Promise<{ encrypted: string; salt: string }> {
  console.debug('[Crypto] Encrypting private key with recovery code');
  const salt = nacl.randomBytes(32);
  const derivedKey = await deriveKeyFromRecoveryCode(recoveryCode, salt);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(privateKey, nonce, derivedKey);
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  console.debug('[Crypto] Private key encryption complete');
  return {
    encrypted: naclUtil.encodeBase64(combined),
    salt: naclUtil.encodeBase64(salt)
  };
}

/**
 * Decrypt the device private key using the recovery code.
 */
export async function decryptPrivateKeyWithRecoveryCode(
  encryptedBase64: string,
  recoveryCode: string,
  saltBase64: string
): Promise<Uint8Array | null> {
  console.debug('[Crypto] Decrypting private key with recovery code');
  const combined = naclUtil.decodeBase64(encryptedBase64);
  const salt = naclUtil.decodeBase64(saltBase64);
  const derivedKey = await deriveKeyFromRecoveryCode(recoveryCode, salt);
  const nonce = combined.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = combined.slice(nacl.secretbox.nonceLength);
  const decrypted = nacl.secretbox.open(ciphertext, nonce, derivedKey);
  if (!decrypted) {
    console.error('[Crypto] Private key decryption failed: invalid recovery code or corrupted data');
  } else {
    console.debug('[Crypto] Private key decryption successful');
  }
  return decrypted ?? null;
}

/**
 * Generate a random 32-byte symmetric key for an ember.
 */
export function generateEmberKey(): Uint8Array {
  console.debug('[Crypto] Generating ember symmetric key');
  return nacl.randomBytes(nacl.secretbox.keyLength);
}

/**
 * Encrypt an ember key for a specific user using NaCl box (asymmetric encryption).
 */
export function encryptEmberKeyForUser(
  emberKey: Uint8Array,
  recipientPublicKey: Uint8Array,
  senderPrivateKey: Uint8Array
): string {
  console.debug('[Crypto] Encrypting ember key for user (NaCl box)');
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(emberKey, nonce, recipientPublicKey, senderPrivateKey);
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  return naclUtil.encodeBase64(combined);
}

/**
 * Decrypt an ember key that was encrypted for this user.
 */
export function decryptEmberKeyForUser(
  encryptedBase64: string,
  senderPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array
): Uint8Array | null {
  console.debug('[Crypto] Decrypting ember key for user (NaCl box)');
  const combined = naclUtil.decodeBase64(encryptedBase64);
  const nonce = combined.slice(0, nacl.box.nonceLength);
  const ciphertext = combined.slice(nacl.box.nonceLength);
  const decrypted = nacl.box.open(ciphertext, nonce, senderPublicKey, recipientPrivateKey);
  if (!decrypted) {
    console.error('[Crypto] Ember key decryption failed: authentication failed');
  }
  return decrypted ?? null;
}

/**
 * Encrypt a plaintext message using NaCl secretbox with the ember key.
 */
export function encryptMessage(plaintext: string, emberKey: Uint8Array): string {
  console.debug('[Crypto] Encrypting message (NaCl secretbox)');
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const messageBytes = naclUtil.decodeUTF8(plaintext);
  const encrypted = nacl.secretbox(messageBytes, nonce, emberKey);
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  return naclUtil.encodeBase64(combined);
}

/**
 * Decrypt a ciphertext message using NaCl secretbox with the ember key.
 */
export function decryptMessage(ciphertextBase64: string, emberKey: Uint8Array): string | null {
  try {
    console.debug('[Crypto] Decrypting message (NaCl secretbox)');
    const combined = naclUtil.decodeBase64(ciphertextBase64);
    const nonce = combined.slice(0, nacl.secretbox.nonceLength);
    const ciphertext = combined.slice(nacl.secretbox.nonceLength);
    const decrypted = nacl.secretbox.open(ciphertext, nonce, emberKey);
    if (!decrypted) {
      console.warn('[Crypto] Message decryption returned null: authentication failed or wrong key');
      return null;
    }
    return naclUtil.encodeUTF8(decrypted);
  } catch (err) {
    console.error('[Crypto] Message decryption threw an error:', err);
    return null;
  }
}

/**
 * Derive a 32-byte encryption key from an invite code using PBKDF2.
 */
async function deriveKeyFromInviteCode(inviteCode: string, salt: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(inviteCode),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return new Uint8Array(derivedBits);
}

/**
 * Encrypt an ember key for sharing via invite link.
 */
export async function encryptEmberKeyForInvite(
  emberKey: Uint8Array,
  inviteCode: string
): Promise<{ encrypted: string; salt: string }> {
  console.debug('[Crypto] Encrypting ember key for invite (PBKDF2 + NaCl secretbox)');
  const salt = nacl.randomBytes(32);
  const derivedKey = await deriveKeyFromInviteCode(inviteCode, salt);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(emberKey, nonce, derivedKey);
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  console.debug('[Crypto] Ember key encrypted for invite');
  return {
    encrypted: naclUtil.encodeBase64(combined),
    salt: naclUtil.encodeBase64(salt)
  };
}

/**
 * Decrypt an ember key received via invite link.
 */
export async function decryptEmberKeyFromInvite(
  encryptedBase64: string,
  inviteCode: string,
  saltBase64: string
): Promise<Uint8Array | null> {
  try {
    console.debug('[Crypto] Decrypting ember key from invite (PBKDF2 + NaCl secretbox)');
    const combined = naclUtil.decodeBase64(encryptedBase64);
    const salt = naclUtil.decodeBase64(saltBase64);
    const derivedKey = await deriveKeyFromInviteCode(inviteCode, salt);
    const nonce = combined.slice(0, nacl.secretbox.nonceLength);
    const ciphertext = combined.slice(nacl.secretbox.nonceLength);
    const decrypted = nacl.secretbox.open(ciphertext, nonce, derivedKey);
    if (!decrypted) {
      console.error('[Crypto] Ember key from invite decryption failed: invalid invite code or corrupted data');
    } else {
      console.debug('[Crypto] Ember key from invite decrypted successfully');
    }
    return decrypted ?? null;
  } catch (err) {
    console.error('[Crypto] Ember key from invite decryption threw an error:', err);
    return null;
  }
}
