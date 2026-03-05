/**
 * @jest-environment node
 *
 * End-to-end integration tests for Direct Messaging crypto workflow.
 *
 * Tests cover the core DM crypto functionality:
 *   - Conversation key generation and exchange
 *   - Message encryption/decryption
 *   - Key exchange payloads
 *   - Conversation key rotation
 *   - Multi-user conversation scenarios
 */

import {
  generateEmberKey,
  encryptDirectMessage,
  decryptDirectMessage,
  generateConversationKey,
  encryptConversationKeyForUser,
  decryptConversationKeyForUser,
  generateKeyExchangePayload,
  extractConversationKeyFromPayload,
  rotateConversationKey,
} from 'ember-shared';

import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

// Test configuration
const TEST_TIMEOUT = 30000;

// Test utilities
class TestUser {
  public userId: string;
  public keypair: nacl.BoxKeyPair;

  constructor(userId: string) {
    this.userId = userId;
    this.keypair = nacl.box.keyPair();
  }
}

describe('Direct Messaging Crypto Integration', () => {
  let alice: TestUser;
  let bob: TestUser;
  let charlie: TestUser;

  beforeAll(() => {
    // Initialize test users
    alice = new TestUser('alice');
    bob = new TestUser('bob');
    charlie = new TestUser('charlie');
  });

  describe('Conversation Key Generation and Exchange', () => {
    test('generates unique conversation keys', () => {
      const key1 = generateConversationKey();
      const key2 = generateConversationKey();

      expect(key1).toHaveLength(32); // NaCl key size
      expect(key2).toHaveLength(32); // NaCl key size
      expect(key1).not.toEqual(key2); // Should be unique
    });

    test('encrypts and decrypts conversation keys for users', () => {
      const conversationKey = generateConversationKey();

      // Alice encrypts key for Bob
      const encryptedKey = encryptConversationKeyForUser(
        conversationKey,
        bob.keypair.publicKey,
        alice.keypair.secretKey
      );

      expect(typeof encryptedKey).toBe('string');
      expect(encryptedKey.length).toBeGreaterThan(0);

      // Bob decrypts the key
      const decryptedKey = decryptConversationKeyForUser(
        encryptedKey,
        alice.keypair.publicKey,
        bob.keypair.secretKey
      );

      expect(decryptedKey).not.toBeNull();
      expect(decryptedKey).toEqual(conversationKey);
    });

    test('fails to decrypt with wrong keys', () => {
      const conversationKey = generateConversationKey();

      // Alice encrypts key for Bob
      const encryptedKey = encryptConversationKeyForUser(
        conversationKey,
        bob.keypair.publicKey,
        alice.keypair.secretKey
      );

      // Charlie tries to decrypt (should fail)
      const decryptedKey = decryptConversationKeyForUser(
        encryptedKey,
        alice.keypair.publicKey,
        charlie.keypair.secretKey
      );

      expect(decryptedKey).toBeNull();
    });
  });

  describe('Key Exchange Payloads', () => {
    test('generates complete key exchange payload', () => {
      const conversationKey = generateConversationKey();

      const payload = generateKeyExchangePayload(
        conversationKey,
        alice.keypair.publicKey,
        alice.keypair.secretKey,
        bob.keypair.publicKey
      );

      expect(payload).toHaveProperty('initiator_encrypted_key');
      expect(payload).toHaveProperty('recipient_encrypted_key');
      expect(typeof payload.initiator_encrypted_key).toBe('string');
      expect(typeof payload.recipient_encrypted_key).toBe('string');
    });

    test('extracts conversation key from payload', () => {
      const conversationKey = generateConversationKey();

      // Alice generates payload for Bob
      const payload = generateKeyExchangePayload(
        conversationKey,
        alice.keypair.publicKey,
        alice.keypair.secretKey,
        bob.keypair.publicKey
      );

      // Bob extracts his copy of the key
      const extractedKey = extractConversationKeyFromPayload(
        payload,
        alice.keypair.publicKey,
        bob.keypair.secretKey
      );

      expect(extractedKey).not.toBeNull();
      expect(extractedKey).toEqual(conversationKey);
    });

    test('payload extraction fails with wrong keys', () => {
      const conversationKey = generateConversationKey();

      // Alice generates payload for Bob
      const payload = generateKeyExchangePayload(
        conversationKey,
        alice.keypair.publicKey,
        alice.keypair.secretKey,
        bob.keypair.publicKey
      );

      // Charlie tries to extract Bob's key (should fail)
      const extractedKey = extractConversationKeyFromPayload(
        payload,
        alice.keypair.publicKey,
        charlie.keypair.secretKey
      );

      expect(extractedKey).toBeNull();
    });
  });

  describe('Message Encryption and Decryption', () => {
    test('encrypts and decrypts messages with conversation key', () => {
      const conversationKey = generateConversationKey();
      const plaintext = 'Hello, this is a secret message!';

      // Encrypt message
      const ciphertext = encryptDirectMessage(plaintext, conversationKey);

      expect(typeof ciphertext).toBe('string');
      expect(ciphertext).not.toBe(plaintext);
      expect(ciphertext.length).toBeGreaterThan(plaintext.length);

      // Decrypt message
      const decryptedText = decryptDirectMessage(ciphertext, conversationKey);

      expect(decryptedText).toBe(plaintext);
    });

    test('fails to decrypt with wrong conversation key', () => {
      const correctKey = generateConversationKey();
      const wrongKey = generateConversationKey();
      const plaintext = 'Secret message';

      // Encrypt with correct key
      const ciphertext = encryptDirectMessage(plaintext, correctKey);

      // Try to decrypt with wrong key
      const decryptedText = decryptDirectMessage(ciphertext, wrongKey);

      expect(decryptedText).toBeNull();
    });

    test('handles empty messages', () => {
      const conversationKey = generateConversationKey();
      const plaintext = '';

      const ciphertext = encryptDirectMessage(plaintext, conversationKey);
      const decryptedText = decryptDirectMessage(ciphertext, conversationKey);

      expect(decryptedText).toBe(plaintext);
    });

    test('handles special characters in messages', () => {
      const conversationKey = generateConversationKey();
      const plaintext = 'Special chars: 🚀 é ñ 中文 🌟';

      const ciphertext = encryptDirectMessage(plaintext, conversationKey);
      const decryptedText = decryptDirectMessage(ciphertext, conversationKey);

      expect(decryptedText).toBe(plaintext);
    });
  });

  describe('Conversation Key Rotation', () => {
    test('rotates conversation keys for both users', () => {
      const newConversationKey = generateConversationKey();

      const rotatedKeys = rotateConversationKey(
        newConversationKey,
        alice.keypair.publicKey,
        alice.keypair.secretKey,
        bob.keypair.publicKey,
        bob.keypair.secretKey
      );

      expect(rotatedKeys).toHaveProperty('user1_encrypted_key');
      expect(rotatedKeys).toHaveProperty('user2_encrypted_key');
      expect(typeof rotatedKeys.user1_encrypted_key).toBe('string');
      expect(typeof rotatedKeys.user2_encrypted_key).toBe('string');
    });

    test('both users can decrypt rotated keys', () => {
      const newConversationKey = generateConversationKey();

      // Rotate keys
      const rotatedKeys = rotateConversationKey(
        newConversationKey,
        alice.keypair.publicKey,
        alice.keypair.secretKey,
        bob.keypair.publicKey,
        bob.keypair.secretKey
      );

      // Alice decrypts her copy
      const aliceKey = decryptConversationKeyForUser(
        rotatedKeys.user1_encrypted_key,
        alice.keypair.publicKey,
        alice.keypair.secretKey
      );

      // Bob decrypts his copy
      const bobKey = decryptConversationKeyForUser(
        rotatedKeys.user2_encrypted_key,
        bob.keypair.publicKey,
        bob.keypair.secretKey
      );

      expect(aliceKey).toEqual(newConversationKey);
      expect(bobKey).toEqual(newConversationKey);
    });
  });

  describe('Complete Conversation Flow', () => {
    test('full conversation workflow from key exchange to messaging', () => {
      // 1. Alice generates conversation key
      const conversationKey = generateConversationKey();

      // 2. Alice creates key exchange payload
      const payload = generateKeyExchangePayload(
        conversationKey,
        alice.keypair.publicKey,
        alice.keypair.secretKey,
        bob.keypair.publicKey
      );

      // 3. Bob extracts the conversation key
      const bobConversationKey = extractConversationKeyFromPayload(
        payload,
        alice.keypair.publicKey,
        bob.keypair.secretKey
      );

      expect(bobConversationKey).toEqual(conversationKey);

      // 4. Alice sends message to Bob
      const aliceMessage = 'Hi Bob! This is encrypted.';
      const encryptedMessage = encryptDirectMessage(aliceMessage, conversationKey);

      // 5. Bob decrypts the message
      const decryptedByBob = decryptDirectMessage(encryptedMessage, bobConversationKey!);

      expect(decryptedByBob).toBe(aliceMessage);

      // 6. Bob replies to Alice
      const bobMessage = 'Hi Alice! Message received and decrypted!';
      const encryptedReply = encryptDirectMessage(bobMessage, conversationKey);

      // 7. Alice decrypts Bob's reply
      const decryptedByAlice = decryptDirectMessage(encryptedReply, conversationKey);

      expect(decryptedByAlice).toBe(bobMessage);
    });

    test('multi-user conversation scenario', () => {
      // Alice creates group conversation
      const conversationKey = generateConversationKey();

      // Alice encrypts key for Bob
      const bobEncryptedKey = encryptConversationKeyForUser(
        conversationKey,
        bob.keypair.publicKey,
        alice.keypair.secretKey
      );

      // Alice encrypts key for Charlie
      const charlieEncryptedKey = encryptConversationKeyForUser(
        conversationKey,
        charlie.keypair.publicKey,
        alice.keypair.secretKey
      );

      // Bob and Charlie decrypt their keys
      const bobKey = decryptConversationKeyForUser(
        bobEncryptedKey,
        alice.keypair.publicKey,
        bob.keypair.secretKey
      );

      const charlieKey = decryptConversationKeyForUser(
        charlieEncryptedKey,
        alice.keypair.publicKey,
        charlie.keypair.secretKey
      );

      expect(bobKey).toEqual(conversationKey);
      expect(charlieKey).toEqual(conversationKey);

      // Alice sends message to group
      const groupMessage = 'Hello group!';
      const encryptedGroupMessage = encryptDirectMessage(groupMessage, conversationKey);

      // Everyone can decrypt
      const decryptedByAlice = decryptDirectMessage(encryptedGroupMessage, conversationKey);
      const decryptedByBob = decryptDirectMessage(encryptedGroupMessage, bobKey!);
      const decryptedByCharlie = decryptDirectMessage(encryptedGroupMessage, charlieKey!);

      expect(decryptedByAlice).toBe(groupMessage);
      expect(decryptedByBob).toBe(groupMessage);
      expect(decryptedByCharlie).toBe(groupMessage);
    });
  });

  describe('Security and Edge Cases', () => {
    test('different conversations have different keys', () => {
      const aliceBobKey = generateConversationKey();
      const aliceCharlieKey = generateConversationKey();

      expect(aliceBobKey).not.toEqual(aliceCharlieKey);

      // Messages encrypted with different keys
      const message = 'Test message';
      const ciphertext1 = encryptDirectMessage(message, aliceBobKey);
      const ciphertext2 = encryptDirectMessage(message, aliceCharlieKey);

      expect(ciphertext1).not.toEqual(ciphertext2);

      // Can't decrypt with wrong key
      expect(decryptDirectMessage(ciphertext1, aliceCharlieKey)).toBeNull();
      expect(decryptDirectMessage(ciphertext2, aliceBobKey)).toBeNull();
    });

    test('large messages are handled correctly', () => {
      const conversationKey = generateConversationKey();
      const largeMessage = 'A'.repeat(10000); // 10KB message

      const ciphertext = encryptDirectMessage(largeMessage, conversationKey);
      const decryptedText = decryptDirectMessage(ciphertext, conversationKey);

      expect(decryptedText).toBe(largeMessage);
      expect(decryptedText.length).toBe(10000);
    });

    test('concurrent key exchanges work independently', () => {
      // Alice-Bob conversation
      const aliceBobKey = generateConversationKey();
      const aliceBobPayload = generateKeyExchangePayload(
        aliceBobKey,
        alice.keypair.publicKey,
        alice.keypair.secretKey,
        bob.keypair.publicKey
      );

      // Alice-Charlie conversation
      const aliceCharlieKey = generateConversationKey();
      const aliceCharliePayload = generateKeyExchangePayload(
        aliceCharlieKey,
        alice.keypair.publicKey,
        alice.keypair.secretKey,
        charlie.keypair.publicKey
      );

      // Extract keys independently
      const bobExtractedKey = extractConversationKeyFromPayload(
        aliceBobPayload,
        alice.keypair.publicKey,
        bob.keypair.secretKey
      );

      const charlieExtractedKey = extractConversationKeyFromPayload(
        aliceCharliePayload,
        alice.keypair.publicKey,
        charlie.keypair.secretKey
      );

      expect(bobExtractedKey).toEqual(aliceBobKey);
      expect(charlieExtractedKey).toEqual(aliceCharlieKey);
      expect(bobExtractedKey).not.toEqual(charlieExtractedKey);
    });
  });
}, TEST_TIMEOUT);
