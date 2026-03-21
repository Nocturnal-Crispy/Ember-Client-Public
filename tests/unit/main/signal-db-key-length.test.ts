/**
 * Tests for Signal database key length handling.
 *
 * Root cause: a strict `bytes.length === 32` check was added when fixing
 * the private-key storage bug.  Users who registered with the old code have
 * a 33-byte public key stored under `identity_key_*`.  The strict check
 * silently skips DB initialisation for those users, making every subsequent
 * IPC call fail with "Signal database not available".
 *
 * Fix: use whatever bytes are stored as the HKDF key (backwards-compat);
 * only populate `localIdentityPrivateKeyBytes` when the length is exactly 32
 * (i.e. an Ed25519 private key).
 */

import { resolveSignalKeyBytes } from '../../../src/main/signal-key-utils';

describe('resolveSignalKeyBytes', () => {
  it('returns null bytes when storedKey is null', () => {
    const result = resolveSignalKeyBytes(null);
    expect(result.privateKeyBytes).toBeNull();
    expect(result.localIdentityPrivateKeyBytes).toBeNull();
  });

  it('returns null bytes when storedKey is empty string', () => {
    const result = resolveSignalKeyBytes('');
    expect(result.privateKeyBytes).toBeNull();
    expect(result.localIdentityPrivateKeyBytes).toBeNull();
  });

  it('returns privateKeyBytes AND localIdentityPrivateKeyBytes for a 32-byte key', () => {
    const privateKey32 = Buffer.alloc(32, 0xab);
    const storedKey = privateKey32.toString('base64');

    const result = resolveSignalKeyBytes(storedKey);

    expect(result.privateKeyBytes).not.toBeNull();
    expect(result.privateKeyBytes!.length).toBe(32);
    expect(result.localIdentityPrivateKeyBytes).not.toBeNull();
    expect(result.localIdentityPrivateKeyBytes!.length).toBe(32);
  });

  it('returns privateKeyBytes but NOT localIdentityPrivateKeyBytes for a 33-byte key (legacy public key)', () => {
    // Legacy code stored the 33-byte libsignal public key under identity_key_*
    const publicKey33 = Buffer.alloc(33, 0x05);
    const storedKey = publicKey33.toString('base64');

    const result = resolveSignalKeyBytes(storedKey);

    // DB must open (privateKeyBytes set) so existing users can read their messages
    expect(result.privateKeyBytes).not.toBeNull();
    expect(result.privateKeyBytes!.length).toBe(33);

    // Signal crypto ops require a real private key — must NOT be set for 33-byte keys
    expect(result.localIdentityPrivateKeyBytes).toBeNull();
  });

  it('returns privateKeyBytes but NOT localIdentityPrivateKeyBytes for unexpected key lengths', () => {
    const oddKey = Buffer.alloc(20, 0xff);
    const storedKey = oddKey.toString('base64');

    const result = resolveSignalKeyBytes(storedKey);

    expect(result.privateKeyBytes).not.toBeNull();
    expect(result.localIdentityPrivateKeyBytes).toBeNull();
  });
});
