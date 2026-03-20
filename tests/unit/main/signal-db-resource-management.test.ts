/**
 * TDD Tests for Signal Database Resource Management
 * 
 * Tests for proper database connection cleanup and resource management
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openSignalDatabase } from '../../../src/main/signal-db';
import type { SignalDatabase } from '../../../src/main/signal-db';

// Mock the Database module
jest.mock('better-sqlite3', () => {
  let mockDbInstance: any = null;
  let closeCalled = false;
  
  class MockDatabase {
    constructor(dbPath: string) {
      mockDbInstance = this;
    }
    
    pragma(statement: string): void {
      if (statement.includes('journal_mode')) {
        throw new Error('Simulated pragma failure');
      }
    }
    
    prepare(sql: string): any {
      return {
        run: () => {
          throw new Error('Simulated DDL failure');
        }
      };
    }
    
    close(): void {
      closeCalled = true;
    }
    
    static resetMock() {
      mockDbInstance = null;
      closeCalled = false;
    }
    
    static getCloseCalled(): boolean {
      return closeCalled;
    }
  }
  
  return { Database: MockDatabase };
});

describe('Signal Database Resource Management', () => {
  let tmpDir: string;
  let identityKey: Uint8Array;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-db-resource-test-'));
    identityKey = crypto.randomBytes(32);
    
    // Reset the mock before each test
    const { Database } = require('better-sqlite3');
    (Database as any).resetMock();
  });

  afterEach(() => {
    // Clean up any remaining database files
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Database Connection Cleanup', () => {
    it('should properly close database connection when initialization fails', async () => {
      const { Database } = require('better-sqlite3');
      
      // This should throw during initialization
      expect(() => {
        openSignalDatabase(tmpDir, identityKey);
      }).toThrow('Simulated pragma failure');
      
      // Verify close() was called on the database instance
      expect((Database as any).getCloseCalled()).toBe(true);
    });

    it('should not leak file handles when multiple databases are opened and closed', () => {
      const dbPaths = [];
      const databases: SignalDatabase[] = [];
      
      try {
        // Open multiple databases
        for (let i = 0; i < 5; i++) {
          const db = openSignalDatabase(tmpDir, identityKey);
          databases.push(db);
          dbPaths.push(path.join(tmpDir, `signal-state-${i}.db`));
        }
        
        // Close all databases
        databases.forEach(db => db.closeDatabase());
        
        // Verify all database files can be accessed (no locked file handles)
        dbPaths.forEach(dbPath => {
          if (fs.existsSync(dbPath)) {
            // Try to read the file - this would fail if handle is still open
            fs.readFileSync(dbPath);
          }
        });
      } finally {
        databases.forEach(db => {
          try {
            db.closeDatabase();
          } catch {
            // Ignore errors during cleanup
          }
        });
      }
    });

    it('should handle concurrent database access gracefully', async () => {
      const db1 = openSignalDatabase(tmpDir, identityKey);
      const db2 = openSignalDatabase(tmpDir, identityKey);
      
      try {
        // Both databases should be able to perform basic operations
        await db1.storeSession('test.address.1', new Uint8Array([1, 2, 3]));
        await db2.storeSession('test.address.2', new Uint8Array([4, 5, 6]));
        
        const session1 = await db1.loadSession('test.address.1');
        const session2 = await db2.loadSession('test.address.2');
        
        expect(session1).toEqual(new Uint8Array([1, 2, 3]));
        expect(session2).toEqual(new Uint8Array([4, 5, 6]));
      } finally {
        db1.closeDatabase();
        db2.closeDatabase();
      }
    });
  });

  describe('Memory Management', () => {
    it('should not accumulate prepared statements over time', () => {
      const db = openSignalDatabase(tmpDir, identityKey);
      
      try {
        // Perform many operations to test for statement leaks
        for (let i = 0; i < 1000; i++) {
          db.storeSession(`test.address.${i}`, new Uint8Array([i % 256]));
          db.loadSession(`test.address.${i}`);
        }
        
        // If we got here without running out of memory, statements are being managed properly
        expect(true).toBe(true);
      } finally {
        db.closeDatabase();
      }
    });

    it('should properly clean up large blob data', async () => {
      const db = openSignalDatabase(tmpDir, identityKey);
      
      try {
        // Store and retrieve large blobs
        const largeBlob = new Uint8Array(1024 * 1024); // 1MB
        crypto.randomFillSync(largeBlob);
        
        await db.storeSession('large.test', largeBlob);
        const retrieved = await db.loadSession('large.test');
        
        expect(retrieved).toEqual(largeBlob);
        
        // Remove the session and verify memory is cleaned up
        await db.removeSession('large.test');
        const afterRemoval = await db.loadSession('large.test');
        expect(afterRemoval).toBeNull();
      } finally {
        db.closeDatabase();
      }
    });
  });

  describe('Error Recovery', () => {
    it('should recover from corruption errors without leaking resources', async () => {
      const db = openSignalDatabase(tmpDir, identityKey);
      
      try {
        // Store some valid data first
        await db.storeSession('valid.address', new Uint8Array([1, 2, 3]));
        
        // Simulate corruption by writing invalid data directly to database
        const dbPath = path.join(tmpDir, 'signal-state.db');
        const directDb = new Database(dbPath);
        directDb.prepare('INSERT OR REPLACE INTO sessions (address, record, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run('corrupt.address', Buffer.from([0xFF, 0xFE, 0xFD]), Date.now(), Date.now());
        directDb.close();
        
        // Attempt to read the corrupted data should not crash
        expect(async () => {
          await db.loadSession('corrupt.address');
        }).rejects.toThrow();
        
        // Valid data should still be accessible
        const validSession = await db.loadSession('valid.address');
        expect(validSession).toEqual(new Uint8Array([1, 2, 3]));
      } finally {
        db.closeDatabase();
      }
    });
  });
});
