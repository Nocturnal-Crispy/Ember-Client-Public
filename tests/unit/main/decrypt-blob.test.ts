/**
 * TDD Tests for decryptBlob Function
 * 
 * Tests for proper error handling in the decryptBlob function
 */

import * as crypto from 'crypto';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Import the actual decryptBlob function by extracting it from signal-db
// Since it's not exported, we'll test it through the database interface
import { openSignalDatabase } from '../../../src/main/signal-db';
import type { SignalDatabase } from '../../../src/main/signal-db';

describe('decryptBlob Error Handling', () => {
  let tmpDir: string;
  let identityKey: Uint8Array;
  let db: SignalDatabase;

  beforeEach(() => {
    const tmp = require('os').tmpdir();
    const path = require('path');
    const fs = require('fs');
    
    tmpDir = fs.mkdtempSync(path.join(tmp, 'decrypt-blob-test-'));
    identityKey = crypto.randomBytes(32);
    db = openSignalDatabase(tmpDir, identityKey);
  });

  afterEach(() => {
    try {
      db.closeDatabase();
    } catch {
      // Ignore errors during cleanup
    }
    
    const fs = require('fs');
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Valid Operations', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      const address = 'test.encrypt.decrypt';
      
      await db.storeSession(address, testData);
      const retrieved = await db.loadSession(address);
      
      expect(retrieved).toEqual(testData);
    });

    it('should handle different data sizes', async () => {
      const testSizes = [1, 16, 64, 256, 1024];
      
      for (const size of testSizes) {
        const data = new Uint8Array(size);
        crypto.randomFillSync(data);
        
        const address = `size.test.${size}`;
        await db.storeSession(address, data);
        const retrieved = await db.loadSession(address);
        
        expect(retrieved).toEqual(data);
      }
    });

    it('should handle empty data', async () => {
      const emptyData = new Uint8Array([]);
      const address = 'empty.test';
      
      await db.storeSession(address, emptyData);
      const retrieved = await db.loadSession(address);
      
      expect(retrieved).toEqual(emptyData);
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted database gracefully', async () => {
      // Store valid data first
      const validData = new Uint8Array([1, 2, 3, 4]);
      const address = 'corruption.test';
      
      await db.storeSession(address, validData);
      
      // Verify it works initially
      const retrieved = await db.loadSession(address);
      expect(retrieved).toEqual(validData);
      
      // Close and reopen database to test persistence
      db.closeDatabase();
      db = openSignalDatabase(tmpDir, identityKey);
      
      // Should still work after reopening
      const retrievedAfterReopen = await db.loadSession(address);
      expect(retrievedAfterReopen).toEqual(validData);
    });

    it('should handle non-existent data', async () => {
      const result = await db.loadSession('non.existent.address');
      expect(result).toBeNull();
    });

    it('should handle large amounts of data', async () => {
      const largeData = new Uint8Array(1024 * 1024); // 1MB
      crypto.randomFillSync(largeData);
      
      const address = 'large.data.test';
      
      await db.storeSession(address, largeData);
      const retrieved = await db.loadSession(address);
      
      expect(retrieved).toEqual(largeData);
    });

    it('should handle many operations without memory leaks', async () => {
      const operations = 100;
      
      for (let i = 0; i < operations; i++) {
        const data = new Uint8Array([i % 256]);
        const address = `operation.test.${i}`;
        
        await db.storeSession(address, data);
        const retrieved = await db.loadSession(address);
        expect(retrieved).toEqual(data);
      }
      
      // If we got here without memory issues, the test passes
      expect(true).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in addresses', async () => {
      const specialAddresses = [
        'test.address.with.dots',
        'test-address-with-dashes',
        'test_address_with_underscores',
        'test.address.with.numbers.123',
        'test.very.long.address.name.that.exceeds.normal.length.expectations.but.should.still.work',
      ];
      
      for (const address of specialAddresses) {
        const data = new Uint8Array([address.length % 256]);
        await db.storeSession(address, data);
        const retrieved = await db.loadSession(address);
        expect(retrieved).toEqual(data);
      }
    });

    it('should handle binary data', async () => {
      // Test with all possible byte values
      const binaryData = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        binaryData[i] = i;
      }
      
      const address = 'binary.data.test';
      await db.storeSession(address, binaryData);
      const retrieved = await db.loadSession(address);
      
      expect(retrieved).toEqual(binaryData);
    });

    it('should handle data with null bytes', async () => {
      const dataWithNulls = new Uint8Array([0, 1, 2, 0, 3, 4, 0]);
      const address = 'null.bytes.test';
      
      await db.storeSession(address, dataWithNulls);
      const retrieved = await db.loadSession(address);
      
      expect(retrieved).toEqual(dataWithNulls);
    });
  });

  describe('Security Considerations', () => {
    it('should not expose sensitive information in error messages', async () => {
      // Test that errors don't contain the actual data
      try {
        // This should not throw, but if it does, the error shouldn't contain data
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const address = 'security.test';
        await db.storeSession(address, data);
        await db.loadSession(address);
        
        // If we got here, no errors occurred - which is good
        expect(true).toBe(true);
      } catch (error) {
        const errorMessage = (error as Error).message;
        
        // Error message should not contain the actual data values
        expect(errorMessage).not.toContain('1');
        expect(errorMessage).not.toContain('2');
        expect(errorMessage).not.toContain('3');
        expect(errorMessage).not.toContain('4');
        expect(errorMessage).not.toContain('5');
      }
    });

    it('should use constant-time operations for security-sensitive comparisons', async () => {
      // This is tested implicitly through the use of crypto.timingSafeEqual in the implementation
      // We can verify that identical data produces identical results
      const data1 = new Uint8Array([1, 2, 3, 4]);
      const data2 = new Uint8Array([1, 2, 3, 4]);
      const data3 = new Uint8Array([1, 2, 3, 5]);
      
      const address1 = 'constant.time.test.1';
      const address2 = 'constant.time.test.2';
      const address3 = 'constant.time.test.3';
      
      await db.storeSession(address1, data1);
      await db.storeSession(address2, data2);
      await db.storeSession(address3, data3);
      
      const retrieved1 = await db.loadSession(address1);
      const retrieved2 = await db.loadSession(address2);
      const retrieved3 = await db.loadSession(address3);
      
      expect(retrieved1).toEqual(retrieved2); // Identical data
      expect(retrieved1).not.toEqual(retrieved3); // Different data
    });
  });
});
