/**
 * Helper utilities for resolving Signal identity key bytes from safeStorage.
 *
 * Exported separately so they can be unit-tested without importing the full
 * Electron main-process entry point.
 */

export interface SignalKeyResolution {
  /** Raw bytes used as HKDF input to open/create the Signal SQLite database. */
  privateKeyBytes: Buffer | null;
  /**
   * Ed25519 private key (32 bytes) for initialising libsignal's identity store.
   * Only set when the stored key is exactly 32 bytes; older clients stored the
   * 33-byte public key here, so those devices can still open the DB but will
   * not have a working Signal identity until they re-register.
   */
  localIdentityPrivateKeyBytes: Buffer | null;
}

/**
 * Converts a base64-encoded safeStorage value into the two byte buffers needed
 * for `openSignalDatabase`.
 *
 * Backwards-compatibility rule:
 *   - Any non-empty stored key is accepted as HKDF input so that databases
 *     created with the old 33-byte public key remain accessible.
 *   - `localIdentityPrivateKeyBytes` is only populated for 32-byte keys
 *     (Ed25519 private key) because libsignal requires the private key for
 *     encryption/decryption operations.
 */
export function resolveSignalKeyBytes(storedKey: string | null): SignalKeyResolution {
  if (!storedKey) {
    return { privateKeyBytes: null, localIdentityPrivateKeyBytes: null };
  }

  const bytes = Buffer.from(storedKey, 'base64');

  if (bytes.length === 0) {
    return { privateKeyBytes: null, localIdentityPrivateKeyBytes: null };
  }

  return {
    privateKeyBytes: bytes,
    localIdentityPrivateKeyBytes: bytes.length === 32 ? bytes : null,
  };
}
