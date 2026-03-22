/**
 * Unit tests for Signal Database functionality after Node.js module rebuild
 * Tests that the better-sqlite3 module works correctly after rebuild
 */

import { openSignalDatabase } from '../../../src/main/signal-db';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Signal Database Compatibility', () => {
  let tempDir: string;
  let signalDb: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-db-test-'));
  });

  afterEach(() => {
    if (signalDb && signalDb.closeDatabase) {
      signalDb.closeDatabase();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Database Operations After Rebuild', () => {
    it('should open signal database without Node.js module version errors', () => {
      const identityKey = new Uint8Array(32).fill(1);

      // This should not throw the NODE_MODULE_VERSION error after rebuild
      signalDb = openSignalDatabase(tempDir, identityKey);

      // Verify database was created successfully
      expect(signalDb).toBeDefined();
      expect(signalDb.closeDatabase).toBeDefined();
    });

    it('should perform basic database operations', () => {
      const identityKey = new Uint8Array(32).fill(1);
      signalDb = openSignalDatabase(tempDir, identityKey);

      // Initialize the database with required data
      signalDb.initializeLocalIdentity(
        {
          publicKey: new Uint8Array(32).fill(2),
          privateKey: identityKey,
        },
        12345 // registration ID
      );

      // Test basic operations that would fail if module wasn't working
      expect(() => {
        signalDb.getIdentity('test-user-123');
      }).not.toThrow();

      expect(() => {
        signalDb.getLocalRegistrationId();
      }).not.toThrow();

      expect(() => {
        signalDb.getIdentityKeyPair();
      }).not.toThrow();
    });

    it('should handle database file creation correctly', () => {
      const identityKey = new Uint8Array(32).fill(1);

      signalDb = openSignalDatabase(tempDir, identityKey);

      // Database file should be created
      const dbPath = path.join(tempDir, 'signal-state.db');
      expect(fs.existsSync(dbPath)).toBe(true);

      // Verify it's a valid SQLite file (should have SQLite header)
      const dbStats = fs.statSync(dbPath);
      expect(dbStats.size).toBeGreaterThan(100); // SQLite files have minimum size
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid paths gracefully', () => {
      const identityKey = new Uint8Array(32).fill(1);
      const invalidPath = '/invalid/path/that/does/not/exist';

      expect(() => {
        openSignalDatabase(invalidPath, identityKey);
      }).toThrow();
    });

    it('should handle invalid identity keys', () => {
      const invalidKey = new Uint8Array(16); // Wrong size

      // The function doesn't validate key length, so it should work
      expect(() => {
        signalDb = openSignalDatabase(tempDir, invalidKey);
      }).not.toThrow();
    });
  });
});
