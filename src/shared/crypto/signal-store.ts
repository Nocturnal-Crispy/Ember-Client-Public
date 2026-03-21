/**
 * Abstract Signal Protocol store contracts.
 *
 * These interfaces define the persistence layer required by the Signal
 * Protocol session machinery. All binary data is `Uint8Array`; all methods
 * are async. Implementations are intentionally decoupled from
 * `@signalapp/libsignal-client` domain objects so that a SQLite-backed
 * production store can satisfy them without importing libsignal.
 *
 * The Sprint 1 `InMemory*Store` helpers (tests/signal-protocol/helpers/stores.ts)
 * extend the libsignal abstract base classes and are the conceptual counterparts
 * to these interfaces; production stores will implement these interfaces and
 * delegate to libsignal for serialisation/deserialisation.
 */

// ── Session store ─────────────────────────────────────────────────────────────

/**
 * Persists Signal Protocol session records keyed by protocol address string
 * (format: `"<name>.<deviceId>"`).
 */
export interface ISessionStore {
  /** Load a serialised session record for the given address, or null if absent. */
  loadSession(address: string): Promise<Uint8Array | null>;

  /** Persist a serialised session record for the given address. */
  storeSession(address: string, record: Uint8Array): Promise<void>;

  /** Return all device IDs that have an active session for the given name. */
  getSubDeviceSessions(name: string): Promise<number[]>;

  /** Remove the session for the given address. */
  removeSession(address: string): Promise<void>;

  /** Remove all sessions for the given name (all device IDs). */
  removeAllSessions(name: string): Promise<void>;
}

// ── Identity key store ────────────────────────────────────────────────────────

/**
 * Persists the local identity key pair, registration ID, and the identity
 * keys of remote peers.
 */
export interface IIdentityKeyStore {
  /** Return the local identity key pair (Curve25519 or Ed25519). */
  getIdentityKeyPair(): Promise<{ readonly publicKey: Uint8Array; readonly privateKey: Uint8Array }>;

  /** Return the local Signal registration ID (1–16383). */
  getLocalRegistrationId(): Promise<number>;

  /**
   * Persist a remote peer's identity key.
   *
   * @returns `true` if the identity key changed (i.e. a previously-known key
   *   was replaced), `false` if this is a new address or the key is unchanged.
   */
  saveIdentity(address: string, identityKey: Uint8Array): Promise<boolean>;

  /**
   * Decide whether the supplied key should be trusted for the given address
   * and direction.
   *
   * A typical implementation uses Trust-On-First-Use (TOFU): an unknown
   * address is always trusted; a known address is trusted only when the
   * supplied key matches the stored one.
   */
  isTrustedIdentity(
    address: string,
    identityKey: Uint8Array,
    direction: 'sending' | 'receiving',
  ): Promise<boolean>;

  /** Return the stored identity key for the given address, or null. */
  getIdentity(address: string): Promise<Uint8Array | null>;
}

// ── Pre-key store ─────────────────────────────────────────────────────────────

/**
 * Persists Curve25519 one-time pre-keys (EC pre-keys).
 */
export interface IPreKeyStore {
  /** Load a serialised pre-key record by ID, or null if absent. */
  loadPreKey(id: number): Promise<Uint8Array | null>;

  /** Persist a serialised pre-key record. */
  storePreKey(id: number, record: Uint8Array): Promise<void>;

  /** Remove the pre-key with the given ID (called after single-use consumption). */
  removePreKey(id: number): Promise<void>;
}

// ── Signed pre-key store ──────────────────────────────────────────────────────

/**
 * Persists Curve25519 signed pre-keys (medium-term keys rotated periodically).
 */
export interface ISignedPreKeyStore {
  /** Load a serialised signed pre-key record by ID, or null if absent. */
  loadSignedPreKey(id: number): Promise<Uint8Array | null>;

  /** Persist a serialised signed pre-key record. */
  storeSignedPreKey(id: number, record: Uint8Array): Promise<void>;

  /** Remove the signed pre-key with the given ID. */
  removeSignedPreKey(id: number): Promise<void>;
}

// ── Sender-key store ──────────────────────────────────────────────────────────

/**
 * Persists sender-key records used by the Signal Sealed Sender / group
 * messaging layer.
 *
 * Each record is keyed by the combination of a protocol-address string and a
 * distribution UUID.
 */
export interface ISenderKeyStore {
  /** Persist a serialised sender-key record. */
  saveSenderKey(address: string, distributionId: string, record: Uint8Array): Promise<void>;

  /** Load a serialised sender-key record, or null if absent. */
  getSenderKey(address: string, distributionId: string): Promise<Uint8Array | null>;
}

// ── Kyber pre-key store ───────────────────────────────────────────────────────

/**
 * Persists post-quantum (ML-KEM / Kyber) pre-keys used in the X3DH+PQ
 * handshake introduced in Signal's PQXDH specification.
 */
export interface IKyberPreKeyStore {
  /** Load a serialised Kyber pre-key record by ID, or null if absent. */
  loadKyberPreKey(id: number): Promise<Uint8Array | null>;

  /** Persist a serialised Kyber pre-key record. */
  storeKyberPreKey(id: number, record: Uint8Array): Promise<void>;

  /**
   * Mark a Kyber pre-key as consumed.
   *
   * One-time Kyber pre-keys should be deleted after use; last-resort Kyber
   * pre-keys must be retained. Implementations are responsible for
   * distinguishing between the two based on their own bookkeeping.
   */
  markKyberPreKeyUsed(id: number): Promise<void>;

  /** Remove the Kyber pre-key with the given ID. */
  removeKyberPreKey(id: number): Promise<void>;
}
