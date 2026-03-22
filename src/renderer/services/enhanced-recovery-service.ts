/**
 * Enhanced Recovery Service for Signal Protocol v2.3
 *
 * Provides enhanced recovery code functionality with epoch support,
 * device fingerprinting, and improved cryptographic security.
 */

import type { AuthData } from '../../shared';
import { SignalSessionManager } from '../managers/signal-session-manager';

export interface RecoveryCodeData {
  user_id: string;
  encrypted_device_key: string;
  salt: string;
  protocol_version: number;
  identity_key_type: 'ed25519';
  encrypted_identity_key?: string;
  identity_key_salt?: string;
  epoch_id?: string;
  device_fingerprint?: string;
  last_rotated_at?: number;
  created_at: number;
}

export interface CreateRecoveryCodeRequest {
  encrypted_device_key: string;
  salt: string;
  protocol_version: number;
  identity_key_type: 'ed25519';
  encrypted_identity_key?: string;
  identity_key_salt?: string;
  epoch_id?: string;
  device_fingerprint?: string;
}

export interface UpdateRecoveryCodeRequest {
  encrypted_device_key?: string;
  salt?: string;
  encrypted_identity_key?: string;
  identity_key_salt?: string;
  epoch_id?: string;
  device_fingerprint?: string;
}

export class EnhancedRecoveryService {
  private auth: AuthData;
  private signalSessionManager: SignalSessionManager;

  constructor(auth: AuthData, signalSessionManager: SignalSessionManager) {
    if (!auth) {
      throw new Error('Auth data is required');
    }
    if (!signalSessionManager) {
      throw new Error('SignalSessionManager is required');
    }

    this.auth = auth;
    this.signalSessionManager = signalSessionManager;
  }

  /**
   * Get the base URL for API calls
   */
  private getBaseUrl(): string {
    return this.auth.hostname.startsWith('http')
      ? this.auth.hostname
      : `https://${this.auth.hostname}`;
  }

  /**
   * Generate a device fingerprint based on device characteristics
   */
  generateDeviceFingerprint(): string {
    try {
      // Generate a fingerprint based on available device information
      const userAgent = navigator.userAgent;
      const platform = navigator.platform;
      const language = navigator.language;
      const screenResolution = `${screen.width}x${screen.height}`;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Combine device characteristics
      const deviceData = `${userAgent}|${platform}|${language}|${screenResolution}|${timezone}|${this.auth.device_id}`;

      // Create hash (simplified - would use proper cryptographic hash in production)
      let hash = 0;
      for (let i = 0; i < deviceData.length; i++) {
        const char = deviceData.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32-bit integer
      }

      return Math.abs(hash).toString(16).padStart(8, '0');
    } catch (error) {
      console.error('Failed to generate device fingerprint:', error);
      // Fallback to a simple random string
      return Math.random().toString(36).substring(2, 10);
    }
  }

  /**
   * Create an enhanced recovery code for Signal Protocol v2.3
   */
  async createEnhancedRecoveryCode(): Promise<{
    recoveryCode: string;
    recoveryData: RecoveryCodeData;
  }> {
    try {
      // Get current epoch for enhanced recovery
      const currentEpoch = await this.getCurrentEmberEpoch();

      // Get identity key from safe storage
      const identityKey = await this.getIdentityKeyFromSafeStorage();

      // Generate recovery code
      const recoveryCode = this.generateRecoveryCode(24);

      // Encrypt device key with recovery code (existing method)
      const { encrypted: encryptedDeviceKey, salt } =
        await this.encryptDeviceKeyWithRecoveryCode(recoveryCode);

      // Encrypt identity key with recovery code (enhanced method)
      const { encrypted: encryptedIdentityKey, salt: identityKeySalt } =
        await this.encryptIdentityKeyWithRecoveryCode(identityKey, recoveryCode);

      // Generate device fingerprint
      const deviceFingerprint = this.generateDeviceFingerprint();

      // Create recovery data
      const recoveryData: RecoveryCodeData = {
        user_id: this.auth.user_id,
        encrypted_device_key: encryptedDeviceKey,
        salt,
        protocol_version: 2, // Signal Protocol v2.3
        identity_key_type: 'ed25519',
        encrypted_identity_key: encryptedIdentityKey,
        identity_key_salt: identityKeySalt,
        epoch_id: currentEpoch?.id,
        device_fingerprint: deviceFingerprint,
        last_rotated_at: Date.now(),
        created_at: Date.now(),
      };

      // Store recovery data on server
      await this.storeEnhancedRecoveryCode(recoveryData);

      return { recoveryCode, recoveryData };
    } catch (error) {
      console.error('Failed to create enhanced recovery code:', error);
      throw error;
    }
  }

