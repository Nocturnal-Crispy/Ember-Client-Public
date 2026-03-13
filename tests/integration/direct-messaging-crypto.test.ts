/**
 * @jest-environment node
 *
 * Integration tests for DM message crypto.
 *
 * DM channels use the same ember-channel crypto as server text channels:
 *   - generateEmberKey  — produce the shared channel key
 *   - encryptEmberKeyForUser / decryptEmberKeyForUser — key exchange via NaCl box
 *   - encryptMessage / decryptMessage — per-message secretbox encryption
 *
 * Tests cover the same scenarios as before (key exchange, message encryption,
 * key rotation, multi-user flows) but use only the shared ember-channel API.
 */

import {
  generateEmberKey,
  encryptEmberKeyForUser,
  decryptEmberKeyForUser,
  encryptMessage,
  decryptMessage,
} from 'ember-shared';

import * as nacl from 'tweetnacl';

const TEST_TIMEOUT = 30000;

class TestUser {
  public userId: string;
  public keypair: nacl.BoxKeyPair;

  constructor(userId: string) {
    this.userId = userId;
    this.keypair = nacl.box.keyPair();
  }
}

describe('DM Channel Crypto Integration', () => {
  let alice: TestUser;
  let bob: TestUser;
  let charlie: TestUser;

  beforeAll(() => {
    alice = new TestUser('alice');
    bob = new TestUser('bob');
    charlie = new TestUser('charlie');
  });

  describe('Ember Key Generation', () => {
    test('generates unique ember keys', () => {
      const key1 = generateEmberKey();
      const key2 = generateEmberKey();

      expect(key1).toHaveLength(32);
      expect(key2).toHaveLength(32);
      expect(key1).not.toEqual(key2);
    });
  });

  describe('Key Exchange (encryptEmberKeyForUser / decryptEmberKeyForUser)', () => {
    test('alice can encrypt a key for bob and bob can decrypt it', () => {
      const emberKey = generateEmberKey();

      const encrypted = encryptEmberKeyForUser(
        emberKey,
        bob.keypair.publicKey,
        alice.keypair.secretKey
      );

      expect(typeof encrypted).toBe('string');

      const decrypted = decryptEmberKeyForUser(
        encrypted,
        alice.keypair.publicKey,
        bob.keypair.secretKey
      );

      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(emberKey);
    });

    test('decryption fails with the wrong private key', () => {
      const emberKey = generateEmberKey();

      const encrypted = encryptEmberKeyForUser(
        emberKey,
        bob.keypair.publicKey,
        alice.keypair.secretKey
      );

      const decrypted = decryptEmberKeyForUser(
        encrypted,
        alice.keypair.publicKey,
        charlie.keypair.secretKey // wrong key
      );

      expect(decrypted).toBeNull();
    });

    test('both participants can hold their own copy of the ember key', () => {
      const emberKey = generateEmberKey();

      // Alice self-seals her copy (same key pair as sender and recipient)
      const aliceEncrypted = encryptEmberKeyForUser(
        emberKey,
        alice.keypair.publicKey,
        alice.keypair.secretKey
      );
      // Bob receives a copy encrypted by Alice
      const bobEncrypted = encryptEmberKeyForUser(
        emberKey,
        bob.keypair.publicKey,
        alice.keypair.secretKey
      );

      const aliceKey = decryptEmberKeyForUser(
        aliceEncrypted,
        alice.keypair.publicKey,
        alice.keypair.secretKey
      );
      const bobKey = decryptEmberKeyForUser(
        bobEncrypted,
        alice.keypair.publicKey,
        bob.keypair.secretKey
      );

      expect(aliceKey).toEqual(emberKey);
      expect(bobKey).toEqual(emberKey);
    });

    test('alice can also encrypt a key for charlie', () => {
      const emberKey = generateEmberKey();

      const bobEncrypted = encryptEmberKeyForUser(emberKey, bob.keypair.publicKey, alice.keypair.secretKey);
      const charlieEncrypted = encryptEmberKeyForUser(emberKey, charlie.keypair.publicKey, alice.keypair.secretKey);

      const bobKey = decryptEmberKeyForUser(bobEncrypted, alice.keypair.publicKey, bob.keypair.secretKey);
      const charlieKey = decryptEmberKeyForUser(charlieEncrypted, alice.keypair.publicKey, charlie.keypair.secretKey);

      expect(bobKey).toEqual(emberKey);
      expect(charlieKey).toEqual(emberKey);
    });
  });

  describe('Message Encryption (encryptMessage / decryptMessage)', () => {
    test('encrypts and decrypts a message with the ember key', () => {
      const emberKey = generateEmberKey();
      const plaintext = 'Hello, this is a secret message!';

      const ciphertext = encryptMessage(plaintext, emberKey);

      expect(typeof ciphertext).toBe('string');
      expect(ciphertext).not.toBe(plaintext);

      const decrypted = decryptMessage(ciphertext, emberKey);
      expect(decrypted).toBe(plaintext);
    });

    test('decryption fails with the wrong ember key', () => {
      const correctKey = generateEmberKey();
      const wrongKey = generateEmberKey();

      const ciphertext = encryptMessage('Secret message', correctKey);
      expect(decryptMessage(ciphertext, wrongKey)).toBeNull();
    });

    test('handles empty messages', () => {
      const emberKey = generateEmberKey();
      const ciphertext = encryptMessage('', emberKey);
      expect(decryptMessage(ciphertext, emberKey)).toBe('');
    });

    test('handles special characters and emoji', () => {
      const emberKey = generateEmberKey();
      const plaintext = 'Special chars: 🚀 é ñ 中文 🌟';
      expect(decryptMessage(encryptMessage(plaintext, emberKey), emberKey)).toBe(plaintext);
    });

    test('handles large messages', () => {
      const emberKey = generateEmberKey();
      const plaintext = 'A'.repeat(10000);
      const decrypted = decryptMessage(encryptMessage(plaintext, emberKey), emberKey);
      expect(decrypted).toBe(plaintext);
      expect(decrypted!.length).toBe(10000);
    });
  });

  describe('Key Rotation', () => {
    test('rotating the ember key — each user gets an independently decryptable copy', () => {
      const newKey = generateEmberKey();

      // Each user self-seals their copy of the rotated key
      const aliceEncrypted = encryptEmberKeyForUser(newKey, alice.keypair.publicKey, alice.keypair.secretKey);
      const bobEncrypted = encryptEmberKeyForUser(newKey, bob.keypair.publicKey, bob.keypair.secretKey);

      const aliceKey = decryptEmberKeyForUser(aliceEncrypted, alice.keypair.publicKey, alice.keypair.secretKey);
      const bobKey = decryptEmberKeyForUser(bobEncrypted, bob.keypair.publicKey, bob.keypair.secretKey);

      expect(aliceKey).toEqual(newKey);
      expect(bobKey).toEqual(newKey);
    });
  });

  describe('Full DM Channel Flow', () => {
    test('end-to-end: key exchange → encrypt → decrypt', () => {
      // 1. Alice generates the DM channel ember key
      const emberKey = generateEmberKey();

      // 2. Alice seals a copy for Bob
      const bobEncrypted = encryptEmberKeyForUser(emberKey, bob.keypair.publicKey, alice.keypair.secretKey);

      // 3. Bob decrypts his copy
      const bobKey = decryptEmberKeyForUser(bobEncrypted, alice.keypair.publicKey, bob.keypair.secretKey);
      expect(bobKey).toEqual(emberKey);

      // 4. Alice sends a message
      const aliceMsg = 'Hi Bob!';
      const ciphertext = encryptMessage(aliceMsg, emberKey);

      // 5. Bob decrypts it
      expect(decryptMessage(ciphertext, bobKey!)).toBe(aliceMsg);

      // 6. Bob replies; Alice decrypts
      const bobMsg = 'Hi Alice!';
      expect(decryptMessage(encryptMessage(bobMsg, emberKey), emberKey)).toBe(bobMsg);
    });

    test('independent DM channels have different keys', () => {
      const aliceBobKey = generateEmberKey();
      const aliceCharlieKey = generateEmberKey();

      expect(aliceBobKey).not.toEqual(aliceCharlieKey);

      const msg = 'Test';
      const ct1 = encryptMessage(msg, aliceBobKey);
      const ct2 = encryptMessage(msg, aliceCharlieKey);

      expect(ct1).not.toEqual(ct2);
      expect(decryptMessage(ct1, aliceCharlieKey)).toBeNull();
      expect(decryptMessage(ct2, aliceBobKey)).toBeNull();
    });

    test('concurrent key exchanges work independently', () => {
      const aliceBobKey = generateEmberKey();
      const aliceCharlieKey = generateEmberKey();

      const bobEncrypted = encryptEmberKeyForUser(aliceBobKey, bob.keypair.publicKey, alice.keypair.secretKey);
      const charlieEncrypted = encryptEmberKeyForUser(aliceCharlieKey, charlie.keypair.publicKey, alice.keypair.secretKey);

      const bobKey = decryptEmberKeyForUser(bobEncrypted, alice.keypair.publicKey, bob.keypair.secretKey);
      const charlieKey = decryptEmberKeyForUser(charlieEncrypted, alice.keypair.publicKey, charlie.keypair.secretKey);

      expect(bobKey).toEqual(aliceBobKey);
      expect(charlieKey).toEqual(aliceCharlieKey);
      expect(bobKey).not.toEqual(charlieKey);
    });
  });
}, TEST_TIMEOUT);
