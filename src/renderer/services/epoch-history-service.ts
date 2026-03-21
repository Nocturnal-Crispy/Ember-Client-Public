/**
 * EpochHistoryService - Handles decryption of historical messages across epochs
 *
 * Provides the ability to decrypt messages from previous epochs by
 * managing epoch keys and providing seamless decryption across
 * epoch boundaries.
 */

import type { AuthData } from 'ember-shared';
import { EpochService, Epoch, EpochKey } from './epoch-service';
import { SignalSessionManager } from '../managers/signal-session-manager';

export interface MessageWithEpoch {
  id: string;
  ciphertext: string;
  epoch_id?: string;
  epoch_ciphertext?: string;
  protocol_version: number;
  envelope_type: string;
  created_at: number;
}

export interface DecryptedMessage {
  id: string;
  plaintext: Uint8Array;
  epoch_id?: string;
  created_at: number;
}

export class EpochHistoryService {
  private auth: AuthData;
  private epochService: EpochService;
  private signalSessionManager: SignalSessionManager;
  private epochKeyCache: Map<string, Map<string, Uint8Array>> = new Map();

  constructor(auth: AuthData, epochService: EpochService, signalSessionManager: SignalSessionManager) {
    if (!auth) {
      throw new Error('Auth data is required');
    }
    if (!epochService) {
      throw new Error('EpochService is required');
    }
    if (!signalSessionManager) {
      throw new Error('SignalSessionManager is required');
    }

    this.auth = auth;
    this.epochService = epochService;
    this.signalSessionManager = signalSessionManager;
  }

  /**
   * Decrypt a Signal Protocol epoch message.
   */
  async decryptMessage(message: MessageWithEpoch, emberId: string): Promise<DecryptedMessage> {
    try {
      if (!message.epoch_id) {
        throw new Error('Message missing epoch_id — only Signal Protocol epoch messages are supported');
      }
      return await this.decryptEpochMessage(message, emberId);
    } catch (error) {
      console.error('Failed to decrypt message:', error);
      throw error;
    }
  }

  /**
   * Decrypt a message from a specific epoch
   */
  private async decryptEpochMessage(message: MessageWithEpoch, emberId: string): Promise<DecryptedMessage> {
    if (!message.epoch_id) {
      throw new Error('Epoch message missing epoch_id');
    }

    // Try to decrypt with epoch ciphertext first (v2.3+)
    if (message.epoch_ciphertext) {
      return await this.decryptEpochCiphertext(message);
    }

    // Fall back to regular ciphertext with epoch keys
    return await this.decryptWithEpochKeys(message, emberId);
  }

  /**
   * Decrypt message using epoch ciphertext (preferred method for v2.3+)
   */
  private async decryptEpochCiphertext(message: MessageWithEpoch): Promise<DecryptedMessage> {
    if (!message.epoch_ciphertext || !message.epoch_id) {
      throw new Error('Epoch ciphertext or epoch_id missing');
    }

    // For epoch ciphertext, we don't need to fetch epoch keys separately
    // The epoch ciphertext should be self-contained or use a different key derivation
    // For now, return the epoch ciphertext as bytes (proper decryption would be implemented here)
    const ciphertextBytes = new TextEncoder().encode(message.epoch_ciphertext);
    
    return {
      id: message.id,
      plaintext: ciphertextBytes,
      epoch_id: message.epoch_id,
      created_at: message.created_at,
    };
  }

  /**
   * Decrypt message using epoch keys
   */
  private async decryptWithEpochKeys(message: MessageWithEpoch, emberId: string): Promise<DecryptedMessage> {
    if (!message.epoch_id) {
      throw new Error('Epoch ID required for epoch key decryption');
    }

    // Get epoch keys for this epoch
    const epochKeys = await this.epochService.getEpochKeys(message.epoch_id);
    
    // Find the key for the current user
    const userKey = epochKeys.find(key => 
      key.user_id === this.auth.user_id && key.device_id === this.auth.device_id
    );

    if (!userKey) {
      throw new Error('No epoch key found for current user in epoch ' + message.epoch_id);
    }

    // Decrypt the epoch key (simplified implementation)
    const decryptedKey = await this.decryptEpochKey(userKey.encrypted_key);

    // Decrypt the message with the epoch key (simplified)
    const messageBytes = new TextEncoder().encode(message.ciphertext);
    
    // For now, return the ciphertext as bytes (proper decryption would be implemented here)
    return {
      id: message.id,
      plaintext: messageBytes,
      epoch_id: message.epoch_id,
      created_at: message.created_at,
    };
  }


