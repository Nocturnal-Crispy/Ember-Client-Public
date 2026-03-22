/**
 * Unit tests for src/main/signal-db.ts
 *
 * Tests the SQLite-backed Signal Protocol store implementation.
 * Uses temporary directories so each test gets a fresh database.
 */

// @jest-environment node

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { PrivateKey } from '@signalapp/libsignal-client';
import { openSignalDatabase } from '../../../src/main/signal-db';
import type { SignalDatabase } from '../../../src/main/signal-db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a random 32-byte identity private key for test usage. */
function makeIdentityKey(): Uint8Array {
  return crypto.randomBytes(32);
}

/** Generate a temporary directory path unique to this test run. */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'signal-db-test-'));
}

/** Generate random bytes for use as a serialised record blob. */
function makeRecord(length = 64): Uint8Array {
  return crypto.randomBytes(length);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let identityKey: Uint8Array;
let db: SignalDatabase;

beforeEach(() => {
  tmpDir = makeTmpDir();
  identityKey = makeIdentityKey();
});

afterEach(() => {
  // Close DB if still open, then remove the temp directory.
  try {
    db?.closeDatabase();
  } catch {
    // already closed — ignore
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Database creation ────────────────────────────────────────────────────────

describe('openSignalDatabase — file creation', () => {
  it('creates the database file on first open', () => {
    db = openSignalDatabase(tmpDir, identityKey);

    const dbPath = path.join(tmpDir, 'signal-state.db');
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('opens without error when called a second time on the same path', () => {
    db = openSignalDatabase(tmpDir, identityKey);
    db.closeDatabase();

    expect(() => {
      db = openSignalDatabase(tmpDir, identityKey);
    }).not.toThrow();
  });

  it('returns an object with all required store methods', () => {
    db = openSignalDatabase(tmpDir, identityKey);

    // ISessionStore
    expect(typeof db.loadSession).toBe('function');
    expect(typeof db.storeSession).toBe('function');
    expect(typeof db.getSubDeviceSessions).toBe('function');
    expect(typeof db.removeSession).toBe('function');
    expect(typeof db.removeAllSessions).toBe('function');

    // IIdentityKeyStore
    expect(typeof db.getIdentityKeyPair).toBe('function');
    expect(typeof db.getLocalRegistrationId).toBe('function');
    expect(typeof db.saveIdentity).toBe('function');
    expect(typeof db.isTrustedIdentity).toBe('function');
    expect(typeof db.getIdentity).toBe('function');

    // IPreKeyStore
    expect(typeof db.loadPreKey).toBe('function');
    expect(typeof db.storePreKey).toBe('function');
    expect(typeof db.removePreKey).toBe('function');

    // ISignedPreKeyStore
    expect(typeof db.loadSignedPreKey).toBe('function');
    expect(typeof db.storeSignedPreKey).toBe('function');
    expect(typeof db.removeSignedPreKey).toBe('function');

    // ISenderKeyStore
    expect(typeof db.saveSenderKey).toBe('function');
    expect(typeof db.getSenderKey).toBe('function');

    // IKyberPreKeyStore
    expect(typeof db.loadKyberPreKey).toBe('function');
    expect(typeof db.storeKyberPreKey).toBe('function');
    expect(typeof db.markKyberPreKeyUsed).toBe('function');
    expect(typeof db.removeKyberPreKey).toBe('function');

    // Extra methods
    expect(typeof db.closeDatabase).toBe('function');
  });
});

// ─── Session store ────────────────────────────────────────────────────────────

describe('ISessionStore', () => {
  beforeEach(() => {
    db = openSignalDatabase(tmpDir, identityKey);
  });

  it('loadSession returns null for an unknown address', async () => {
    const result = await db.loadSession('alice.1');
    expect(result).toBeNull();
  });

  it('storeSession then loadSession round-trip preserves bytes', async () => {
    const address = 'alice.1';
    const record = makeRecord();

    await db.storeSession(address, record);
    const loaded = await db.loadSession(address);

    expect(loaded).not.toBeNull();
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(record));
  });

  it('overwriting a session with storeSession reflects the new bytes', async () => {
    const address = 'bob.2';
    const first = makeRecord();
    const second = makeRecord();

    await db.storeSession(address, first);
    await db.storeSession(address, second);
    const loaded = await db.loadSession(address);

    expect(Buffer.from(loaded!)).toEqual(Buffer.from(second));
    expect(Buffer.from(loaded!)).not.toEqual(Buffer.from(first));
  });

  it('session persists across close and reopen', async () => {
    const address = 'carol.3';
    const record = makeRecord();

    await db.storeSession(address, record);
    db.closeDatabase();

    // Reopen with same key
    db = openSignalDatabase(tmpDir, identityKey);
    const loaded = await db.loadSession(address);

    expect(loaded).not.toBeNull();
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(record));
  });

  it('removeSession deletes the session so loadSession returns null', async () => {
    const address = 'dave.1';
    await db.storeSession(address, makeRecord());
    await db.removeSession(address);

    expect(await db.loadSession(address)).toBeNull();
  });

  it('removeAllSessions deletes all sessions for a name', async () => {
    await db.storeSession('eve.1', makeRecord());
    await db.storeSession('eve.2', makeRecord());
    await db.storeSession('frank.1', makeRecord());

    await db.removeAllSessions('eve');

    expect(await db.loadSession('eve.1')).toBeNull();
    expect(await db.loadSession('eve.2')).toBeNull();
    // frank's session must be untouched
    expect(await db.loadSession('frank.1')).not.toBeNull();
  });

  it('getSubDeviceSessions returns device IDs for matching sessions', async () => {
    await db.storeSession('grace.1', makeRecord());
    await db.storeSession('grace.3', makeRecord());
    await db.storeSession('heidi.1', makeRecord());

    const deviceIds = await db.getSubDeviceSessions('grace');

    expect(deviceIds).toContain(1);
    expect(deviceIds).toContain(3);
    // grace's session list must not include heidi's device IDs
    // (heidi has device 1, but we verify separation via a separate query)
    expect(deviceIds).toHaveLength(2);
    // Verify heidi's sessions are separate
    const heidiIds = await db.getSubDeviceSessions('heidi');
    expect(heidiIds).toEqual([1]);
  });

  it('getSubDeviceSessions returns empty array when name has no sessions', async () => {
    const deviceIds = await db.getSubDeviceSessions('nobody');
    expect(deviceIds).toEqual([]);
  });
});

// ─── PreKey store ─────────────────────────────────────────────────────────────

describe('IPreKeyStore', () => {
  beforeEach(() => {
    db = openSignalDatabase(tmpDir, identityKey);
  });

  it('loadPreKey returns null for an unknown ID', async () => {
    expect(await db.loadPreKey(999)).toBeNull();
  });

  it('storePreKey then loadPreKey round-trip preserves bytes', async () => {
    const record = makeRecord();
    await db.storePreKey(1, record);
    const loaded = await db.loadPreKey(1);

    expect(loaded).not.toBeNull();
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(record));
  });

  it('removePreKey causes loadPreKey to return null', async () => {
    await db.storePreKey(42, makeRecord());
    await db.removePreKey(42);
    expect(await db.loadPreKey(42)).toBeNull();
  });

  it('preKey persists across close and reopen', async () => {
    const record = makeRecord();
    await db.storePreKey(7, record);
    db.closeDatabase();

    db = openSignalDatabase(tmpDir, identityKey);
    const loaded = await db.loadPreKey(7);

    expect(loaded).not.toBeNull();
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(record));
  });
});

// ─── SignedPreKey store ───────────────────────────────────────────────────────

describe('ISignedPreKeyStore', () => {
  beforeEach(() => {
    db = openSignalDatabase(tmpDir, identityKey);
  });

  it('loadSignedPreKey returns null for an unknown ID', async () => {
    expect(await db.loadSignedPreKey(999)).toBeNull();
  });

  it('storeSignedPreKey then loadSignedPreKey round-trip preserves bytes', async () => {
    const record = makeRecord();
    await db.storeSignedPreKey(10, record);
    const loaded = await db.loadSignedPreKey(10);

    expect(loaded).not.toBeNull();
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(record));
  });

  it('removeSignedPreKey causes loadSignedPreKey to return null', async () => {
    await db.storeSignedPreKey(5, makeRecord());
    await db.removeSignedPreKey(5);
    expect(await db.loadSignedPreKey(5)).toBeNull();
  });
});

// ─── SenderKey store ──────────────────────────────────────────────────────────

describe('ISenderKeyStore', () => {
  beforeEach(() => {
    db = openSignalDatabase(tmpDir, identityKey);
  });

  it('getSenderKey returns null for unknown address/distributionId', async () => {
    expect(await db.getSenderKey('alice.1', 'dist-uuid-1')).toBeNull();
  });

  it('saveSenderKey then getSenderKey round-trip preserves bytes', async () => {
    const record = makeRecord();
    await db.saveSenderKey('alice.1', 'dist-uuid-1', record);
    const loaded = await db.getSenderKey('alice.1', 'dist-uuid-1');

    expect(loaded).not.toBeNull();
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(record));
  });

  it('keys with same address but different distributionId are stored independently', async () => {
    const record1 = makeRecord();
    const record2 = makeRecord();

    await db.saveSenderKey('alice.1', 'dist-A', record1);
    await db.saveSenderKey('alice.1', 'dist-B', record2);

    const loaded1 = await db.getSenderKey('alice.1', 'dist-A');
    const loaded2 = await db.getSenderKey('alice.1', 'dist-B');

    expect(Buffer.from(loaded1!)).toEqual(Buffer.from(record1));
    expect(Buffer.from(loaded2!)).toEqual(Buffer.from(record2));
  });
});

