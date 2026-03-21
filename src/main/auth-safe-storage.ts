/**
 * Integration of auth.ts with Electron's safeStorage
 * 
 * This file wires up the auth service with the existing
 * Electron safeStorage setup in ember-client/src/main/index.ts
 */

import { safeStorage } from 'electron';
import Store from 'electron-store';
import { setSafeStorageFunctions, type SafeStorageFunctions } from '../shared';

const store = new Store();

// SafeStorage implementation using Electron's safeStorage and electron-store
export const electronSafeStorageFunctions: SafeStorageFunctions = {
  async getSafeStorage(key: string): Promise<string | null> {
    const storeKey = `safeStorage_${key}`;
    const stored = store.get(storeKey) as string | undefined;
    
    if (!stored) {
      return null;
    }
    
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(stored, 'base64'));
      } catch {
        // Fallback to plaintext if decryption fails
        return stored;
      }
    }
    
    return stored;
  },

  async setSafeStorage(key: string, value: string): Promise<void> {
    const storeKey = `safeStorage_${key}`;
    
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      store.set(storeKey, encrypted.toString('base64'));
    } else {
      store.set(storeKey, value);
    }
  },

  async deleteSafeStorage(key: string): Promise<void> {
    const storeKey = `safeStorage_${key}`;
    store.delete(storeKey);
  }
};

// Initialize the auth service with Electron safeStorage
export function initializeAuthWithElectronSafeStorage(): void {
  setSafeStorageFunctions(electronSafeStorageFunctions);
}
