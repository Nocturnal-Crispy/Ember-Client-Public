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
  generateEmberKey,
  encryptMessage,
  decryptMessage,
  encryptEmberKeyForUser,
  decryptEmberKeyForUser,
  encryptPrivateKeyWithRecoveryCode,
  decryptPrivateKeyWithRecoveryCode,
  encryptEmberKeyForInvite,
  decryptEmberKeyFromInvite,
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

// ─── generateEmberKey ─────────────────────────────────────────────────────────

describe('generateEmberKey', () => {
  it('returns a 32-byte Uint8Array', () => {
    const key = generateEmberKey();
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('generates a unique key on each call', () => {
    const k1 = generateEmberKey();
    const k2 = generateEmberKey();
    expect(k1).not.toEqual(k2);
  });
});

// ─── encryptMessage / decryptMessage ─────────────────────────────────────────

describe('encryptMessage / decryptMessage', () => {
  it('round-trips plaintext through NaCl secretbox', () => {
    const key = generateEmberKey();
    const plaintext = 'Hello, Ember!';
    const ciphertext = encryptMessage(plaintext, key);
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext).not.toBe(plaintext);
    const decrypted = decryptMessage(ciphertext, key);
    expect(decrypted).toBe(plaintext);
  });

  it('returns null when decrypted with the wrong key', () => {
    const key1 = generateEmberKey();
    const key2 = generateEmberKey();
    const ciphertext = encryptMessage('secret', key1);
    expect(decryptMessage(ciphertext, key2)).toBeNull();
  });

  it('produces a different ciphertext each call due to random nonces', () => {
    const key = generateEmberKey();
    const ct1 = encryptMessage('same plaintext', key);
    const ct2 = encryptMessage('same plaintext', key);
    expect(ct1).not.toBe(ct2);
  });

  it('handles empty string round-trip', () => {
    const key = generateEmberKey();
    expect(decryptMessage(encryptMessage('', key), key)).toBe('');
  });

  it('handles multi-byte unicode round-trip', () => {
    const key = generateEmberKey();
    const text = '🔥 Ember 🔥 日本語テスト';
    expect(decryptMessage(encryptMessage(text, key), key)).toBe(text);
  });

  it('returns null for a corrupted ciphertext', () => {
    const key = generateEmberKey();
    expect(decryptMessage('notvalidbase64!!!', key)).toBeNull();
  });
});

// ─── encryptEmberKeyForUser / decryptEmberKeyForUser ─────────────────────────

describe('encryptEmberKeyForUser / decryptEmberKeyForUser', () => {
  it('round-trips an ember key through NaCl box (asymmetric)', () => {
    const emberKey = generateEmberKey();
    const sender = nacl.box.keyPair();
    const recipient = nacl.box.keyPair();

    const encrypted = encryptEmberKeyForUser(emberKey, recipient.publicKey, sender.secretKey);
    expect(typeof encrypted).toBe('string');

    const decrypted = decryptEmberKeyForUser(encrypted, sender.publicKey, recipient.secretKey);
    expect(decrypted).toEqual(emberKey);
  });

  it('returns null when decrypted with the wrong private key', () => {
    const emberKey = generateEmberKey();
    const sender = nacl.box.keyPair();
    const recipient = nacl.box.keyPair();
    const wrongRecipient = nacl.box.keyPair();

    const encrypted = encryptEmberKeyForUser(emberKey, recipient.publicKey, sender.secretKey);
    expect(decryptEmberKeyForUser(encrypted, sender.publicKey, wrongRecipient.secretKey)).toBeNull();
  });

  it('returns null when decrypted with the wrong sender public key', () => {
    const emberKey = generateEmberKey();
    const sender = nacl.box.keyPair();
    const wrongSender = nacl.box.keyPair();
    const recipient = nacl.box.keyPair();

    const encrypted = encryptEmberKeyForUser(emberKey, recipient.publicKey, sender.secretKey);
    expect(decryptEmberKeyForUser(encrypted, wrongSender.publicKey, recipient.secretKey)).toBeNull();
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

// ─── encryptEmberKeyForInvite / decryptEmberKeyFromInvite ────────────────────

describe('encryptEmberKeyForInvite / decryptEmberKeyFromInvite', () => {
  it('round-trips an ember key through invite encryption', async () => {
    const emberKey = generateEmberKey();
    const code = 'testinvitecode123';
    const { encrypted, salt } = await encryptEmberKeyForInvite(emberKey, code);
    expect(typeof encrypted).toBe('string');
    expect(typeof salt).toBe('string');
    const decrypted = await decryptEmberKeyFromInvite(encrypted, code, salt);
    expect(decrypted).toEqual(emberKey);
  });

  it('returns null when decrypted with the wrong invite code', async () => {
    const emberKey = generateEmberKey();
    const { encrypted, salt } = await encryptEmberKeyForInvite(emberKey, 'correctcode');
    const result = await decryptEmberKeyFromInvite(encrypted, 'wrongcode', salt);
    expect(result).toBeNull();
  });

  it('produces different encrypted outputs for the same key (random salt)', async () => {
    const emberKey = generateEmberKey();
    const code = 'mycode';
    const r1 = await encryptEmberKeyForInvite(emberKey, code);
    const r2 = await encryptEmberKeyForInvite(emberKey, code);
    expect(r1.encrypted).not.toBe(r2.encrypted);
  });
}, 30000);
