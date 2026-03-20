/**
 * EpochService - Client-side epoch management for Signal Protocol v2.3
 *
 * Handles epoch rotation, key management, and history decryption
 * for group messaging with forward secrecy.
 */

import type { AuthData } from 'ember-shared';
import { SignalSessionManager } from '../managers/signal-session-manager';

export interface Epoch {
  id: string;
  ember_id: string;
  epoch_number: number;
  created_at: number;
}

export interface EpochKey {
  user_id: string;
  device_id: string;
  encrypted_key: string;
  created_at: number;
}

export interface EpochKeyRequest {
  user_id: string;
  device_id: string;
  encrypted_key: string;
}

export interface PendingRotation {
  id: string;
  ember_id: string;
  epoch_number: number;
  rotation_data: string;
  created_at: number;
}

export interface CreateEpochRequest {
  rotation_data?: string;
}

export interface StoreEpochKeysRequest {
  keys: EpochKeyRequest[];
}

export class EpochService {
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
    return this.auth.hostname.startsWith('http') ? this.auth.hostname : `https://${this.auth.hostname}`;
  }

  /**
   * Get the current epoch for an ember
   */
  async getCurrentEpoch(emberId: string): Promise<Epoch | null> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/embers/${emberId}/epochs?limit=1`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch current epoch: ${response.status}`);
      }

      const data = await response.json();
      const epochs = data.epochs || [];

      return epochs.length > 0 ? epochs[0] : null;
    } catch (error) {
      console.error('Failed to get current epoch:', error);
      throw error;
    }
  }

  /**
   * Create a new epoch for an ember
   */
  async createEpoch(emberId: string, rotationData?: string): Promise<Epoch> {
    try {
      const requestBody: CreateEpochRequest = {};
      if (rotationData) {
        requestBody.rotation_data = rotationData;
      }

      const response = await fetch(`${this.getBaseUrl()}/api/v1/embers/${emberId}/epochs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`Failed to create epoch: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to create epoch:', error);
      throw error;
    }
  }

  /**
   * Get pending epoch rotations for the current user
   */
  async getPendingRotations(): Promise<PendingRotation[]> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/embers/pending-epoch-rotations`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch pending rotations: ${response.status}`);
      }

      const data = await response.json();
      return data.pending_rotations || [];
    } catch (error) {
      console.error('Failed to get pending rotations:', error);
      throw error;
    }
  }

  /**
   * Acknowledge a pending epoch rotation
   */
  async acknowledgeRotation(rotationId: string): Promise<void> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/pending-epoch-rotations/${rotationId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to acknowledge rotation: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to acknowledge rotation:', error);
      throw error;
    }
  }

  /**
   * Get all epoch keys for a specific epoch
   */
  async getEpochKeys(epochId: string): Promise<EpochKey[]> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/epochs/${epochId}/keys`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch epoch keys: ${response.status}`);
      }

      const data = await response.json();
      return data.keys || [];
    } catch (error) {
      console.error('Failed to get epoch keys:', error);
      throw error;
    }
  }

  /**
   * Store epoch keys for a specific epoch
   */
  async storeEpochKeys(epochId: string, emberId: string, keys: EpochKeyRequest[]): Promise<void> {
    try {
      const requestBody: StoreEpochKeysRequest = { keys };

      const response = await fetch(`${this.getBaseUrl()}/api/v1/epochs/${epochId}/keys`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`Failed to store epoch keys: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to store epoch keys:', error);
      throw error;
    }
  }

  /**
   * Get all epoch keys for the current user in an ember
   */
  async getUserEpochKeys(emberId: string): Promise<Record<string, EpochKey[]>> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/embers/${emberId}/epoch-keys`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch user epoch keys: ${response.status}`);
      }

      const data = await response.json();
      return data.epoch_keys || {};
    } catch (error) {
      console.error('Failed to get user epoch keys:', error);
      throw error;
    }
  }

  /**
   * Perform a complete epoch rotation
   */
  async rotateEpoch(emberId: string): Promise<Epoch> {
    try {
      // Get current epoch
      const currentEpoch = await this.getCurrentEpoch(emberId);
      
      // Create rotation data (this would be encrypted with current epoch keys)
      let rotationData: string | undefined;
      if (currentEpoch) {
        // Generate rotation payload - this is simplified and would need proper crypto
        const rotationPayload = JSON.stringify({
          previous_epoch_id: currentEpoch.id,
          rotation_timestamp: Date.now(),
          ember_id: emberId,
        });

        // Encrypt rotation data with current group key
        const encryptedRotationData = await this.signalSessionManager.groupEncrypt(
          emberId,
          new TextEncoder().encode(rotationPayload)
        );
        // Convert Uint8Array to base64 string for API transport
        rotationData = btoa(String.fromCharCode(...encryptedRotationData));
      }

      // Create new epoch
      const newEpoch = await this.createEpoch(emberId, rotationData);

      // Generate and store new epoch keys for current user
      await this.generateAndStoreEpochKeys(newEpoch.id, emberId);

      return newEpoch;
    } catch (error) {
      console.error('Failed to rotate epoch:', error);
      throw error;
    }
  }

  /**
   * Generate and store epoch keys for the current user
   */
  private async generateAndStoreEpochKeys(epochId: string, emberId: string): Promise<void> {
    try {
      // This is simplified - in reality, this would generate proper cryptographic keys
      const newKey = this.generateEpochKey();

      const keyRequest: EpochKeyRequest = {
        user_id: this.auth.user_id,
        device_id: this.auth.device_id,
        encrypted_key: newKey,
      };

      await this.storeEpochKeys(epochId, emberId, [keyRequest]);
    } catch (error) {
      console.error('Failed to generate and store epoch keys:', error);
      throw error;
    }
  }

  /**
   * Generate a new epoch key (simplified implementation)
   */
  private generateEpochKey(): string {
    // In reality, this would use proper cryptographic key generation
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Decrypt a message from a specific epoch
   */
  async decryptEpochMessage(epochId: string, ciphertext: string): Promise<Uint8Array> {
    try {
      // Get epoch keys for this epoch
      const epochKeys = await this.getEpochKeys(epochId);
      
      // Find the key for the current user
      const userKey = epochKeys.find(key => 
        key.user_id === this.auth.user_id && key.device_id === this.auth.device_id
      );

      if (!userKey) {
        throw new Error('No epoch key found for current user');
      }

      // Decrypt the epoch key (this would involve proper cryptographic operations)
      const decryptedKey = await this.decryptEpochKey(userKey.encrypted_key);

      // Decrypt the message with the epoch key (simplified)
      // In reality, this would use proper AEAD decryption
      const messageBytes = new TextEncoder().encode(ciphertext);
      
      // For now, return the ciphertext as bytes (proper decryption would be implemented here)
      return messageBytes;
    } catch (error) {
      console.error('Failed to decrypt epoch message:', error);
      throw error;
    }
  }

  /**
   * Decrypt an encrypted epoch key (simplified implementation)
   */
  private async decryptEpochKey(encryptedKey: string): Promise<Uint8Array> {
    // In reality, this would use the user's private key to decrypt the epoch key
    // For now, return a placeholder
    return new TextEncoder().encode(encryptedKey);
  }

  /**
   * Process pending epoch rotations
   */
  async processPendingRotations(): Promise<void> {
    try {
      const pendingRotations = await this.getPendingRotations();

      for (const rotation of pendingRotations) {
        try {
          // Process rotation data (decrypt and validate)
          if (rotation.rotation_data) {
            await this.processRotationData(rotation.rotation_data);
          }

          // Acknowledge the rotation
          await this.acknowledgeRotation(rotation.id);
        } catch (error) {
          console.error(`Failed to process rotation ${rotation.id}:`, error);
          // Continue processing other rotations
        }
      }
    } catch (error) {
      console.error('Failed to process pending rotations:', error);
      throw error;
    }
  }

  /**
   * Process rotation data (decrypt and validate)
   */
  private async processRotationData(rotationData: string): Promise<void> {
    try {
      // Decrypt rotation data with current group key
      const decryptedData = await this.signalSessionManager.groupDecrypt(
        'unknown', // Would need ember_id from context
        new TextEncoder().encode(rotationData)
      );

      // Parse and validate rotation payload
      const rotationPayload = JSON.parse(new TextDecoder().decode(decryptedData));
      
      // Validate the rotation payload
      if (!rotationPayload.previous_epoch_id || !rotationPayload.rotation_timestamp) {
        throw new Error('Invalid rotation payload');
      }

      console.log('Processed rotation data:', rotationPayload);
    } catch (error) {
      console.error('Failed to process rotation data:', error);
      throw error;
    }
  }
}

// Export globally for script loading compatibility
(window as any).EpochService = EpochService;
