/**
 * HKDF-SHA256 key derivation utility.
 *
 * Provides a universal HKDF implementation that works in both the Electron
 * main process (Node.js crypto) and the renderer process (SubtleCrypto).
 * All inputs and outputs are raw Uint8Array bytes.
 */

// ── Core HKDF function ─────────────────────────────────────────────────────

/**
 * Derive a key using HKDF-SHA256 (RFC 5869).
 *
 * Uses SubtleCrypto which is available in both Electron main and renderer.
 *
 * @param ikm   Input key material (e.g. DM_CMK or CRK)
 * @param salt  Optional salt (defaults to 32 zero bytes if omitted)
 * @param info  Context/application-specific info string or bytes
 * @param length  Desired output length in bytes (max 8160 = 255 * 32)
 * @returns Derived key material
 */
export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array | string,
  info: Uint8Array | string,
  length: number = 32
): Promise<Uint8Array> {
  if (length < 1 || length > 255 * 32) {
    throw new Error(`HKDF output length must be 1–8160, got ${length}`);
  }

  const saltBytes = typeof salt === 'string' ? new TextEncoder().encode(salt) : salt;
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;

  return hkdfSubtle(ikm, saltBytes, infoBytes, length);
}

// ── SubtleCrypto implementation ────────────────────────────────────────────

/** Safely extract an ArrayBuffer from a Uint8Array (avoids SharedArrayBuffer issues). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function hkdfSubtle(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;

  const baseKey = await subtle.importKey('raw', toArrayBuffer(ikm), { name: 'HKDF' }, false, [
    'deriveBits',
  ]);

  const derived = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(info),
    },
    baseKey,
    length * 8
  );

  return new Uint8Array(derived);
}

// ── Convenience builders ───────────────────────────────────────────────────

/** Encode a non-negative integer as 4 big-endian bytes. Throws for negative values. */
export function uint32BE(n: number): Uint8Array {
  if (n < 0) {
    throw new Error(`uint32BE requires a non-negative integer, got ${n}`);
  }
  const buf = new Uint8Array(4);
  buf[0] = (n >>> 24) & 0xff;
  buf[1] = (n >>> 16) & 0xff;
  buf[2] = (n >>> 8) & 0xff;
  buf[3] = n & 0xff;
  return buf;
}

/**
 * Encode a non-negative integer as 8 big-endian bytes.
 * Throws if the value is negative or exceeds Number.MAX_SAFE_INTEGER (2^53 - 1),
 * beyond which JavaScript cannot distinguish adjacent integers.
 */
export function uint64BE(n: number): Uint8Array {
  if (n < 0 || !Number.isSafeInteger(n)) {
    throw new Error(`uint64BE requires a safe non-negative integer, got ${n}`);
  }
  const buf = new Uint8Array(8);
  const hi = Math.floor(n / 0x100000000);
  const lo = n >>> 0;
  buf[0] = (hi >>> 24) & 0xff;
  buf[1] = (hi >>> 16) & 0xff;
  buf[2] = (hi >>> 8) & 0xff;
  buf[3] = hi & 0xff;
  buf[4] = (lo >>> 24) & 0xff;
  buf[5] = (lo >>> 16) & 0xff;
  buf[6] = (lo >>> 8) & 0xff;
  buf[7] = lo & 0xff;
  return buf;
}

/** Concatenate multiple Uint8Arrays into one. */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
