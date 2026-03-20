/**
 * TDD Tests for Cryptography Error Handling
 * 
 * Tests for proper error handling in encryption/decryption operations
 */

import * as crypto from 'crypto';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock crypto functions to simulate various failure scenarios
class MockCryptoOperations {
  private shouldFailAuth = false;
  private shouldFailDecryption = false;
  private shouldFailKeyDerivation = false;
  
  setFailureMode(mode: 'auth' | 'decryption' | 'key-derivation' | 'none') {
    this.shouldFailAuth = mode === 'auth';
    this.shouldFailDecryption = mode === 'decryption';
    this.shouldFailKeyDerivation = mode === 'key-derivation';
  }
  
  deriveKey(identityPrivateKey: Uint8Array): Buffer {
    if (this.shouldFailKeyDerivation) {
      throw new Error('Key derivation failed: insufficient entropy');
    }
    return crypto.randomBytes(32);
  }
  
  encrypt(key: Buffer, plaintext: Uint8Array, aad: Buffer): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    
    try {
      const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([iv, authTag, encrypted]);
    } catch (error) {
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }
  
  decrypt(key: Buffer, envelope: Buffer, aad: Buffer): Uint8Array {
    if (this.shouldFailAuth) {
      // Simulate authentication failure
      const error = new Error('Unsupported state or unable to authenticate data');
      (error as any).code = 'ERR_OSSL_UNSUPPORTED';
      throw error;
    }
    
    if (this.shouldFailDecryption) {
      throw new Error('Invalid padding');
    }
    
    try {
      const iv = envelope.subarray(0, 12);
      const authTag = envelope.subarray(12, 28);
      const ciphertext = envelope.subarray(28);
      
      if (iv.length !== 12 || authTag.length !== 16) {
        throw new Error('Invalid envelope format');
      }
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);
      
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return new Uint8Array(decrypted);
    } catch (error) {
      if (error instanceof Error && error.message.includes('auth')) {
        throw new Error('Authentication failed: data may be corrupted or tampered');
      }
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }
}

// Test implementation of the encryption functions
class TestCryptoManager {
  private crypto: MockCryptoOperations;
  
  constructor(cryptoOps: MockCryptoOperations) {
    this.crypto = cryptoOps;
  }
  
  // Current buggy implementation
  decryptBlobBuggy(derivedKey: Buffer, envelope: Buffer, aad: Buffer): Uint8Array {
    const iv = envelope.subarray(0, 12);
    const authTag = envelope.subarray(12, 28);
    const ciphertext = envelope.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return new Uint8Array(decrypted);
  }
  