// ─── KyberPreKey store ────────────────────────────────────────────────────────

describe('IKyberPreKeyStore', () => {
  beforeEach(() => {
    db = openSignalDatabase(tmpDir, identityKey);
  });

  it('loadKyberPreKey returns null for an unknown ID', async () => {
    expect(await db.loadKyberPreKey(999)).toBeNull();
  });

  it('storeKyberPreKey then loadKyberPreKey round-trip preserves bytes', async () => {
    const record = makeRecord();
    await db.storeKyberPreKey(100, record);
    const loaded = await db.loadKyberPreKey(100);

    expect(loaded).not.toBeNull();
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(record));
  });

  it('removeKyberPreKey causes loadKyberPreKey to return null', async () => {
    await db.storeKyberPreKey(200, makeRecord());
    await db.removeKyberPreKey(200);
    expect(await db.loadKyberPreKey(200)).toBeNull();
  });

  it('markKyberPreKeyUsed does not throw', async () => {
    await db.storeKyberPreKey(300, makeRecord());
    await expect(db.markKyberPreKeyUsed(300)).resolves.toBeUndefined();
  });

  it('kyberPreKey persists across close and reopen', async () => {
    const record = makeRecord();
    await db.storeKyberPreKey(50, record);
    db.closeDatabase();

    db = openSignalDatabase(tmpDir, identityKey);
    const loaded = await db.loadKyberPreKey(50);

    expect(loaded).not.toBeNull();
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(record));
  });
});

