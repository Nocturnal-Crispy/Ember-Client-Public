/**
 * @jest-environment node
 *
 * Unit tests for src/renderer/services/crypto-service.ts
 *
 * Uses @jest-environment node so that Node.js's native globalThis.crypto.subtle
 * (required for PBKDF2 derivation) is guaranteed to be available.
 */

import {
  generateRecoveryCode,
  encryptMessage,
  decryptMessage,
  encryptPrivateKeyWithRecoveryCode,
  decryptPrivateKeyWithRecoveryCode,
} from 'ember-shared';

import * as nacl from 'tweetnacl';

// ─── generateRecoveryCode ─────────────────────────────────────────────────────

describe('generateRecoveryCode', () => {
  it('returns a string in XXXX-XXXX-XXXX-XXXX format', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^\d{4}-\d{4}-\d{4}-\d{4}$/);
  });

  it('generates unique codes on successive calls', () => {
    const codes = new Set(Array.from({ length: 10 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(10);
  });
});

function randomEmberKey(): Uint8Array {
  // generateEmberKey() was removed in Sprint 6 Phase 3; we still need a
  // compatible 32-byte key to test encryptMessage/decryptMessage.
  return nacl.randomBytes(32);
}

// ─── encryptMessage / decryptMessage ─────────────────────────────────────────

describe('encryptMessage / decryptMessage', () => {
  it('round-trips plaintext through NaCl secretbox', () => {
    const key = randomEmberKey();
    const plaintext = 'Hello, Ember!';
    const ciphertext = encryptMessage(plaintext, key);
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext).not.toBe(plaintext);
    const decrypted = decryptMessage(ciphertext, key);
    expect(decrypted).toBe(plaintext);
  });

  it('returns null when decrypted with the wrong key', () => {
    const key1 = randomEmberKey();
    const key2 = randomEmberKey();
    const ciphertext = encryptMessage('secret', key1);
    expect(decryptMessage(ciphertext, key2)).toBeNull();
  });

  it('produces a different ciphertext each call due to random nonces', () => {
    const key = randomEmberKey();
    const ct1 = encryptMessage('same plaintext', key);
    const ct2 = encryptMessage('same plaintext', key);
    expect(ct1).not.toBe(ct2);
  });

  it('handles empty string round-trip', () => {
    const key = randomEmberKey();
    expect(decryptMessage(encryptMessage('', key), key)).toBe('');
  });

  it('handles multi-byte unicode round-trip', () => {
    const key = randomEmberKey();
    const text = '🔥 Ember 🔥 日本語テスト';
    expect(decryptMessage(encryptMessage(text, key), key)).toBe(text);
  });

  it('returns null for a corrupted ciphertext', () => {
    const key = randomEmberKey();
    expect(decryptMessage('notvalidbase64!!!', key)).toBeNull();
  });
});

// ─── encryptPrivateKeyWithRecoveryCode / decryptPrivateKeyWithRecoveryCode ────

describe('encryptPrivateKeyWithRecoveryCode / decryptPrivateKeyWithRecoveryCode', () => {
  it('round-trips a private key', async () => {
    const keypair = nacl.box.keyPair();
    const code = generateRecoveryCode();
    const { encrypted, salt } = await encryptPrivateKeyWithRecoveryCode(keypair.secretKey, code);
    expect(typeof encrypted).toBe('string');
    expect(typeof salt).toBe('string');
    const decrypted = await decryptPrivateKeyWithRecoveryCode(encrypted, code, salt);
    expect(decrypted).toEqual(keypair.secretKey);
  });

  it('returns null when decrypted with the wrong recovery code', async () => {
    const keypair = nacl.box.keyPair();
    const code = generateRecoveryCode();
    const wrongCode = generateRecoveryCode();
    const { encrypted, salt } = await encryptPrivateKeyWithRecoveryCode(keypair.secretKey, code);
    const result = await decryptPrivateKeyWithRecoveryCode(encrypted, wrongCode, salt);
    expect(result).toBeNull();
  });

  it('produces different encrypted outputs for the same key (random salt)', async () => {
    const keypair = nacl.box.keyPair();
    const code = generateRecoveryCode();
    const r1 = await encryptPrivateKeyWithRecoveryCode(keypair.secretKey, code);
    const r2 = await encryptPrivateKeyWithRecoveryCode(keypair.secretKey, code);
    expect(r1.encrypted).not.toBe(r2.encrypted);
    expect(r1.salt).not.toBe(r2.salt);
  });
}, 30000);

