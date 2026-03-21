/**
 * SQLite-backed Signal Protocol store.
 *
 * Persists all Signal Protocol state in a single better-sqlite3 database at
 * userDataPath/signal-state.db. All BLOB columns are encrypted with
 * AES-256-GCM using a key derived from the device identity private key via
 * HKDF-SHA-256. Encrypted envelope format: [IV(12) | authTag(16) | ciphertext].
 */

import Database from 'better-sqlite3';
import * as nodeCrypto from 'crypto';
import * as path from 'path';
import { PrivateKey } from '@signalapp/libsignal-client';

import type {
  ISessionStore,
  IIdentityKeyStore,
  IPreKeyStore,
  ISignedPreKeyStore,
  IKyberPreKeyStore,
  ISenderKeyStore,
} from 'ember-shared';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SignalDatabase
  extends ISessionStore,
    IIdentityKeyStore,
    IPreKeyStore,
    ISignedPreKeyStore,
    IKyberPreKeyStore,
    ISenderKeyStore {
  storeDistributionId(address: string, distributionId: string): void;
  loadDistributionId(address: string): string | null;
  /**
   * Initialise (or overwrite) the local Signal Protocol identity and registration id.
   *
   * Writes:
   * - `__local__` (public+private Ed25519 key pair)
   * - `__registration_id__` (registration id stored in `key_pair_public`)
   */
  initializeLocalIdentity(
    identityKeyPair: { readonly publicKey: Uint8Array; readonly privateKey: Uint8Array },
    registrationId: number,
    localIdentityAddress?: string,
  ): void;
  closeDatabase(): void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_FILENAME = 'signal-state.db';
const HKDF_INFO = Buffer.from('signal-db-encryption');
// All-zeros salt is permitted by RFC 5869 and safe here because the IKM is a
// high-entropy 32-byte Curve25519 private key. A non-zero per-application salt
// (e.g. SHA-256 of a constant string) would provide stronger domain separation
// and is the recommended upgrade path if the IKM source ever changes.
const HKDF_SALT = Buffer.alloc(32);
const DERIVED_KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm' as const;

// ─── DDL ──────────────────────────────────────────────────────────────────────

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS identity_keys (
    name TEXT PRIMARY KEY,
    key_pair_public BLOB NOT NULL,
    key_pair_private BLOB NOT NULL,
    trust_level INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    address TEXT PRIMARY KEY,
    record BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pre_keys (
    id INTEGER PRIMARY KEY,
    record BLOB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS signed_pre_keys (
    id INTEGER PRIMARY KEY,
    record BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sender_keys (
    address TEXT NOT NULL,
    distribution_id TEXT NOT NULL,
    record BLOB NOT NULL,
    PRIMARY KEY (address, distribution_id)
  )`,
  `CREATE TABLE IF NOT EXISTS kyber_pre_keys (
    id INTEGER PRIMARY KEY,
    record BLOB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS distribution_ids (
    address TEXT PRIMARY KEY,
    distribution_id TEXT NOT NULL
  )`,
];

// ─── Encryption helpers ───────────────────────────────────────────────────────

function deriveEncryptionKey(identityPrivateKey: Uint8Array): Buffer {
  return Buffer.from(nodeCrypto.hkdfSync(
    'sha256',
    identityPrivateKey,
    HKDF_SALT,
    HKDF_INFO,
    DERIVED_KEY_LENGTH,
  ));
}

function validateIdentityKeyConsistency(storedKey: Uint8Array, providedKey: Uint8Array): boolean {
  if (storedKey.length !== providedKey.length) {
    return false;
  }
  try {
    return nodeCrypto.timingSafeEqual(Buffer.from(storedKey), Buffer.from(providedKey));
  } catch (error) {
    return false;
  }
}

// aad binds each ciphertext to its row context (table + primary key), preventing
// a copied blob from decrypting successfully in a different row or table.
function encryptBlob(derivedKey: Buffer, plaintext: Uint8Array, aad: Buffer): Buffer {
  const iv = nodeCrypto.randomBytes(IV_LENGTH);
  const cipher = nodeCrypto.createCipheriv(ALGORITHM, derivedKey, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptBlob(derivedKey: Buffer, envelope: Buffer, aad: Buffer): Uint8Array {
  try {
    if (envelope.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Invalid envelope: too short');
    }
    
    const iv = envelope.subarray(0, IV_LENGTH);
    const authTag = envelope.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = envelope.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    if (iv.length !== IV_LENGTH) {
      throw new Error('Invalid IV length');
    }
    
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Invalid auth tag length');
    }

    const decipher = nodeCrypto.createDecipheriv(ALGORITHM, derivedKey, iv);
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

function bufferEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Open (or create) the Signal Protocol SQLite database and return a fully
 * initialised store.
 *
 * @param userDataPath       Directory where signal-state.db will be stored.
 * @param identityPrivateKey 32-byte private key used to derive the AES key.
 */
export function openSignalDatabase(
  userDataPath: string,
  identityPrivateKey: Uint8Array,
  options?: {
    readonly localIdentityPrivateKey?: Uint8Array;
    readonly localIdentityPublicKey?: Uint8Array;
    readonly localRegistrationId?: number;
    readonly localIdentityAddress?: string;
  },
): SignalDatabase {
  const dbPath = path.join(userDataPath, DB_FILENAME);
  let db: Database.Database | undefined;
  
  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Create tables one at a time using prepared run statements to avoid
    // the multi-statement exec API.
    for (const ddl of DDL_STATEMENTS) {
      db.prepare(ddl).run();
    }
  } catch (error) {
    // Ensure database is closed if initialization fails
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore errors during cleanup
      }
    }
    throw error;
  }

  const encryptionKey = deriveEncryptionKey(identityPrivateKey);

  // Local identity material used by getIdentityKeyPair() and saveIdentity().
  // Optional at open-time; can be initialised later (e.g. after migration).
  let localIdentityPrivateKey: Uint8Array | null = options?.localIdentityPrivateKey ?? null;
  let localIdentityPublicKey: Uint8Array | null = options?.localIdentityPublicKey ?? null;
  let localIdentityAddress: string | null = options?.localIdentityAddress ?? null;

  function derivePublicKeyFromEd25519PrivateKey(priv: Uint8Array): Uint8Array {
    if (priv.length !== 32) {
      throw new Error('signal-db: expected 32-byte Ed25519 identity private key');
    }
    const key = PrivateKey.deserialize(Buffer.from(priv));
    return new Uint8Array(key.getPublicKey().serialize());
  }

  // ── Prepared statements ──────────────────────────────────────────────────

  const stmts = {
    loadSession: db.prepare('SELECT record FROM sessions WHERE address = ?'),
    storeSession: db.prepare(
      'INSERT OR REPLACE INTO sessions (address, record, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ),
    getSubDeviceSessions: db.prepare(
      "SELECT address FROM sessions WHERE address LIKE ? || '.%'",
    ),
    removeSession: db.prepare('DELETE FROM sessions WHERE address = ?'),
    removeAllSessions: db.prepare(
      "DELETE FROM sessions WHERE address LIKE ? || '.%'",
    ),
    loadIdentityKeyRow: db.prepare(
      'SELECT key_pair_public, key_pair_private FROM identity_keys WHERE name = ?',
    ),
    loadPublicKey: db.prepare(
      'SELECT key_pair_public FROM identity_keys WHERE name = ?',
    ),
    storeIdentityKey: db.prepare(
      'INSERT OR REPLACE INTO identity_keys (name, key_pair_public, key_pair_private, trust_level) VALUES (?, ?, ?, ?)',
    ),
    loadPreKey: db.prepare('SELECT record FROM pre_keys WHERE id = ?'),
    storePreKey: db.prepare('INSERT OR REPLACE INTO pre_keys (id, record) VALUES (?, ?)'),
    removePreKey: db.prepare('DELETE FROM pre_keys WHERE id = ?'),
    loadSignedPreKey: db.prepare('SELECT record FROM signed_pre_keys WHERE id = ?'),
    storeSignedPreKey: db.prepare(
      'INSERT OR REPLACE INTO signed_pre_keys (id, record, created_at) VALUES (?, ?, ?)',
    ),
    removeSignedPreKey: db.prepare('DELETE FROM signed_pre_keys WHERE id = ?'),
    saveSenderKey: db.prepare(
      'INSERT OR REPLACE INTO sender_keys (address, distribution_id, record) VALUES (?, ?, ?)',
    ),
    getSenderKey: db.prepare(
      'SELECT record FROM sender_keys WHERE address = ? AND distribution_id = ?',
    ),
    loadKyberPreKey: db.prepare('SELECT record FROM kyber_pre_keys WHERE id = ?'),
    storeKyberPreKey: db.prepare(
      'INSERT OR REPLACE INTO kyber_pre_keys (id, record) VALUES (?, ?)',
    ),
    removeKyberPreKey: db.prepare('DELETE FROM kyber_pre_keys WHERE id = ?'),
    storeDistributionIdStmt: db.prepare(
      'INSERT OR REPLACE INTO distribution_ids (address, distribution_id) VALUES (?, ?)',
    ),
    loadDistributionIdStmt: db.prepare(
      'SELECT distribution_id FROM distribution_ids WHERE address = ?',
    ),
  };

  // ── Local identity initialisation ─────────────────────────────────────────

  const existingLocalRow = stmts.loadIdentityKeyRow.get('__local__') as
    | { key_pair_public: Buffer; key_pair_private: Buffer }
    | undefined;

  if (existingLocalRow) {
    const decryptedPublic = decryptBlob(
      encryptionKey,
      existingLocalRow.key_pair_public,
      Buffer.from('identity_keys:__local__:public'),
    );
    const decryptedPrivate = decryptBlob(
      encryptionKey,
      existingLocalRow.key_pair_private,
      Buffer.from('identity_keys:__local__:private'),
    );

    // Validate decrypted key material so libsignal doesn't later fail on empty/corrupt rows.
    if (decryptedPublic.length === 0) {
      throw new Error('signal-db: corrupted __local__ public key (empty)');
    }
    if (decryptedPrivate.length !== 32) {
      throw new Error('signal-db: corrupted __local__ private key length');
    }

    // CRITICAL FIX: Validate identity key consistency to prevent crypto authentication failures
    // If the stored identity key doesn't match the provided key, the database was opened with wrong key
    if (!validateIdentityKeyConsistency(decryptedPrivate, identityPrivateKey)) {
      throw new Error(
        'Identity key mismatch: Signal database was opened with a different identity private key. ' +
        'This causes "Authentication failed" errors. Please restart the application with the correct identity key.'
      );
    }

    localIdentityPublicKey = decryptedPublic;
    localIdentityPrivateKey = decryptedPrivate;
  }

  if (
    !existingLocalRow &&
    localIdentityPrivateKey &&
    !localIdentityPublicKey &&
    options?.localIdentityPrivateKey
  ) {
    if (localIdentityPrivateKey.length !== 32) {
      throw new Error('signal-db: expected 32-byte localIdentityPrivateKey');
    }
    localIdentityPublicKey = derivePublicKeyFromEd25519PrivateKey(options.localIdentityPrivateKey);
  }

  if (
    !existingLocalRow &&
    localIdentityPrivateKey &&
    localIdentityPublicKey &&
    options?.localRegistrationId !== undefined
  ) {
    if (options.localRegistrationId < 1 || options.localRegistrationId > 16383) {
      throw new Error('signal-db: localRegistrationId out of range [1, 16383]');
    }
    if (localIdentityPrivateKey.length !== 32 || localIdentityPublicKey.length === 0) {
      throw new Error('signal-db: local identity key material must have 32-byte private key and non-empty public key');
    }

    stmts.storeIdentityKey.run(
      '__local__',
      encryptBlob(
        encryptionKey,
        localIdentityPublicKey,
        Buffer.from('identity_keys:__local__:public'),
      ),
      encryptBlob(
        encryptionKey,
        localIdentityPrivateKey,
        Buffer.from('identity_keys:__local__:private'),
      ),
      0,
    );

    const registrationBytes = new Uint8Array(4);
    new DataView(registrationBytes.buffer).setUint32(0, options.localRegistrationId, false); // big-endian
    stmts.storeIdentityKey.run(
      '__registration_id__',
      encryptBlob(
        encryptionKey,
        registrationBytes,
        Buffer.from('identity_keys:__registration_id__:public'),
      ),
      encryptBlob(
        encryptionKey,
        registrationBytes,
        Buffer.from('identity_keys:__registration_id__:private'),
      ),
      0,
    );
  }

  // If the local key pair exists but the registration row does not, initialise
  // registration id independently.
  const existingRegistrationRow = stmts.loadIdentityKeyRow.get('__registration_id__') as
    | { key_pair_public: Buffer; key_pair_private: Buffer }
    | undefined;

  if (!existingRegistrationRow && options?.localRegistrationId !== undefined) {
    if (options.localRegistrationId < 1 || options.localRegistrationId > 16383) {
      throw new Error('signal-db: localRegistrationId out of range [1, 16383]');
    }
    const registrationBytes = new Uint8Array(4);
    new DataView(registrationBytes.buffer).setUint32(0, options.localRegistrationId, false); // big-endian
    stmts.storeIdentityKey.run(
      '__registration_id__',
      encryptBlob(
        encryptionKey,
        registrationBytes,
        Buffer.from('identity_keys:__registration_id__:public'),
      ),
      encryptBlob(
        encryptionKey,
        registrationBytes,
        Buffer.from('identity_keys:__registration_id__:private'),
      ),
      0,
    );
  }

  // ── ISessionStore ────────────────────────────────────────────────────────

  async function loadSession(address: string): Promise<Uint8Array | null> {
    const row = stmts.loadSession.get(address) as { record: Buffer } | undefined;
    if (!row) return null;
    return decryptBlob(encryptionKey, row.record, Buffer.from(`sessions:${address}`));
  }

  async function storeSession(address: string, record: Uint8Array): Promise<void> {
    const encrypted = encryptBlob(encryptionKey, record, Buffer.from(`sessions:${address}`));
    const now = Date.now();
    stmts.storeSession.run(address, encrypted, now, now);
  }

  async function getSubDeviceSessions(name: string): Promise<number[]> {
    const rows = stmts.getSubDeviceSessions.all(name) as { address: string }[];
    return rows.map((r) => {
      const dotIndex = r.address.lastIndexOf('.');
      return parseInt(r.address.slice(dotIndex + 1), 10);
    });
  }

  async function removeSession(address: string): Promise<void> {
    stmts.removeSession.run(address);
  }

  async function removeAllSessions(name: string): Promise<void> {
    stmts.removeAllSessions.run(name);
  }

  // ── IIdentityKeyStore ────────────────────────────────────────────────────

  async function getIdentityKeyPair(): Promise<{
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
  }> {
    const row = stmts.loadIdentityKeyRow.get('__local__') as
      | { key_pair_public: Buffer; key_pair_private: Buffer }
      | undefined;
    if (!row) {
      throw new Error('signal-db: local identity key pair not initialised');
    }
    const publicKey = decryptBlob(encryptionKey, row.key_pair_public, Buffer.from('identity_keys:__local__:public'));
    const privateKey = decryptBlob(encryptionKey, row.key_pair_private, Buffer.from('identity_keys:__local__:private'));
    if (publicKey.length === 0 || privateKey.length !== 32) {
      throw new Error('signal-db: corrupted __local__ key material');
    }
    return { publicKey, privateKey };
  }

  async function getLocalRegistrationId(): Promise<number> {
    const row = stmts.loadIdentityKeyRow.get('__registration_id__') as
      | { key_pair_public: Buffer; key_pair_private: Buffer }
      | undefined;
    if (!row) {
      throw new Error('signal-db: local registration ID not initialised');
    }
    const decrypted = decryptBlob(encryptionKey, row.key_pair_public, Buffer.from('identity_keys:__registration_id__:public'));
    if (decrypted.length !== 4) {
      throw new Error('signal-db: corrupted __registration_id__ value');
    }
    const view = new DataView(
      decrypted.buffer,
      decrypted.byteOffset,
      decrypted.byteLength,
    );
    return view.getUint32(0, false);
  }

  async function saveIdentity(
    address: string,
    identityKey: Uint8Array,
  ): Promise<boolean> {
    const existing = stmts.loadPublicKey.get(address) as
      | { key_pair_public: Buffer }
      | undefined;

    const encryptedPublic = encryptBlob(
      encryptionKey,
      identityKey,
      Buffer.from(`identity_keys:${address}:public`),
    );
    const needsLocalPrivate =
      address === '__local__' ||
      (localIdentityAddress !== null && address === localIdentityAddress);
    if (needsLocalPrivate && !localIdentityPrivateKey) {
      throw new Error('signal-db: local identity private key not initialised');
    }
    const privatePlaintext = needsLocalPrivate ? localIdentityPrivateKey! : new Uint8Array(0);
    const encryptedPrivate = encryptBlob(
      encryptionKey,
      privatePlaintext,
      Buffer.from(`identity_keys:${address}:private`),
    );
    stmts.storeIdentityKey.run(address, encryptedPublic, encryptedPrivate, 0);

    if (!existing) return false;
    const stored = decryptBlob(encryptionKey, existing.key_pair_public, Buffer.from(`identity_keys:${address}:public`));
    return !bufferEquals(stored, identityKey);
  }

  async function isTrustedIdentity(
    address: string,
    identityKey: Uint8Array,
    _direction: 'sending' | 'receiving',
  ): Promise<boolean> {
    const row = stmts.loadPublicKey.get(address) as
      | { key_pair_public: Buffer }
      | undefined;
    if (!row) return true; // TOFU

    const stored = decryptBlob(encryptionKey, row.key_pair_public, Buffer.from(`identity_keys:${address}:public`));
    return bufferEquals(stored, identityKey);
  }

  async function getIdentity(address: string): Promise<Uint8Array | null> {
    const row = stmts.loadPublicKey.get(address) as
      | { key_pair_public: Buffer }
      | undefined;
    if (!row) return null;
    return decryptBlob(encryptionKey, row.key_pair_public, Buffer.from(`identity_keys:${address}:public`));
  }

  // ── IPreKeyStore ─────────────────────────────────────────────────────────

  async function loadPreKey(id: number): Promise<Uint8Array | null> {
    const row = stmts.loadPreKey.get(id) as { record: Buffer } | undefined;
    if (!row) return null;
    return decryptBlob(encryptionKey, row.record, Buffer.from(`pre_keys:${id}`));
  }

  async function storePreKey(id: number, record: Uint8Array): Promise<void> {
    stmts.storePreKey.run(id, encryptBlob(encryptionKey, record, Buffer.from(`pre_keys:${id}`)));
  }

  async function removePreKey(id: number): Promise<void> {
    stmts.removePreKey.run(id);
  }

  // ── ISignedPreKeyStore ───────────────────────────────────────────────────

  async function loadSignedPreKey(id: number): Promise<Uint8Array | null> {
    const row = stmts.loadSignedPreKey.get(id) as { record: Buffer } | undefined;
    if (!row) return null;
    return decryptBlob(encryptionKey, row.record, Buffer.from(`signed_pre_keys:${id}`));
  }

  async function storeSignedPreKey(id: number, record: Uint8Array): Promise<void> {
    stmts.storeSignedPreKey.run(id, encryptBlob(encryptionKey, record, Buffer.from(`signed_pre_keys:${id}`)), Date.now());
  }

  async function removeSignedPreKey(id: number): Promise<void> {
    stmts.removeSignedPreKey.run(id);
  }

  // ── ISenderKeyStore ──────────────────────────────────────────────────────

  async function saveSenderKey(
    address: string,
    distributionId: string,
    record: Uint8Array,
  ): Promise<void> {
    stmts.saveSenderKey.run(
      address,
      distributionId,
      encryptBlob(encryptionKey, record, Buffer.from(`sender_keys:${address}:${distributionId}`)),
    );
  }

  async function getSenderKey(
    address: string,
    distributionId: string,
  ): Promise<Uint8Array | null> {
    const row = stmts.getSenderKey.get(address, distributionId) as
      | { record: Buffer }
      | undefined;
    if (!row) return null;
    return decryptBlob(encryptionKey, row.record, Buffer.from(`sender_keys:${address}:${distributionId}`));
  }

  // ── IKyberPreKeyStore ────────────────────────────────────────────────────

  async function loadKyberPreKey(id: number): Promise<Uint8Array | null> {
    const row = stmts.loadKyberPreKey.get(id) as { record: Buffer } | undefined;
    if (!row) return null;
    return decryptBlob(encryptionKey, row.record, Buffer.from(`kyber_pre_keys:${id}`));
  }

  async function storeKyberPreKey(id: number, record: Uint8Array): Promise<void> {
    stmts.storeKyberPreKey.run(id, encryptBlob(encryptionKey, record, Buffer.from(`kyber_pre_keys:${id}`)));
  }

  async function markKyberPreKeyUsed(_id: number): Promise<void> {
    // No-op: consumption tracking is delegated to the caller.
  }

  async function removeKyberPreKey(id: number): Promise<void> {
    stmts.removeKyberPreKey.run(id);
  }

  // ── Distribution ID store ────────────────────────────────────────────────

  function storeDistributionId(address: string, distributionId: string): void {
    stmts.storeDistributionIdStmt.run(address, distributionId);
  }

  function loadDistributionId(address: string): string | null {
    const row = stmts.loadDistributionIdStmt.get(address) as
      | { distribution_id: string }
      | undefined;
    return row ? row.distribution_id : null;
  }

  // ── Local identity initialisation ─────────────────────────────────────────

  function initializeLocalIdentity(
    identityKeyPair: { readonly publicKey: Uint8Array; readonly privateKey: Uint8Array },
    registrationId: number,
    localIdentityAddressArg?: string,
  ): void {
    if (identityKeyPair.privateKey.length !== 32) {
      throw new Error('signal-db: expected 32-byte Ed25519 identity private key');
    }
    if (identityKeyPair.publicKey.length === 0) {
      throw new Error('signal-db: expected non-empty identityKeyPair.publicKey');
    }
    if (registrationId < 1 || registrationId > 16383) {
      throw new Error('signal-db: registrationId out of range [1, 16383]');
    }

    if (localIdentityAddressArg) {
      localIdentityAddress = localIdentityAddressArg;
    }

    localIdentityPrivateKey = identityKeyPair.privateKey;
    localIdentityPublicKey = identityKeyPair.publicKey;

    // __local__ identity keypair.
    stmts.storeIdentityKey.run(
      '__local__',
      encryptBlob(
        encryptionKey,
        identityKeyPair.publicKey,
        Buffer.from('identity_keys:__local__:public'),
      ),
      encryptBlob(
        encryptionKey,
        identityKeyPair.privateKey,
        Buffer.from('identity_keys:__local__:private'),
      ),
      0,
    );

    // __registration_id__ row: value stored in `key_pair_public`.
    const registrationBytes = new Uint8Array(4);
    new DataView(registrationBytes.buffer).setUint32(0, registrationId, false); // big-endian

    stmts.storeIdentityKey.run(
      '__registration_id__',
      encryptBlob(
        encryptionKey,
        registrationBytes,
        Buffer.from('identity_keys:__registration_id__:public'),
      ),
      encryptBlob(
        encryptionKey,
        registrationBytes,
        Buffer.from('identity_keys:__registration_id__:private'),
      ),
      0,
    );
  }

  // ── closeDatabase ────────────────────────────────────────────────────────

  function closeDatabase(): void {
    if (db) {
      db.close();
    }
  }

  return {
    loadSession,
    storeSession,
    getSubDeviceSessions,
    removeSession,
    removeAllSessions,
    getIdentityKeyPair,
    getLocalRegistrationId,
    saveIdentity,
    isTrustedIdentity,
    getIdentity,
    loadPreKey,
    storePreKey,
    removePreKey,
    loadSignedPreKey,
    storeSignedPreKey,
    removeSignedPreKey,
    saveSenderKey,
    getSenderKey,
    loadKyberPreKey,
    storeKyberPreKey,
    markKyberPreKeyUsed,
    removeKyberPreKey,
    storeDistributionId,
    loadDistributionId,
    initializeLocalIdentity,
    closeDatabase,
  };
}