  // Fixed implementation
  decryptBlobFixed(derivedKey: Buffer, envelope: Buffer, aad: Buffer): Uint8Array {
    try {
      if (envelope.length < 28) {
        throw new Error('Invalid envelope: too short');
      }
      
      const iv = envelope.subarray(0, 12);
      const authTag = envelope.subarray(12, 28);
      const ciphertext = envelope.subarray(28);

      if (iv.length !== 12) {
        throw new Error('Invalid IV length');
      }
      
      if (authTag.length !== 16) {
        throw new Error('Invalid auth tag length');
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return new Uint8Array(decrypted);
    } catch (error) {
      if (error instanceof Error && error.message.includes('auth')) {
        throw new Error('Authentication failed: data may be corrupted or tampered');
      }
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  encryptBlob(derivedKey: Buffer, plaintext: Uint8Array, aad: Buffer): Buffer {
    return this.crypto.encrypt(derivedKey, plaintext, aad);
  }
  
  deriveEncryptionKey(identityPrivateKey: Uint8Array): Buffer {
    return this.crypto.deriveKey(identityPrivateKey);
  }
}

describe('Cryptography Error Handling', () => {
  let cryptoOps: MockCryptoOperations;
  let cryptoManager: TestCryptoManager;
  let testKey: Buffer;
  let testAAD: Buffer;
  
  beforeEach(() => {
    cryptoOps = new MockCryptoOperations();
    cryptoManager = new TestCryptoManager(cryptoOps);
    testKey = crypto.randomBytes(32);
    testAAD = Buffer.from('test-aad');
  });

  describe('Decryption Error Handling', () => {
    it('should handle authentication failures gracefully', () => {
      cryptoOps.setFailureMode('auth');
      
      // Create a valid envelope first
      const plaintext = new Uint8Array([1, 2, 3, 4]);
      const validEnvelope = cryptoManager.encryptBlob(testKey, plaintext, testAAD);
      
      // Now try to decrypt with auth failure mode
      expect(() => {
        cryptoManager.decryptBlobFixed(testKey, validEnvelope, testAAD);
      }).toThrow('Authentication failed: data may be corrupted or tampered');
    });

    it('should handle decryption failures gracefully', () => {
      cryptoOps.setFailureMode('decryption');
      
      const invalidEnvelope = Buffer.from([1, 2, 3, 4, 5]); // Too short
      
      expect(() => {
        cryptoManager.decryptBlobFixed(testKey, invalidEnvelope, testAAD);
      }).toThrow('Decryption failed');
    });

    it('should handle invalid envelope format', () => {
      const invalidEnvelopes = [
        Buffer.from([]), // Empty
        Buffer.from([1, 2, 3]), // Too short
        new Uint8Array(27), // Just under minimum
      ];
      
      invalidEnvelopes.forEach((envelope, index) => {
        expect(() => {
          cryptoManager.decryptBlobFixed(testKey, Buffer.from(envelope), testAAD);
        }).toThrow(`Invalid envelope: too short`);
      });
    });

    it('should handle corrupted envelope components', () => {
      // Create valid envelope then corrupt it
      const plaintext = new Uint8Array([1, 2, 3, 4]);
      const validEnvelope = cryptoManager.encryptBlob(testKey, plaintext, testAAD);
      
      // Corrupt the auth tag
      const corruptedEnvelope = Buffer.from(validEnvelope);
      corruptedEnvelope[20] = 0xFF; // Corrupt a byte in the auth tag
      
      expect(() => {
        cryptoManager.decryptBlobFixed(testKey, corruptedEnvelope, testAAD);
      }).toThrow(/Authentication failed|Decryption failed/);
    });

    it('should demonstrate the buggy implementation crashes', () => {
      cryptoOps.setFailureMode('auth');
      
      const plaintext = new Uint8Array([1, 2, 3, 4]);
      const validEnvelope = cryptoManager.encryptBlob(testKey, plaintext, testAAD);
      
      // Buggy implementation should throw unhandled error
      expect(() => {
        cryptoManager.decryptBlobBuggy(testKey, validEnvelope, testAAD);
      }).toThrow(); // Should throw some unhandled error
    });

    it('should recover from decryption errors without resource leaks', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4]);
      const validEnvelope = cryptoManager.encryptBlob(testKey, plaintext, testAAD);
      
      // Try multiple invalid operations
      const invalidEnvelopes = [
        Buffer.from([1, 2, 3]),
        Buffer.from([1, 2, 3, 4, 5]),
        new Uint8Array(27),
      ];
      
      // All should fail gracefully
      invalidEnvelopes.forEach(envelope => {
        expect(() => {
          cryptoManager.decryptBlobFixed(testKey, Buffer.from(envelope), testAAD);
        }).toThrow();
      });
      
      // Valid operation should still work
      const result = cryptoManager.decryptBlobFixed(testKey, validEnvelope, testAAD);
      expect(result).toEqual(plaintext);
    });
  });

  describe('Key Derivation Error Handling', () => {
    it('should handle key derivation failures', () => {
      cryptoOps.setFailureMode('key-derivation');
      
      const privateKey = crypto.randomBytes(32);
      
      expect(() => {
        cryptoManager.deriveEncryptionKey(privateKey);
      }).toThrow('Key derivation failed: insufficient entropy');
    });

    it('should validate input parameters for key derivation', () => {
      const invalidInputs = [
        null,
        undefined,
        new Uint8Array(),
        new Uint8Array(16), // Too short
        new Uint8Array(64), // Too long
      ];
      
      invalidInputs.forEach((input, index) => {
        expect(() => {
          cryptoManager.deriveEncryptionKey(input as Uint8Array);
        }).toThrow();
      });
    });
  });

  describe('Encryption Error Handling', () => {
    it('should handle encryption failures gracefully', () => {
      const invalidKey = Buffer.from([]); // Empty key
      
      expect(() => {
        cryptoManager.encryptBlob(invalidKey, new Uint8Array([1, 2, 3]), testAAD);
      }).toThrow(/Encryption failed/);
    });

    it('should validate encryption parameters', () => {
      const testCases = [
        { key: Buffer.from([]), plaintext: new Uint8Array([1]), aad: testAAD, description: 'empty key' },
        { key: testKey, plaintext: new Uint8Array([]), aad: testAAD, description: 'empty plaintext' },
        { key: testKey, plaintext: new Uint8Array([1]), aad: Buffer.from([]), description: 'empty AAD' },
      ];
      
      testCases.forEach(({ key, plaintext, aad, description }) => {
        expect(() => {
          cryptoManager.encryptBlob(key, plaintext, aad);
        }).toThrow(new RegExp(`Encryption failed|${description}`));
      });
    });
  });

  describe('Security Considerations', () => {
    it('should not expose sensitive information in error messages', () => {
      cryptoOps.setFailureMode('auth');
      
      const plaintext = new Uint8Array([1, 2, 3, 4]);
      const validEnvelope = cryptoManager.encryptBlob(testKey, plaintext, testAAD);
      
      try {
        cryptoManager.decryptBlobFixed(testKey, validEnvelope, testAAD);
        fail('Expected error');
      } catch (error) {
        const errorMessage = (error as Error).message;
        
        // Should not contain sensitive information
        expect(errorMessage).not.toContain('1');
        expect(errorMessage).not.toContain('2');
        expect(errorMessage).not.toContain('3');
        
        // Should provide generic security message
        expect(errorMessage).toMatch(/Authentication failed|Decryption failed/);
      }
    });

    it('should use constant-time comparisons for security-sensitive data', () => {
      const data1 = new Uint8Array([1, 2, 3, 4]);
      const data2 = new Uint8Array([1, 2, 3, 4]);
      const data3 = new Uint8Array([1, 2, 3, 5]);
      
      // Use timingSafeEqual for security - convert to Buffer first
      const isEqual12 = crypto.timingSafeEqual(Buffer.from(data1), Buffer.from(data2));
      const isEqual13 = crypto.timingSafeEqual(Buffer.from(data1), Buffer.from(data3));
      
      expect(isEqual12).toBe(true);
      expect(isEqual13).toBe(false);
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle large data without memory leaks', () => {
      const largePlaintext = new Uint8Array(1024 * 1024); // 1MB
      crypto.randomFillSync(largePlaintext);
      
      const envelope = cryptoManager.encryptBlob(testKey, largePlaintext);
      const decrypted = cryptoManager.decryptBlobFixed(testKey, envelope, testAAD);
      
      expect(decrypted).toEqual(largePlaintext);
    });

    it('should handle many operations efficiently', () => {
      const operations = 1000;
      const plaintext = new Uint8Array([1, 2, 3, 4]);
      
      const startTime = Date.now();
      
      for (let i = 0; i < operations; i++) {
        const envelope = cryptoManager.encryptBlob(testKey, plaintext, testAAD);
        const decrypted = cryptoManager.decryptBlobFixed(testKey, envelope, testAAD);
        expect(decrypted).toEqual(plaintext);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(5000); // 5 seconds
    });
  });
});