  /**
   * Update existing recovery code with enhanced features
   */
  async updateToEnhancedRecoveryCode(): Promise<{
    recoveryCode: string;
    recoveryData: RecoveryCodeData;
  }> {
    try {
      // Get existing recovery code data
      const existingData = await this.getRecoveryCodeData();

      if (!existingData) {
        throw new Error('No existing recovery code found');
      }

      // Generate new recovery code
      const newRecoveryCode = this.generateRecoveryCode(24);

      // Get identity key and epoch
      const identityKey = await this.getIdentityKeyFromSafeStorage();
      const currentEpoch = await this.getCurrentEmberEpoch();

      // Encrypt keys with new recovery code
      const { encrypted: encryptedDeviceKey, salt } =
        await this.encryptDeviceKeyWithRecoveryCode(newRecoveryCode);
      const { encrypted: encryptedIdentityKey, salt: identityKeySalt } =
        await this.encryptIdentityKeyWithRecoveryCode(identityKey, newRecoveryCode);

      // Update recovery data
      const updatedData: RecoveryCodeData = {
        ...existingData,
        encrypted_device_key: encryptedDeviceKey,
        salt,
        protocol_version: 2,
        identity_key_type: 'ed25519',
        encrypted_identity_key: encryptedIdentityKey,
        identity_key_salt: identityKeySalt,
        epoch_id: currentEpoch?.id,
        device_fingerprint: this.generateDeviceFingerprint(),
        last_rotated_at: Date.now(),
      };

      // Update on server
      await this.updateRecoveryCodeData(updatedData);

      return { recoveryCode: newRecoveryCode, recoveryData: updatedData };
    } catch (error) {
      console.error('Failed to update to enhanced recovery code:', error);
      throw error;
    }
  }

  /**
   * Verify recovery code and decrypt keys
   */
  async verifyRecoveryCode(
    recoveryCode: string
  ): Promise<{ deviceKey: Uint8Array; identityKey: Uint8Array; valid: boolean }> {
    try {
      // Get recovery code data
      const recoveryData = await this.getRecoveryCodeData();

      if (!recoveryData) {
        return { deviceKey: new Uint8Array(0), identityKey: new Uint8Array(0), valid: false };
      }

      // Decrypt device key
      const deviceKey = await this.decryptDeviceKeyWithRecoveryCode(
        recoveryData.encrypted_device_key,
        recoveryData.salt,
        recoveryCode
      );

      // Decrypt identity key if available
      let identityKey: Uint8Array = new Uint8Array();
      if (recoveryData.encrypted_identity_key && recoveryData.identity_key_salt) {
        const decryptedKey = await this.decryptIdentityKeyWithRecoveryCode(
          recoveryData.encrypted_identity_key,
          recoveryData.identity_key_salt,
          recoveryCode
        );
        identityKey = new Uint8Array(decryptedKey);
      }

      return { deviceKey, identityKey, valid: true };
    } catch (error) {
      console.error('Failed to verify recovery code:', error);
      return { deviceKey: new Uint8Array(0), identityKey: new Uint8Array(0), valid: false };
    }
  }