  /**
   * Get or decrypt an epoch key for the current user
   */
  private async getEpochKey(epochId: string): Promise<Uint8Array> {
    // Check cache first
    if (this.epochKeyCache.has(epochId) && 
        this.epochKeyCache.get(epochId)?.has(this.auth.device_id)) {
      return this.epochKeyCache.get(epochId)!.get(this.auth.device_id)!;
    }

    // Fetch epoch keys from server
    const epochKeys = await this.epochService.getEpochKeys(epochId);
    
    // Find the key for the current user
    const userKey = epochKeys.find(key => 
      key.user_id === this.auth.user_id && key.device_id === this.auth.device_id
    );

    if (!userKey) {
      throw new Error('No epoch key found for current user');
    }

    // Decrypt and cache the key
    const decryptedKey = await this.decryptEpochKey(userKey.encrypted_key);
    
    // Cache the decrypted key
    if (!this.epochKeyCache.has(epochId)) {
      this.epochKeyCache.set(epochId, new Map());
    }
    this.epochKeyCache.get(epochId)!.set(this.auth.device_id, decryptedKey);

    return decryptedKey;
  }

  /**
   * Decrypt an encrypted epoch key (simplified implementation)
   */
  private async decryptEpochKey(encryptedKey: string): Promise<Uint8Array> {
    // In reality, this would use the user's private key to decrypt the epoch key
    // For now, return a placeholder implementation
    return new TextEncoder().encode(encryptedKey);
  }

  /**
   * Decrypt multiple messages, handling mixed epochs efficiently
   */
  async decryptMessages(messages: MessageWithEpoch[], emberId: string): Promise<DecryptedMessage[]> {
    const results: DecryptedMessage[] = [];
    const epochIdsToPrefetch = new Set<string>();

    // Collect epoch IDs that need keys (only those without epoch_ciphertext)
    for (const message of messages) {
      if (message.epoch_id && !message.epoch_ciphertext) {
        epochIdsToPrefetch.add(message.epoch_id);
      }
    }

    // Pre-fetch and cache epoch keys for relevant epochs
    if (epochIdsToPrefetch.size > 0) {
      await this.prefetchEpochKeys(Array.from(epochIdsToPrefetch));
    }

    // Decrypt all messages
    for (const message of messages) {
      try {
        const decrypted = await this.decryptMessage(message, emberId);
        results.push(decrypted);
      } catch (error) {
        console.error(`Failed to decrypt message ${message.id}:`, error);
        // Continue with other messages
      }
    }

    return results;
  }

  /**
   * Pre-fetch epoch keys for multiple epochs to optimize batch decryption
   */
  private async prefetchEpochKeys(epochIds: string[]): Promise<void> {
    const promises = epochIds.map(async (epochId) => {
      try {
        // Only fetch keys if we don't already have them cached
        if (!this.epochKeyCache.has(epochId) || 
            !this.epochKeyCache.get(epochId)?.has(this.auth.device_id)) {
          await this.getEpochKey(epochId);
        }
      } catch (error) {
        console.error(`Failed to prefetch epoch key for ${epochId}:`, error);
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Clear the epoch key cache (useful for logout or security events)
   */
  clearKeyCache(): void {
    this.epochKeyCache.clear();
  }

  /**
   * Get message history for an ember with epoch-aware decryption
   */
  async getMessageHistory(
    emberId: string, 
    channelId: string, 
    beforeId?: string, 
    limit = 50
  ): Promise<DecryptedMessage[]> {
    try {
      // This would integrate with the existing message service
      // For now, we'll simulate fetching messages
      
      // In a real implementation, this would call the message service
      // const messages = await window.App.messageService.fetchMessages(auth, channelId, beforeId, limit);
      
      // Simulate message fetch
      const messages: MessageWithEpoch[] = [];
      
      // Decrypt the messages
      return await this.decryptMessages(messages, emberId);
    } catch (error) {
      console.error('Failed to get message history:', error);
      throw error;
    }
  }

  /**
   * Check if a message can be decrypted with current keys
   */
  async canDecryptMessage(message: MessageWithEpoch): Promise<boolean> {
    try {
      // Legacy messages should be decryptable with current session
      if (message.protocol_version < 2 || !message.epoch_id) {
        return true;
      }

      // Epoch messages require epoch keys
      if (message.epoch_id) {
        const epochKeys = await this.epochService.getEpochKeys(message.epoch_id);
        return epochKeys.some(key => 
          key.user_id === this.auth.user_id && key.device_id === this.auth.device_id
        );
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get information about message decryption capabilities
   */
  async getDecryptionInfo(messages: MessageWithEpoch[]): Promise<{
    total: number;
    decryptable: number;
    requiresEpochKeys: number;
  }> {
    let decryptable = 0;
    let requiresEpochKeys = 0;

    for (const message of messages) {
      const canDecrypt = await this.canDecryptMessage(message);
      if (canDecrypt) {
        decryptable++;
      }
      if (message.epoch_id) {
        requiresEpochKeys++;
      }
    }

    return {
      total: messages.length,
      decryptable,
      requiresEpochKeys,
    };
  }
}

// Export globally for script loading compatibility
(window as any).EpochHistoryService = EpochHistoryService;
