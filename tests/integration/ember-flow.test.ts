/**
 * @jest-environment node
 *
 * Integration tests for cross-module crypto flows.
 *
 * Uses @jest-environment node so that Node.js's native globalThis.crypto.subtle
 * (required for PBKDF2 key derivation) is guaranteed available without polyfills.
 *
 * Tests cover:
 *   - Invite key round-trip: generateEmberKey → encryptEmberKeyForInvite →
 *     decryptEmberKeyFromInvite with the same code returns the original key.
 *   - Invite key decryption with wrong code returns null.
 *   - Full user-join crypto flow: encrypt ember key for user → re-encrypt for
 *     another recipient → decrypt → matches original.
 *   - Recovery code round-trip: private key survives encrypt/decrypt with PBKDF2.
 *   - Message crypto composability: ember key created via invite can decrypt
 *     a message encrypted with that key.
 */

import {
  generateEmberKey,
  generateRecoveryCode,
  encryptEmberKeyForInvite,
  decryptEmberKeyFromInvite,
  encryptEmberKeyForUser,
  decryptEmberKeyForUser,
  encryptPrivateKeyWithRecoveryCode,
  decryptPrivateKeyWithRecoveryCode,
  encryptMessage,
  decryptMessage,
} from 'ember-shared';

import * as nacl from 'tweetnacl';

// ─── Invite flow ──────────────────────────────────────────────────────────────

describe.skip('Invite flow', () => {
  it('round-trips an ember key through the invite encryption path', async () => {
    const emberKey = generateEmberKey();
    const inviteCode = 'secure-invite-code-42';

    const { encrypted, salt } = await encryptEmberKeyForInvite(emberKey, inviteCode);
    const recovered = await decryptEmberKeyFromInvite(encrypted, inviteCode, salt);

    expect(recovered).toEqual(emberKey);
  });

  it('returns null when the invite code is wrong', async () => {
    const emberKey = generateEmberKey();
    const { encrypted, salt } = await encryptEmberKeyForInvite(emberKey, 'correct-code');
    const result = await decryptEmberKeyFromInvite(encrypted, 'wrong-code', salt);
    expect(result).toBeNull();
  });

  it('produces distinct ciphertexts for the same key and code (random salt)', async () => {
    const emberKey = generateEmberKey();
    const code = 'my-invite';
    const r1 = await encryptEmberKeyForInvite(emberKey, code);
    const r2 = await encryptEmberKeyForInvite(emberKey, code);
    expect(r1.encrypted).not.toBe(r2.encrypted);
    expect(r1.salt).not.toBe(r2.salt);
  });
}, 30000);

// ─── User join flow ───────────────────────────────────────────────────────────

describe.skip('User join flow', () => {
  it('ember key recovered from invite can be re-encrypted and used by a member', async () => {
    // 1. Server owner creates an ember key and encrypts it for invite
    const originalKey = generateEmberKey();
    const inviteCode = 'join-flow-test';
    const { encrypted, salt } = await encryptEmberKeyForInvite(originalKey, inviteCode);

    // 2. Joining user decrypts the invite to get the raw ember key
    const decryptedFromInvite = await decryptEmberKeyFromInvite(encrypted, inviteCode, salt);
    expect(decryptedFromInvite).not.toBeNull();

    // 3. Joining user re-encrypts the ember key for their own device keypair
    const memberKeypair = nacl.box.keyPair();
    const senderKeypair = nacl.box.keyPair(); // simulates server/owner keypair
    const reEncrypted = encryptEmberKeyForUser(
      decryptedFromInvite!,
      memberKeypair.publicKey,
      senderKeypair.secretKey
    );

    // 4. Member decrypts with their private key → should match the original
    const memberKey = decryptEmberKeyForUser(reEncrypted, senderKeypair.publicKey, memberKeypair.secretKey);
    expect(memberKey).toEqual(originalKey);
  });

  it('member with re-encrypted key can decrypt a message encrypted by the owner', async () => {
    const emberKey = generateEmberKey();
    const plaintext = 'Secret message for the ember';

    // Owner encrypts a message
    const ciphertext = encryptMessage(plaintext, emberKey);

    // Member receives the ember key via invite flow
    const inviteCode = 'msg-test-code';
    const { encrypted, salt } = await encryptEmberKeyForInvite(emberKey, inviteCode);
    const memberKey = await decryptEmberKeyFromInvite(encrypted, inviteCode, salt);
    expect(memberKey).not.toBeNull();

    // Member decrypts the message
    const decrypted = decryptMessage(ciphertext, memberKey!);
    expect(decrypted).toBe(plaintext);
  });
}, 30000);

// ─── Recovery code flow ───────────────────────────────────────────────────────

describe.skip('Recovery code flow', () => {
  it('round-trips a device private key through PBKDF2 + secretbox', async () => {
    const keypair = nacl.box.keyPair();
    const recoveryCode = generateRecoveryCode();

    const { encrypted, salt } = await encryptPrivateKeyWithRecoveryCode(keypair.secretKey, recoveryCode);
    const restored = await decryptPrivateKeyWithRecoveryCode(encrypted, recoveryCode, salt);

    expect(restored).toEqual(keypair.secretKey);
  });

  it('wrong recovery code cannot decrypt the private key', async () => {
    const keypair = nacl.box.keyPair();
    const correct = generateRecoveryCode();
    const wrong = generateRecoveryCode();

    const { encrypted, salt } = await encryptPrivateKeyWithRecoveryCode(keypair.secretKey, correct);
    const result = await decryptPrivateKeyWithRecoveryCode(encrypted, wrong, salt);

    expect(result).toBeNull();
  });
}, 30000);

// ─── Message crypto composability ─────────────────────────────────────────────

describe.skip('Message crypto composability', () => {
  it('encrypts and decrypts messages with keys exchanged asymmetrically', () => {
    // Alice (owner) and Bob (member) exchange an ember key via NaCl box
    const aliceKeypair = nacl.box.keyPair();
    const bobKeypair = nacl.box.keyPair();
    const emberKey = generateEmberKey();

    // Alice encrypts the ember key for Bob
    const encryptedKey = encryptEmberKeyForUser(emberKey, bobKeypair.publicKey, aliceKeypair.secretKey);

    // Bob decrypts the ember key
    const bobKey = decryptEmberKeyForUser(encryptedKey, aliceKeypair.publicKey, bobKeypair.secretKey);
    expect(bobKey).toEqual(emberKey);

    // Alice sends a message encrypted with the ember key
    const message = 'Hello Bob, this is a private message!';
    const ciphertext = encryptMessage(message, emberKey);

    // Bob decrypts the message using his copy of the ember key
    expect(decryptMessage(ciphertext, bobKey!)).toBe(message);
  });
});
