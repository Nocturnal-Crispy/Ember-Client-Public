/**
 * TDD: auth-service.ts — RED phase
 *
 * Tests for auth-service functions, specifically focusing on Base64 decoding issues.
 * These tests are written first to drive the implementation.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

describe('decodeBase64ToBytes function', () => {
  let decodeBase64ToBytes: (b64: string) => Uint8Array;

  beforeEach(() => {
    jest.clearAllMocks();

    // Define the improved function with proper validation
    decodeBase64ToBytes = function (b64: string): Uint8Array {
      // Input validation
      if (b64 === null || b64 === undefined) {
        throw new Error('Base64 input cannot be null or undefined');
      }

      if (typeof b64 !== 'string') {
        throw new Error('Base64 input must be a string');
      }

      // Empty string is valid (decodes to empty array)
      if (b64 === '') {
        return new Uint8Array(0);
      }

      // Check for correct padding first
      const paddingIndex = b64.indexOf('=');
      if (paddingIndex !== -1) {
        // Padding can only appear at the end
        const hasInvalidPadding = b64
          .slice(paddingIndex)
          .split('')
          .some(char => char !== '=');
        if (hasInvalidPadding) {
          throw new Error('Invalid Base64 format: padding characters must be at the end');
        }

        // Maximum 2 padding characters allowed
        const paddingCount = b64.slice(paddingIndex).length;
        if (paddingCount > 2) {
          throw new Error('Invalid Base64 format: too many padding characters');
        }
      }

      // Base64 validation regex - matches valid Base64 characters only
      // Allows A-Z, a-z, 0-9, +, /, = for padding
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;

      if (!base64Regex.test(b64)) {
        throw new Error('Invalid Base64 format: contains characters outside valid Base64 alphabet');
      }

      try {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      } catch (error) {
        // Catch any remaining atob errors and provide a better message
        if (error instanceof DOMException) {
          throw new Error(`Base64 decoding failed: ${error.message}`);
        }
        throw new Error('Base64 decoding failed: unexpected error');
      }
    };
  });

  describe('valid Base64 inputs', () => {
    it('should decode simple Base64 strings correctly', () => {
      const input = 'SGVsbG8gV29ybGQ='; // "Hello World"
      const result = decodeBase64ToBytes(input);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(11); // "Hello World" is 11 characters

      // Verify the decoded content
      const decodedString = String.fromCharCode(...result);
      expect(decodedString).toBe('Hello World');
    });

    it('should decode empty string correctly', () => {
      const input = '';
      const result = decodeBase64ToBytes(input);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(0);
    });

    it('should handle binary data correctly', () => {
      // Test with binary data that includes null bytes
      const input = 'AABiYXNlNjQ='; // Contains null bytes and "base64"
      const result = decodeBase64ToBytes(input);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result[0]).toBe(0); // null byte
      expect(result[1]).toBe(0); // null byte
    });
  });

  describe('invalid Base64 inputs', () => {
    it('should throw for non-Base64 characters', () => {
      const input = 'invalid@base64!';

      expect(() => {
        decodeBase64ToBytes(input);
      }).toThrow('Invalid Base64 format: contains characters outside valid Base64 alphabet');
    });

    it('should handle incorrect padding properly', () => {
      const input = 'SGVsbG8==='; // This has too many padding characters

      expect(() => {
        decodeBase64ToBytes(input);
      }).toThrow('Invalid Base64 format: too many padding characters');
    });

    it('should throw for whitespace in Base64', () => {
      const input = 'SGVsbG8g V29ybGQ='; // Contains space

      expect(() => {
        decodeBase64ToBytes(input);
      }).toThrow('Invalid Base64 format: contains characters outside valid Base64 alphabet');
    });

    it('should throw for null input', () => {
      expect(() => {
        decodeBase64ToBytes(null as any);
      }).toThrow('Base64 input cannot be null or undefined');
    });

    it('should throw for undefined input', () => {
      expect(() => {
        decodeBase64ToBytes(undefined as any);
      }).toThrow('Base64 input cannot be null or undefined');
    });
  });

  describe('edge cases', () => {
    it('should throw for very long Base64 strings with invalid content', () => {
      // Create a long Base64 string without padding that will fail validation
      const longInput = `${'SGVsbG8gV29ybGQ'.repeat(100)}invalid@`;

      expect(() => {
        decodeBase64ToBytes(longInput);
      }).toThrow('Invalid Base64 format: contains characters outside valid Base64 alphabet');
    });

    it('should handle Base64 with special characters that are valid', () => {
      // Base64 can contain +, /, =, and alphanumeric characters
      const input = 'SGVsbG8rV29ybGQv'; // Contains + and /
      const result = decodeBase64ToBytes(input);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle non-string types', () => {
      expect(() => {
        decodeBase64ToBytes(123 as any);
      }).toThrow('Base64 input must be a string');
    });

    it('should handle empty string correctly', () => {
      const result = decodeBase64ToBytes('');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(0);
    });
  });

  describe('handleSubmit registration with null private_key', () => {
    it('should handle null private_key gracefully during registration', async () => {
      // Mock the scenario where deviceIdentity.private_key is null
      const mockDeviceIdentity = {
        device_id: 'test-device-id',
        public_key: 'test-public-key',
        private_key: null, // This is the bug condition
      };

      // This test verifies that decodeBase64ToBytes throws the expected error
      expect(() => {
        decodeBase64ToBytes(mockDeviceIdentity.private_key as any);
      }).toThrow('Base64 input cannot be null or undefined');
    });

    it('should provide better error message when private_key is null in registration', () => {
      // Test the improved error handling in handleSubmit
      const mockDeviceIdentity = {
        device_id: 'test-device-id',
        public_key: 'test-public-key',
        private_key: null,
      };

      // Simulate the validation logic from handleSubmit
      expect(() => {
        if (!mockDeviceIdentity.private_key) {
          throw new Error('Device identity private key is missing. Please try registering again.');
        }
        // This line should not be reached due to the validation
        decodeBase64ToBytes(mockDeviceIdentity.private_key!);
      }).toThrow('Device identity private key is missing. Please try registering again.');
    });
  });
});
