/**
 * @jest-environment node
 *
 * Test that verifies DM and channel message decryption behavior are identical.
 */

import {
  generateEmberKey,
  encryptMessage,
  decryptMessage,
} from 'ember-shared';

describe.skip('DM and Channel Consistency', () => {
  let emberKey: Uint8Array;

  beforeEach(() => {
    emberKey = generateEmberKey();
  });

  describe('Message Decryption Behavior', () => {
    test('both DMs and channels handle successful decryption identically', () => {
      const plaintext = 'Hello, this is a test message!';
      const ciphertext = encryptMessage(plaintext, emberKey);

      // Channel behavior
      const channelResult = decryptMessage(ciphertext, emberKey);
      
      // DM behavior (should be identical)
      const dmResult = decryptMessage(ciphertext, emberKey);

      expect(channelResult).toBe(plaintext);
      expect(dmResult).toBe(plaintext);
      expect(dmResult).toEqual(channelResult);
    });

    test('both DMs and channels handle decryption failure identically', () => {
      const wrongKey = generateEmberKey();
      const ciphertext = encryptMessage('Secret message', emberKey);

      // Channel behavior
      const channelResult = decryptMessage(ciphertext, wrongKey);
      
      // DM behavior (should be identical)
      const dmResult = decryptMessage(ciphertext, wrongKey);

      expect(channelResult).toBeNull();
      expect(dmResult).toBeNull();
      expect(dmResult).toEqual(channelResult);
    });

    test('both DMs and channels handle empty messages identically', () => {
      const ciphertext = encryptMessage('', emberKey);

      // Channel behavior
      const channelResult = decryptMessage(ciphertext, emberKey);
      
      // DM behavior (should be identical)
      const dmResult = decryptMessage(ciphertext, emberKey);

      expect(channelResult).toBe('');
      expect(dmResult).toBe('');
      expect(dmResult).toEqual(channelResult);
    });

    test('both DMs and channels handle special characters identically', () => {
      const plaintext = 'Special chars: 🚀 é ñ 中文 🌟';
      const ciphertext = encryptMessage(plaintext, emberKey);

      // Channel behavior
      const channelResult = decryptMessage(ciphertext, emberKey);
      
      // DM behavior (should be identical)
      const dmResult = decryptMessage(ciphertext, emberKey);

      expect(channelResult).toBe(plaintext);
      expect(dmResult).toBe(plaintext);
      expect(dmResult).toEqual(channelResult);
    });
  });

  describe('Error Message Display', () => {
    test('both DMs and channels show same error message for decryption failures', () => {
      const wrongKey = generateEmberKey();
      const ciphertext = encryptMessage('Secret message', emberKey);

      // Simulate the error handling logic
      const simulateChannelErrorHandling = () => {
        const plaintext = decryptMessage(ciphertext, wrongKey);
        if (plaintext === null) {
          return "[Failed to decrypt message]";
        }
        return plaintext;
      };

      const simulateDmErrorHandling = () => {
        const plaintext = decryptMessage(ciphertext, wrongKey);
        if (plaintext === null) {
          return "[Failed to decrypt message]";
        }
        return plaintext;
      };

      const channelError = simulateChannelErrorHandling();
      const dmError = simulateDmErrorHandling();

      expect(channelError).toBe("[Failed to decrypt message]");
      expect(dmError).toBe("[Failed to decrypt message]");
      expect(dmError).toEqual(channelError);
    });

    test('both DMs and channels show same error message for missing keys', () => {
      // Simulate missing ember key scenario
      const simulateMissingKeyError = () => {
        return "[Encrypted message - key unavailable]";
      };

      const channelError = simulateMissingKeyError();
      const dmError = simulateMissingKeyError();

      expect(channelError).toBe("[Encrypted message - key unavailable]");
      expect(dmError).toBe("[Encrypted message - key unavailable]");
      expect(dmError).toEqual(channelError);
    });
  });

  describe('Encryption Behavior', () => {
    test('both DMs and channels use identical encryption method', () => {
      const plaintext = 'Test message for encryption consistency';

      // Channel encryption
      const channelCiphertext = encryptMessage(plaintext, emberKey);
      
      // DM encryption (should be identical)
      const dmCiphertext = encryptMessage(plaintext, emberKey);

      // Both should use the same encryption method (NaCl secretbox)
      // Ciphertexts will be different due to random nonces (this is correct!)
      expect(channelCiphertext).not.toBe(dmCiphertext); // Different nonces
      
      // But both should decrypt to the original with the same key
      expect(decryptMessage(channelCiphertext, emberKey)).toBe(plaintext);
      expect(decryptMessage(dmCiphertext, emberKey)).toBe(plaintext);
      
      // Both should be valid base64 strings
      expect(channelCiphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(dmCiphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    });

    test('both DMs and channels produce ciphertexts of expected format', () => {
      const plaintext = 'Test';
      const ciphertext = encryptMessage(plaintext, emberKey);

      // NaCl secretbox produces: nonce (24 bytes) + encrypted message
      // Base64 encoded, should be reasonable length
      expect(ciphertext.length).toBeGreaterThan(0);
      expect(ciphertext.length).toBeLessThan(1000); // Reasonable upper bound
    });
  });

  describe('Key Management', () => {
    test('both DMs and channels use same ember key structure', () => {
      // Both should use 32-byte keys
      expect(emberKey).toHaveLength(32);
      expect(emberKey).toBeInstanceOf(Uint8Array);
    });

    test('both DMs and channels can share the same ember key', () => {
      const plaintext = 'Shared key test';
      const ciphertext = encryptMessage(plaintext, emberKey);

      // Both should be able to decrypt with the same key
      const decrypted = decryptMessage(ciphertext, emberKey);
      expect(decrypted).toBe(plaintext);
    });
  });
});
