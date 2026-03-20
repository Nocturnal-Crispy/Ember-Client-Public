/**
 * AttachmentEncryptionService - Manages per-attachment encryption for Signal Protocol v2.3
 *
 * Handles the creation, distribution, and management of per-attachment encryption keys
 * for secure file sharing in the Signal Protocol migration.
 */

import type { AuthData } from 'ember-shared';
import { SignalSessionManager } from '../managers/signal-session-manager';

export interface AttachmentKey {
  id: string;
  attachment_id: string;
  user_id: string;
  device_id: string;
  encrypted_key: string;
  created_at: number;
}

export interface CreateAttachmentKeyRequest {
  attachment_id: string;
  keys: {
    user_id: string;
    device_id: string;
    encrypted_key: string;
  }[];
}

export interface UploadAttachmentRequest {
  channel_id?: string;
  conversation_id?: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  encrypted_data: string;
  attachment_key: string;
}

export interface AttachmentMetadata {
  id: string;
  channel_id?: string;
  conversation_id?: string;
  uploader_id: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  created_at: number;
  attachment_key_id: string;
}

export class AttachmentEncryptionService {
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
   * Generate a per-attachment encryption key
   */
  generateAttachmentKey(): string {
    // Generate a cryptographically secure random key (32 bytes = 256 bits)
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Encrypt attachment data with a per-attachment key
   */
  async encryptAttachmentData(data: Uint8Array, key: string): Promise<string> {
    try {
      // Convert key to bytes
      const keyBytes = new Uint8Array(
        key.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
      );

      // For now, use a simple XOR encryption (in reality, would use AES-GCM)
      const encryptedData = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        encryptedData[i] = data[i] ^ keyBytes[i % keyBytes.length];
      }

      // Return base64 encoded encrypted data
      return btoa(String.fromCharCode(...encryptedData));
    } catch (error) {
      console.error('Failed to encrypt attachment data:', error);
      throw error;
    }
  }

  /**
   * Decrypt attachment data with a per-attachment key
   */
  async decryptAttachmentData(encryptedData: string, key: string): Promise<Uint8Array> {
    try {
      // Convert key to bytes
      const keyBytes = new Uint8Array(
        key.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
      );

      // Decode base64 encrypted data
      const encryptedBytes = new Uint8Array(
        atob(encryptedData).split('').map(char => char.charCodeAt(0))
      );

      // For now, use a simple XOR decryption (in reality, would use AES-GCM)
      const decryptedData = new Uint8Array(encryptedBytes.length);
      for (let i = 0; i < encryptedBytes.length; i++) {
        decryptedData[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length];
      }

      return decryptedData;
    } catch (error) {
      console.error('Failed to decrypt attachment data:', error);
      throw error;
    }
  }

  /**
   * Create attachment keys for all members of a channel
   */
  async createChannelAttachmentKeys(attachmentId: string, channelId: string, key: string): Promise<void> {
    try {
      // Get channel members
      const members = await this.getChannelMembers(channelId);
      
      // Create encrypted keys for each member's devices
      const keyRequests = [];
      for (const member of members) {
        // For now, assume one device per user (in reality, would handle multiple devices)
        const encryptedKey = await this.encryptAttachmentKeyForUser(key, member.user_id);
        keyRequests.push({
          user_id: member.user_id,
          device_id: member.device_id || 'default',
          encrypted_key: encryptedKey,
        });
      }

      // Store the attachment keys
      const request: CreateAttachmentKeyRequest = {
        attachment_id: attachmentId,
        keys: keyRequests,
      };

      const response = await fetch(`${this.getBaseUrl()}/api/v1/attachments/${attachmentId}/keys`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Failed to create attachment keys: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to create channel attachment keys:', error);
      throw error;
    }
  }

  /**
   * Create attachment keys for conversation participants
   */
  async createConversationAttachmentKeys(attachmentId: string, conversationId: string, key: string): Promise<void> {
    try {
      // Get conversation participants
      const participants = await this.getConversationParticipants(conversationId);
      
      // Create encrypted keys for each participant's devices
      const keyRequests = [];
      for (const participant of participants) {
        const encryptedKey = await this.encryptAttachmentKeyForUser(key, participant.user_id);
        keyRequests.push({
          user_id: participant.user_id,
          device_id: participant.device_id || 'default',
          encrypted_key: encryptedKey,
        });
      }

      // Store the attachment keys
      const request: CreateAttachmentKeyRequest = {
        attachment_id: attachmentId,
        keys: keyRequests,
      };

      const response = await fetch(`${this.getBaseUrl()}/api/v1/attachments/${attachmentId}/keys`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Failed to create conversation attachment keys: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to create conversation attachment keys:', error);
      throw error;
    }
  }

  /**
   * Get attachment keys for the current user
   */
  async getAttachmentKeys(attachmentId: string): Promise<AttachmentKey[]> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v1/attachments/${attachmentId}/keys`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get attachment keys: ${response.status}`);
      }

