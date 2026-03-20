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
  encryptPrivateKeyWithRecoveryCode,
  decryptPrivateKeyWithRecoveryCode,
} from 'ember-shared';

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

function randomBytes32(): Uint8Array {
  const out = new Uint8Array(32);
  crypto.getRandomValues(out);
  return out;
}

// ─── encryptPrivateKeyWithRecoveryCode / decryptPrivateKeyWithRecoveryCode ────

describe('encryptPrivateKeyWithRecoveryCode / decryptPrivateKeyWithRecoveryCode', () => {
  it('round-trips a private key', async () => {
    const code = generateRecoveryCode();
    const privateKey = randomBytes32();
    const { encrypted, salt } = await encryptPrivateKeyWithRecoveryCode(privateKey, code);
    expect(typeof encrypted).toBe('string');
    expect(typeof salt).toBe('string');
    const decrypted = await decryptPrivateKeyWithRecoveryCode(encrypted, code, salt);
    expect(decrypted).toEqual(privateKey);
  });

  it('returns null when decrypted with the wrong recovery code', async () => {
    const code = generateRecoveryCode();
    const wrongCode = generateRecoveryCode();
    const privateKey = randomBytes32();
    const { encrypted, salt } = await encryptPrivateKeyWithRecoveryCode(privateKey, code);
    const result = await decryptPrivateKeyWithRecoveryCode(encrypted, wrongCode, salt);
    expect(result).toBeNull();
  });

  it('produces different encrypted outputs for the same key (random salt)', async () => {
    const code = generateRecoveryCode();
    const privateKey = randomBytes32();
    const r1 = await encryptPrivateKeyWithRecoveryCode(privateKey, code);
    const r2 = await encryptPrivateKeyWithRecoveryCode(privateKey, code);
    expect(r1.encrypted).not.toBe(r2.encrypted);
    expect(r1.salt).not.toBe(r2.salt);
  });
}, 30000);

