/**
 * Unit tests for scoped device identity and Signal DB filename changes.
 *
 * Tests the per-user state scoping logic introduced to fix user-switch login failures.
 */

// @jest-environment node

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  getSignalDbFilename,
  ensureSignalDatabaseFile,
  openSignalDatabase,
} from '../../../src/main/signal-db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-device-test-'));
}

function makeIdentityKey(): Uint8Array {
  return crypto.randomBytes(32);
}

// ─── getSignalDbFilename ──────────────────────────────────────────────────────

describe('getSignalDbFilename', () => {
  it('returns scoped filename when userId and deviceId are provided', () => {
    const result = getSignalDbFilename('user123', 'device456');
    expect(result).toBe('signal-user123-device456.db');
  });

  it('returns default filename when userId is missing', () => {
    const result = getSignalDbFilename(undefined, 'device456');
    expect(result).toBe('signal-state.db');
  });

  it('returns default filename when deviceId is missing', () => {
    const result = getSignalDbFilename('user123', undefined);
    expect(result).toBe('signal-state.db');
  });

  it('returns default filename when both are missing', () => {
    const result = getSignalDbFilename();
    expect(result).toBe('signal-state.db');
  });

  it('returns default filename for empty strings', () => {
    const result = getSignalDbFilename('', '');
    expect(result).toBe('signal-state.db');
  });
});

// ─── ensureSignalDatabaseFile with custom filename ────────────────────────────

describe('ensureSignalDatabaseFile — scoped filename', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates database with default filename when none specified', () => {
    ensureSignalDatabaseFile(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'signal-state.db'))).toBe(true);
  });

  it('creates database with custom filename when specified', () => {
    const customName = 'signal-user1-dev1.db';
    ensureSignalDatabaseFile(tmpDir, customName);
    expect(fs.existsSync(path.join(tmpDir, customName))).toBe(true);
  });

  it('creates separate databases for different users', () => {
    const file1 = 'signal-userA-devA.db';
    const file2 = 'signal-userB-devB.db';
    ensureSignalDatabaseFile(tmpDir, file1);
    ensureSignalDatabaseFile(tmpDir, file2);
    expect(fs.existsSync(path.join(tmpDir, file1))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, file2))).toBe(true);
  });
});

// ─── openSignalDatabase with dbFilename option ────────────────────────────────

describe('openSignalDatabase — dbFilename option', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('opens database with default filename when dbFilename not specified', () => {
    const key = makeIdentityKey();
    const db = openSignalDatabase(tmpDir, key);
    try {
      expect(fs.existsSync(path.join(tmpDir, 'signal-state.db'))).toBe(true);
    } finally {
      db.closeDatabase();
    }
  });

  it('opens database with custom filename when dbFilename specified', () => {
    const key = makeIdentityKey();
    const customName = 'signal-testuser-testdevice.db';
    const db = openSignalDatabase(tmpDir, key, { dbFilename: customName });
    try {
      expect(fs.existsSync(path.join(tmpDir, customName))).toBe(true);
      // Default file should NOT be created
      expect(fs.existsSync(path.join(tmpDir, 'signal-state.db'))).toBe(false);
    } finally {
      db.closeDatabase();
    }
  });

  it('opens separate databases for different users without interference', () => {
    const keyA = makeIdentityKey();
    const keyB = makeIdentityKey();
    const fileA = 'signal-userA-devA.db';
    const fileB = 'signal-userB-devB.db';

    const dbA = openSignalDatabase(tmpDir, keyA, { dbFilename: fileA });
    const dbB = openSignalDatabase(tmpDir, keyB, { dbFilename: fileB });

    try {
      expect(fs.existsSync(path.join(tmpDir, fileA))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, fileB))).toBe(true);
    } finally {
      dbA.closeDatabase();
      dbB.closeDatabase();
    }
  });
});
