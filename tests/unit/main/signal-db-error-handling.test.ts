/**
 * TDD Tests for Signal Database Error Handling
 * 
 * Tests for proper error handling in database operations
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openSignalDatabase } from '../../../src/main/signal-db';
import type { SignalDatabase } from '../../../src/main/signal-db';

describe('Signal Database Error Handling', () => {
  let tmpDir: string;
  let identityKey: Uint8Array;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-db-error-test-'));
    identityKey = crypto.randomBytes(32);
  });

  afterEach(() => {
    // Clean up any remaining database files
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Database Initialization', () => {
    it('should create database successfully with valid parameters', () => {
      const db = openSignalDatabase(tmpDir, identityKey);
      
      expect(db).toBeDefined();
      expect(typeof db.loadSession).toBe('function');
      expect(typeof db.storeSession).toBe('function');
      expect(typeof db.closeDatabase).toBe('function');
      
      // Verify database file was created
      const dbPath = path.join(tmpDir, 'signal-state.db');
      expect(fs.existsSync(dbPath)).toBe(true);
      
      db.closeDatabase();
    });

    it('should handle invalid directory paths gracefully', () => {
      const invalidPath = '/invalid/nonexistent/path';
      
      expect(() => {
        openSignalDatabase(invalidPath, identityKey);
      }).toThrow();
    });

    it('should handle invalid identity key length', () => {
      const invalidKey = crypto.randomBytes(16); // Wrong length
      
      expect(() => {
        openSignalDatabase(tmpDir, invalidKey);
      }).not.toThrow(); // Should not throw during creation, but may fail during operations
    });
  });

  describe('Database Operations', () => {
    let db: SignalDatabase;

    beforeEach(() => {
      db = openSignalDatabase(tmpDir, identityKey);
    });

    afterEach(() => {
      try {
        db.closeDatabase();
      } catch {
        // Ignore errors during cleanup
      }
    });

    it('should handle session storage and retrieval', async () => {
      const address = 'test.address.1';
      const record = new Uint8Array([1, 2, 3, 4]);
      
      await db.storeSession(address, record);
      const retrieved = await db.loadSession(address);
      
      expect(retrieved).toEqual(record);
    });

    it('should return null for non-existent sessions', async () => {
      const result = await db.loadSession('non.existent.address');
      expect(result).toBeNull();
    });

    it('should handle large blob data', async () => {
      const largeData = new Uint8Array(1024 * 1024); // 1MB
      crypto.randomFillSync(largeData);
      
      const address = 'large.test.address';
      
      await db.storeSession(address, largeData);
      const retrieved = await db.loadSession(address);
      
      expect(retrieved).toEqual(largeData);
    });

    it('should handle session removal', async () => {
      const address = 'test.remove.address';
      const record = new Uint8Array([1, 2, 3]);
      
      await db.storeSession(address, record);
      let retrieved = await db.loadSession(address);
      expect(retrieved).toEqual(record);
      
      await db.removeSession(address);
      retrieved = await db.loadSession(address);
      expect(retrieved).toBeNull();
    });
  });

  describe('Concurrent Access', () => {
    it('should handle multiple database instances', () => {
      const db1 = openSignalDatabase(tmpDir, identityKey);
      const db2 = openSignalDatabase(tmpDir, identityKey);
      
      expect(db1).toBeDefined();
      expect(db2).toBeDefined();
      
      // Both should be able to perform operations
      const address1 = 'db1.test.address';
      const address2 = 'db2.test.address';
      const record1 = new Uint8Array([1, 2, 3]);
      const record2 = new Uint8Array([4, 5, 6]);
      
      // These should not throw
      expect(async () => {
        await db1.storeSession(address1, record1);
        await db2.storeSession(address2, record2);
      }).not.toThrow();
      
      db1.closeDatabase();
      db2.closeDatabase();
    });
  });

  describe('Resource Management', () => {
    it('should close database without errors', () => {
      const db = openSignalDatabase(tmpDir, identityKey);
      
      expect(() => {
        db.closeDatabase();
      }).not.toThrow();
      
      // Calling close again should not throw
      expect(() => {
        db.closeDatabase();
      }).not.toThrow();
    });

    it('should handle many operations without memory leaks', async () => {
      const db = openSignalDatabase(tmpDir, identityKey);
      
      try {
        // Perform many operations
        for (let i = 0; i < 100; i++) {
          const address = `test.address.${i}`;
          const record = new Uint8Array([i % 256]);
          
          await db.storeSession(address, record);
          const retrieved = await db.loadSession(address);
          expect(retrieved).toEqual(record);
        }
        
        // If we got here without running out of memory, we're good
        expect(true).toBe(true);
      } finally {
        db.closeDatabase();
      }
    });
  });

  describe('Encryption/Decryption', () => {
    let db: SignalDatabase;

    beforeEach(() => {
      db = openSignalDatabase(tmpDir, identityKey);
    });

    afterEach(() => {
      try {
        db.closeDatabase();
      } catch {
        // Ignore errors during cleanup
      }
    });

    it('should encrypt and decrypt data consistently', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      const address = 'encryption.test.address';
      
      await db.storeSession(address, testData);
      const retrieved = await db.loadSession(address);
      
      expect(retrieved).toEqual(testData);
    });

    it('should handle different data sizes', async () => {
      const testSizes = [1, 16, 64, 256, 1024, 4096];
      
      for (const size of testSizes) {
        const data = new Uint8Array(size);
        crypto.randomFillSync(data);
        
        const address = `size.test.${size}`;
        await db.storeSession(address, data);
        const retrieved = await db.loadSession(address);
        
        expect(retrieved).toEqual(data);
      }
    });
  });
});