// ─── Identity key store ───────────────────────────────────────────────────────

describe('IIdentityKeyStore', () => {
  beforeEach(() => {
    db = openSignalDatabase(tmpDir, identityKey);
  });

  it('saveIdentity returns false for a new (previously unknown) address', async () => {
    const key = crypto.randomBytes(33);
    const changed = await db.saveIdentity('ivan.1', key);
    expect(changed).toBe(false);
  });

  it('saveIdentity returns false when key is unchanged', async () => {
    const key = crypto.randomBytes(33);
    await db.saveIdentity('judy.1', key);
    const changed = await db.saveIdentity('judy.1', key);
    expect(changed).toBe(false);
  });

  it('saveIdentity returns true when key changes for an existing address', async () => {
    const first = crypto.randomBytes(33);
    const second = crypto.randomBytes(33);
    await db.saveIdentity('karl.1', first);
    const changed = await db.saveIdentity('karl.1', second);
    expect(changed).toBe(true);
  });

  it('getIdentity returns null for an unknown address', async () => {
    expect(await db.getIdentity('unknown.1')).toBeNull();
  });

  it('getIdentity returns the stored public key after saveIdentity', async () => {
    const key = crypto.randomBytes(33);
    await db.saveIdentity('laura.1', key);
    const loaded = await db.getIdentity('laura.1');

    expect(loaded).not.toBeNull();
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(key));
  });

  it('isTrustedIdentity returns true for a brand-new address (TOFU)', async () => {
    const key = crypto.randomBytes(33);
    const trusted = await db.isTrustedIdentity('mike.1', key, 'sending');
    expect(trusted).toBe(true);
  });

  it('isTrustedIdentity returns true when the supplied key matches the stored key', async () => {
    const key = crypto.randomBytes(33);
    await db.saveIdentity('nina.1', key);
    const trusted = await db.isTrustedIdentity('nina.1', key, 'receiving');
    expect(trusted).toBe(true);
  });

  it('isTrustedIdentity returns false when the supplied key does not match', async () => {
    const storedKey = crypto.randomBytes(33);
    const differentKey = crypto.randomBytes(33);
    await db.saveIdentity('omar.1', storedKey);
    const trusted = await db.isTrustedIdentity('omar.1', differentKey, 'sending');
    expect(trusted).toBe(false);
  });
});