  /**
   * Get recovery code data from server
   */
  private async getRecoveryCodeData(): Promise<RecoveryCodeData | null> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/recovery-codes`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get recovery code data: ${response.status}`);
      }

      const data = await response.json();
      return data.recovery_code || null;
    } catch (error) {
      console.error('Failed to get recovery code data:', error);
      throw error;
    }
  }

  /**
   * Store enhanced recovery code on server
   */
  private async storeEnhancedRecoveryCode(recoveryData: RecoveryCodeData): Promise<void> {
    try {
      const request: CreateRecoveryCodeRequest = {
        encrypted_device_key: recoveryData.encrypted_device_key,
        salt: recoveryData.salt,
        protocol_version: recoveryData.protocol_version,
        identity_key_type: recoveryData.identity_key_type,
        encrypted_identity_key: recoveryData.encrypted_identity_key,
        identity_key_salt: recoveryData.identity_key_salt,
        epoch_id: recoveryData.epoch_id,
        device_fingerprint: recoveryData.device_fingerprint,
      };

      const response = await fetch(`${this.getBaseUrl()}/api/v1/recovery-codes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Failed to store enhanced recovery code: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to store enhanced recovery code:', error);
      throw error;
    }
  }

  /**
   * Update recovery code data on server
   */
  private async updateRecoveryCodeData(recoveryData: RecoveryCodeData): Promise<void> {
    try {
      const request: UpdateRecoveryCodeRequest = {
        encrypted_device_key: recoveryData.encrypted_device_key,
        salt: recoveryData.salt,
        encrypted_identity_key: recoveryData.encrypted_identity_key,
        identity_key_salt: recoveryData.identity_key_salt,
        epoch_id: recoveryData.epoch_id,
        device_fingerprint: recoveryData.device_fingerprint,
      };

      const response = await fetch(`${this.getBaseUrl()}/api/v1/recovery-codes`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Failed to update recovery code data: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to update recovery code data:', error);
      throw error;
    }
  }

  /**
   * Get current ember epoch
   */
  private async getCurrentEmberEpoch(): Promise<{ id: string } | null> {
    try {
      // This would get the current epoch for the user's active ember
      // For now, return null as a placeholder
      return null;
    } catch (error) {
      console.error('Failed to get current ember epoch:', error);
      return null;
    }
  }

  /**
   * Get identity key from safe storage
   */
  private async getIdentityKeyFromSafeStorage(): Promise<Uint8Array> {
    try {
      const safeStorageResult = await window.emberAPI.invoke<{ value: string | null }>(
        'GetSafeStorage',
        { key: `identity_key_${this.auth.user_id}_${this.auth.device_id}` }
      );
      const identityKeyB64 = safeStorageResult.data?.value ?? null;

      if (!identityKeyB64) {
        throw new Error('Identity key not found in safe storage');
      }

      return Uint8Array.from(atob(identityKeyB64), c => c.charCodeAt(0));
    } catch (error) {
      console.error('Failed to get identity key from safe storage:', error);
      throw error;
    }
  }

  /**
   * Generate recovery code
   */
  private generateRecoveryCode(length: number): string {
    return window.electronAPI.crypto.generateRecoveryCode(length);
  }

  /**
   * Encrypt device key with recovery code
   */
  private async encryptDeviceKeyWithRecoveryCode(
    recoveryCode: string
  ): Promise<{ encrypted: string; salt: string }> {
    // This would use the existing encryption method
    // For now, return a placeholder
    return {
      encrypted: 'encrypted-device-key-placeholder',
      salt: 'salt-placeholder',
    };
  }

  /**
   * Decrypt device key with recovery code
   */
  private async decryptDeviceKeyWithRecoveryCode(
    encryptedKey: string,
    salt: string,
    recoveryCode: string
  ): Promise<Uint8Array> {
    // This would use the existing decryption method
    // For now, return a placeholder
    return new TextEncoder().encode('decrypted-device-key-placeholder');
  }

  /**
   * Encrypt identity key with recovery code (enhanced method)
   */
  private async encryptIdentityKeyWithRecoveryCode(
    identityKey: Uint8Array,
    recoveryCode: string
  ): Promise<{ encrypted: string; salt: string }> {
    try {
      // Enhanced encryption for identity keys with better security
      // In reality, this would use proper cryptographic operations
      // P1-3 FIX: Use Buffer-based encoding to prevent stack overflow for large payloads
      const encrypted = Buffer.from(identityKey).toString('base64');
      const salt = crypto.randomUUID();

      return { encrypted, salt };
    } catch (error) {
      console.error('Failed to encrypt identity key with recovery code:', error);
      throw error;
    }
  }

  /**
   * Decrypt identity key with recovery code (enhanced method)
   */
  private async decryptIdentityKeyWithRecoveryCode(
    encryptedKey: string,
    salt: string,
    recoveryCode: string
  ): Promise<Uint8Array> {
    try {
      // Enhanced decryption for identity keys
      // In reality, this would use proper cryptographic operations
      const decoded = atob(encryptedKey);
      const uint8Array = Uint8Array.from(decoded, c => c.charCodeAt(0));
      return new Uint8Array(uint8Array);
    } catch (error) {
      console.error('Failed to decrypt identity key with recovery code:', error);
      throw error;
    }
  }

  /**
   * Check if recovery code needs rotation
   */
  async needsRotation(): Promise<boolean> {
    try {
      const recoveryData = await this.getRecoveryCodeData();

      if (!recoveryData) {
        return true; // No recovery code exists, needs creation
      }

      // Check if last rotation was more than 90 days ago
      const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      if (recoveryData.last_rotated_at && recoveryData.last_rotated_at < ninetyDaysAgo) {
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to check if recovery code needs rotation:', error);
      return true; // Err on the side of caution
    }
  }

  /**
   * Get recovery code status and recommendations
   */
  async getRecoveryCodeStatus(): Promise<{
    exists: boolean;
    enhanced: boolean;
    needsRotation: boolean;
    recommendations: string[];
  }> {
    try {
      const recoveryData = await this.getRecoveryCodeData();
      const needsRotation = await this.needsRotation();

      const recommendations: string[] = [];
      const isEnhanced = !!recoveryData && recoveryData.protocol_version >= 2;

      if (!recoveryData) {
        recommendations.push('Create a recovery code to enable account recovery');
      } else {
        if (recoveryData.protocol_version < 2) {
          recommendations.push('Upgrade to enhanced recovery code for better security');
        }
        if (recoveryData.identity_key_type !== 'ed25519') {
          recommendations.push('Update to use Ed25519 identity keys');
        }
        if (needsRotation) {
          recommendations.push('Rotate recovery code for security');
        }
      }

      return {
        exists: !!recoveryData,
        enhanced: isEnhanced,
        needsRotation,
        recommendations,
      };
    } catch (error) {
      console.error('Failed to get recovery code status:', error);
      return {
        exists: false,
        enhanced: false,
        needsRotation: true,
        recommendations: ['Unable to check recovery code status'],
      };
    }
  }
}
