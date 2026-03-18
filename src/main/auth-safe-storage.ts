/**
 * Integration of auth.ts with Electron's safeStorage
 * 
 * This file wires up the auth service with the existing
 * Electron safeStorage setup in ember-client/src/main/index.ts
 */

import { safeStorage } from 'electron';
import Store from 'electron-store';
import { setSafeStorageFunctions, type SafeStorageFunctions } from '../../../ember-shared/src/services/auth.js';

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

// Additional helper functions to migrate existing devicePrivateKey to new system
export async function migrateDevicePrivateKeyToSafeStorage(userId: string, deviceId: string): Promise<void> {
  const oldKey = store.get("devicePrivateKey") as string | undefined;
  if (oldKey) {
    // Migrate to new safeStorage system
    await electronSafeStorageFunctions.setSafeStorage(`legacy_private_key_${userId}_${deviceId}`, oldKey);
    
    // Remove old storage
    store.delete("devicePrivateKey");
    
    console.log('Migrated devicePrivateKey to new safeStorage system');
  }
}

// Usage: In your main process startup (e.g., in src/main/index.ts):
//
// import { initializeAuthWithElectronSafeStorage, migrateDevicePrivateKeyToSafeStorage } from './auth-safe-storage';
//
// // Call this during app initialization:
// initializeAuthWithElectronSafeStorage();
//
// // For existing users, migrate their keys:
// // migrateDevicePrivateKeyToSafeStorage(userId, deviceId);
//
// Now auth.ts functions will automatically use your existing 
// safeStorage setup with macOS Keychain