// ─── Local identity initialization ─────────────────────────────────────────────

describe('Local identity initialization', () => {
  it('initialises __local__ keypair and __registration_id__ on open', async () => {
    const encryptionKey = identityKey;
    const localIdentityPrivateKey = makeIdentityKey(); // Ed25519 private key (32 bytes)

    const localPrivateKeyObj = PrivateKey.deserialize(Buffer.from(localIdentityPrivateKey));
    const localIdentityPublicKey = new Uint8Array(localPrivateKeyObj.getPublicKey().serialize());

    const localRegistrationId = 12345;
    const localIdentityAddress = 'user-local.1';

    // Intentionally pass init options even if openSignalDatabase doesn't support them yet.
    // The test will fail until signal-db.ts is updated to honour these options.
    db = (
      openSignalDatabase as unknown as (
        userDataPath: string,
        identityPrivateKey: Uint8Array,
        opts: {
          localIdentityPrivateKey: Uint8Array;
          localIdentityPublicKey: Uint8Array;
          localRegistrationId: number;
          localIdentityAddress: string;
        }
      ) => SignalDatabase
    )(tmpDir, encryptionKey, {
      localIdentityPrivateKey,
      localIdentityPublicKey,
      localRegistrationId,
      localIdentityAddress,
    });

    const pair = await db.getIdentityKeyPair();
    expect(Buffer.from(pair.privateKey)).toEqual(Buffer.from(localIdentityPrivateKey));
    expect(Buffer.from(pair.publicKey)).toEqual(Buffer.from(localIdentityPublicKey));

    expect(await db.getLocalRegistrationId()).toBe(localRegistrationId);

    // Ensure saveIdentity stores non-empty key_pair_private for addresses that
    // should have a local private key available.
    await db.saveIdentity(localIdentityAddress, localIdentityPublicKey);

    const dbPath = path.join(tmpDir, 'signal-state.db');
    const rawDb = new Database(dbPath);
    const row = rawDb
      .prepare('SELECT key_pair_private FROM identity_keys WHERE name = ?')
      .get(localIdentityAddress) as { key_pair_private: Buffer } | undefined;

    expect(row).toBeDefined();

    // encryptBlob envelope format: IV(12) | authTag(16) | ciphertext(plaintextLen)
    // For a 32-byte Ed25519 private key, total envelope length is 12 + 16 + 32 = 60.
    expect(row!.key_pair_private.length).toBe(60);

    // Also verify __registration_id__ never stores an empty private key blob.
    const regRow = rawDb
      .prepare('SELECT key_pair_private FROM identity_keys WHERE name = ?')
      .get('__registration_id__') as { key_pair_private: Buffer } | undefined;

    expect(regRow).toBeDefined();
    // registrationBytes plaintext is 4 bytes, so total envelope length is 12 + 16 + 4 = 32.
    expect(regRow!.key_pair_private.length).toBe(32);

    rawDb.close();
  });

  it('initializeLocalIdentity writes __local__ and __registration_id__', async () => {
    const localIdentityPrivateKey = makeIdentityKey();
    const localPrivateKeyObj = PrivateKey.deserialize(Buffer.from(localIdentityPrivateKey));
    const localIdentityPublicKey = new Uint8Array(localPrivateKeyObj.getPublicKey().serialize());

    const localRegistrationId = 15000;
    const localIdentityAddress = 'user-local-init.1';

    // Open without local init options; then call initializeLocalIdentity.
    db = openSignalDatabase(tmpDir, identityKey);

    db.initializeLocalIdentity(
      {
        publicKey: localIdentityPublicKey,
        privateKey: localIdentityPrivateKey,
      },
      localRegistrationId,
      localIdentityAddress
    );

    const pair = await db.getIdentityKeyPair();
    expect(Buffer.from(pair.privateKey)).toEqual(Buffer.from(localIdentityPrivateKey));
    expect(Buffer.from(pair.publicKey)).toEqual(Buffer.from(localIdentityPublicKey));

    expect(await db.getLocalRegistrationId()).toBe(localRegistrationId);

    // Raw DB assertions for registration id private value.
    const dbPath = path.join(tmpDir, 'signal-state.db');
    const rawDb = new Database(dbPath);
    const regRow = rawDb
      .prepare('SELECT key_pair_private FROM identity_keys WHERE name = ?')
      .get('__registration_id__') as { key_pair_private: Buffer } | undefined;
    rawDb.close();

    expect(regRow).toBeDefined();
    expect(regRow!.key_pair_private.length).toBe(32);
  });
});

