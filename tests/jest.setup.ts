import { TextEncoder, TextDecoder } from 'util';
import { webcrypto } from 'crypto';

Object.assign(global, { TextEncoder, TextDecoder });

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}
