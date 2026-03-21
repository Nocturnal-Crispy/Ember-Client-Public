/**
 * SafeStorage abstraction layer.
 *
 * Allows the main process and preload to inject platform-specific
 * secure storage implementations (e.g. Electron safeStorage).
 */

export interface SafeStorageFunctions {
  getSafeStorage(key: string): Promise<string | null>;
  setSafeStorage(key: string, value: string): Promise<void>;
  deleteSafeStorage(key: string): Promise<void>;
}

let safeStorageFunctions: SafeStorageFunctions | null = null;

/**
 * Inject the platform-specific SafeStorage implementation.
 * Must be called before any auth operations that require secure storage.
 */
export function setSafeStorageFunctions(fns: SafeStorageFunctions): void {
  safeStorageFunctions = fns;
}

/**
 * Retrieve the currently registered SafeStorage implementation.
 * Throws if not yet initialised.
 */
export function getSafeStorageImpl(): SafeStorageFunctions {
  if (!safeStorageFunctions) {
    throw new Error('SafeStorage functions not initialized');
  }
  return safeStorageFunctions;
}