      const data = await response.json();
      return data.keys || [];
    } catch (error) {
      console.error('Failed to get attachment keys:', error);
      throw error;
    }
  }

  /**
   * Upload an attachment with per-attachment encryption
   */
  async uploadChannelAttachment(
    channelId: string,
    fileName: string,
    contentType: string,
    data: Uint8Array
  ): Promise<AttachmentMetadata> {
    try {
      // Generate per-attachment key
      const attachmentKey = this.generateAttachmentKey();
      
      // Encrypt the attachment data
      const encryptedData = await this.encryptAttachmentData(data, attachmentKey);
      
      // Upload the attachment
      const uploadRequest: UploadAttachmentRequest = {
        channel_id: channelId,
        original_name: fileName,
        content_type: contentType,
        size_bytes: data.length,
        encrypted_data: encryptedData,
        attachment_key: attachmentKey,
      };

      const response = await fetch(`${this.getBaseUrl()}/api/v1/channels/${channelId}/attachments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(uploadRequest),
      });

      if (!response.ok) {
        throw new Error(`Failed to upload attachment: ${response.status}`);
      }

      const metadata = await response.json() as AttachmentMetadata;
      
      // Create keys for all channel members
      await this.createChannelAttachmentKeys(metadata.id, channelId, attachmentKey);
      
      return metadata;
    } catch (error) {
      console.error('Failed to upload channel attachment:', error);
      throw error;
    }
  }

  /**
   * Upload a DM attachment with per-attachment encryption
   */
  async uploadConversationAttachment(
    conversationId: string,
    fileName: string,
    contentType: string,
    data: Uint8Array
  ): Promise<AttachmentMetadata> {
    try {
      // Generate per-attachment key
      const attachmentKey = this.generateAttachmentKey();
      
      // Encrypt the attachment data
      const encryptedData = await this.encryptAttachmentData(data, attachmentKey);
      
      // Upload the attachment
      const uploadRequest: UploadAttachmentRequest = {
        conversation_id: conversationId,
        original_name: fileName,
        content_type: contentType,
        size_bytes: data.length,
        encrypted_data: encryptedData,
        attachment_key: attachmentKey,
      };

      const response = await fetch(`${this.getBaseUrl()}/api/v1/conversations/${conversationId}/attachments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(uploadRequest),
      });

      if (!response.ok) {
        throw new Error(`Failed to upload conversation attachment: ${response.status}`);
      }

      const metadata = await response.json() as AttachmentMetadata;
      
      // Create keys for conversation participants
      await this.createConversationAttachmentKeys(metadata.id, conversationId, attachmentKey);
      
      return metadata;
    } catch (error) {
      console.error('Failed to upload conversation attachment:', error);
      throw error;
    }
  }

  /**
   * Download and decrypt an attachment
   */
  async downloadAttachment(attachmentId: string): Promise<{ data: Uint8Array; metadata: AttachmentMetadata }> {
    try {
      // Get attachment metadata
      const metadata = await this.getAttachmentMetadata(attachmentId);
      
      // Get attachment keys for current user
      const keys = await this.getAttachmentKeys(attachmentId);
      
      // Find the key for the current user/device
      const userKey = keys.find(key => 
        key.user_id === this.auth.user_id && key.device_id === this.auth.device_id
      );
      
      if (!userKey) {
        throw new Error('No attachment key found for current user');
      }
      
      // Decrypt the attachment key
      const attachmentKey = await this.decryptAttachmentKeyForUser(userKey.encrypted_key);
      
      // Download the encrypted attachment
      const encryptedData = await this.downloadEncryptedAttachment(attachmentId);
      
      // Decrypt the attachment data
      const decryptedData = await this.decryptAttachmentData(encryptedData, attachmentKey);
      
      return { data: decryptedData, metadata };
    } catch (error) {
      console.error('Failed to download attachment:', error);
      throw error;
    }
  }

  /**
   * Get attachment metadata
   */
  private async getAttachmentMetadata(attachmentId: string): Promise<AttachmentMetadata> {
    // This would fetch attachment metadata from the server
    // For now, return a placeholder
    return {
      id: attachmentId,
      original_name: 'unknown',
      content_type: 'application/octet-stream',
      size_bytes: 0,
      created_at: Date.now(),
      uploader_id: 'unknown',
      attachment_key_id: 'unknown',
    };
  }

  /**
   * Download encrypted attachment data
   */
  private async downloadEncryptedAttachment(attachmentId: string): Promise<string> {
    // This would download the encrypted attachment from the server
    // For now, return a placeholder
    return '';
  }

  /**
   * Get channel members
   */
  private async getChannelMembers(channelId: string): Promise<{ user_id: string; device_id?: string }[]> {
    // This would fetch channel members from the server
    // For now, return the current user as a member
    return [
      {
        user_id: this.auth.user_id,
        device_id: this.auth.device_id,
      },
    ];
  }

  /**
   * Get conversation participants
   */
  private async getConversationParticipants(conversationId: string): Promise<{ user_id: string; device_id?: string }[]> {
    // This would fetch conversation participants from the server
    // For now, return the current user as a participant
    return [
      {
        user_id: this.auth.user_id,
        device_id: this.auth.device_id,
      },
    ];
  }

  /**
   * Encrypt attachment key for a user
   */
  private async encryptAttachmentKeyForUser(key: string, userId: string): Promise<string> {
    try {
      // In reality, this would use the Signal Protocol to encrypt the key for the specific user
      // For now, return a base64-encoded placeholder
      const keyData = JSON.stringify({
        attachment_key: key,
        for_user_id: userId,
        created_by: this.auth.user_id,
        timestamp: Date.now(),
      });
      
      return btoa(keyData);
    } catch (error) {
      console.error('Failed to encrypt attachment key for user:', error);
      throw error;
    }
  }

  /**
   * Decrypt attachment key for current user
   */
  private async decryptAttachmentKeyForUser(encryptedKey: string): Promise<string> {
    try {
      // In reality, this would use the Signal Protocol to decrypt the key
      // For now, decode the base64 and parse JSON
      const keyData = atob(encryptedKey);
      const parsed = JSON.parse(keyData);
      return parsed.attachment_key;
    } catch (error) {
      console.error('Failed to decrypt attachment key for user:', error);
      throw error;
    }
  }
}