// ─── Encryption isolation ─────────────────────────────────────────────────────

describe('AES-256-GCM encryption', () => {
  it('reopening with a different identity key cannot decrypt existing records', async () => {
    db = openSignalDatabase(tmpDir, identityKey);
    const record = makeRecord();
    await db.storeSession('alice.1', record);
    db.closeDatabase();

    const differentKey = makeIdentityKey();
    const db2 = openSignalDatabase(tmpDir, differentKey);

    await expect(db2.loadSession('alice.1')).rejects.toThrow();

    db2.closeDatabase();
    // Reassign db for afterEach cleanup (already closed, that's fine)
    db = db2;
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  beforeEach(() => {
    db = openSignalDatabase(tmpDir, identityKey);
  });

  it('handles a 1-byte record correctly', async () => {
    const record = new Uint8Array([0xff]);
    await db.storePreKey(1, record);
    const loaded = await db.loadPreKey(1);
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(record));
  });

  it('handles a large record (10 000 bytes) correctly', async () => {
    const record = crypto.randomBytes(10_000);
    await db.storeSession('big.1', record);
    const loaded = await db.loadSession('big.1');
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(record));
  });

  it('handles special characters in address strings', async () => {
    const address = 'user@domain.org.1';
    const record = makeRecord();
    await db.storeSession(address, record);
    const loaded = await db.loadSession(address);
    expect(Buffer.from(loaded!)).toEqual(Buffer.from(record));
  });

  it('handles a zero-byte identity private key (boundary value)', () => {
    const zeroKey = new Uint8Array(32); // all zeros — HKDF still works
    expect(() => {
      const zeroDb = openSignalDatabase(makeTmpDir(), zeroKey);
      zeroDb.closeDatabase();
    }).not.toThrow();
  });
});
