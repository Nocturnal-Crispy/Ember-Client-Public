/**
 * AttachmentEncryptionService - Manages per-attachment encryption keys for Signal Protocol.
 *
 * Handles creation, distribution, and management of per-attachment AES-256-GCM keys
 * for secure file sharing.
 */

import type { AuthData } from '../../shared';
import { SignalSessionManager } from '../managers/signal-session-manager';

export interface AttachmentKey {
  id: string;
  attachmentId: string;
  userId: string;
  deviceId: string;
  encrypted_key: string;
  createdAt: number;
}

export interface CreateAttachmentKeyRequest {
  attachmentId: string;
  keys: {
    userId: string;
    deviceId: string;
    encrypted_key: string;
  }[];
}

export interface UploadAttachmentRequest {
  channelId?: string;
  conversationId?: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  encryptedData: string;
  attachmentKey: string;
}

export interface AttachmentMetadata {
  id: string;
  channelId?: string;
  conversationId?: string;
  uploaderId: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: number;
  attachmentKeyId: string;
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
    return this.auth.hostname.startsWith('http')
      ? this.auth.hostname
      : `https://${this.auth.hostname}`;
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
   * Encrypt attachment data with a per-attachment key using AES-256-GCM.
   * Output format: base64(iv[12] || ciphertext || tag[16])
   */
  async encryptAttachmentData(data: Uint8Array, key: string): Promise<string> {
    try {
      const keyBytes = new Uint8Array(key.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
      if (keyBytes.length !== 32) {
        throw new Error(`Invalid attachment key length: ${keyBytes.length}, expected 32`);
      }
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes as Uint8Array<ArrayBuffer>,
        'AES-GCM',
        false,
        ['encrypt']
      );
      const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        data as Uint8Array<ArrayBuffer>
      );
      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(ciphertext), iv.length);
      return Buffer.from(combined).toString('base64');
    } catch (error) {
      console.error('Failed to encrypt attachment data:', error);
      throw error;
    }
  }

  /**
   * Decrypt attachment data with a per-attachment key using AES-256-GCM.
   * Expected input format: base64(iv[12] || ciphertext || tag[16])
   */
  async decryptAttachmentData(encryptedData: string, key: string): Promise<Uint8Array> {
    try {
      const keyBytes = new Uint8Array(key.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
      if (keyBytes.length !== 32) {
        throw new Error(`Invalid attachment key length: ${keyBytes.length}, expected 32`);
      }
      const combined = new Uint8Array(Buffer.from(encryptedData, 'base64'));
      if (combined.length < 12 + 16) {
        throw new Error('Encrypted attachment data too short');
      }
      const iv = combined.slice(0, 12) as Uint8Array<ArrayBuffer>;
      const ciphertext = combined.slice(12) as Uint8Array<ArrayBuffer>;
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes as Uint8Array<ArrayBuffer>,
        'AES-GCM',
        false,
        ['decrypt']
      );
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
      return new Uint8Array(plaintext);
    } catch (error) {
      console.error('Failed to decrypt attachment data:', error);
      throw error;
    }
  }

  /**
   * Create attachment keys for all members of a channel
   */
  async createChannelAttachmentKeys(
    attachmentId: string,
    channelId: string,
    key: string
  ): Promise<void> {
    try {
      // Get channel members
      const members = await this.getChannelMembers(channelId);

      // Create encrypted keys for each member's devices
      const keyRequests = [];
      for (const member of members) {
        // For now, assume one device per user (in reality, would handle multiple devices)
        const encryptedKey = await this.encryptAttachmentKeyForUser(key, member.userId);
        keyRequests.push({
          userId: member.userId,
          deviceId: member.deviceId || 'default',
          encrypted_key: encryptedKey,
        });
      }

      // Store the attachment keys
      const request: CreateAttachmentKeyRequest = {
        attachmentId,
        keys: keyRequests,
      };

      const response = await fetch(`${this.getBaseUrl()}/api/v1/attachments/${attachmentId}/keys`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.auth.token}`,
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
  async createConversationAttachmentKeys(
    attachmentId: string,
    conversationId: string,
    key: string
  ): Promise<void> {
    try {
      // Get conversation participants
      const participants = await this.getConversationParticipants(conversationId);

      // Create encrypted keys for each participant's devices
      const keyRequests = [];
      for (const participant of participants) {
        const encryptedKey = await this.encryptAttachmentKeyForUser(key, participant.userId);
        keyRequests.push({
          userId: participant.userId,
          deviceId: participant.deviceId || 'default',
          encrypted_key: encryptedKey,
        });
      }

      // Store the attachment keys
      const request: CreateAttachmentKeyRequest = {
        attachmentId,
        keys: keyRequests,
      };

      const response = await fetch(`${this.getBaseUrl()}/api/v1/attachments/${attachmentId}/keys`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.auth.token}`,
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
          Authorization: `Bearer ${this.auth.token}`,
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
        channelId,
        originalName: fileName,
        contentType,
        sizeBytes: data.length,
        encryptedData,
        attachmentKey,
      };

      const response = await fetch(
        `${this.getBaseUrl()}/api/v1/channels/${channelId}/attachments`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.auth.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(uploadRequest),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to upload attachment: ${response.status}`);
      }

      const metadata = (await response.json()) as AttachmentMetadata;

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
        conversationId,
        originalName: fileName,
        contentType,
        sizeBytes: data.length,
        encryptedData,
        attachmentKey,
      };

      const response = await fetch(
        `${this.getBaseUrl()}/api/v1/conversations/${conversationId}/attachments`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.auth.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(uploadRequest),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to upload conversation attachment: ${response.status}`);
      }

      const metadata = (await response.json()) as AttachmentMetadata;

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
  async downloadAttachment(
    attachmentId: string
  ): Promise<{ data: Uint8Array; metadata: AttachmentMetadata }> {
    try {
      // Get attachment metadata
      const metadata = await this.getAttachmentMetadata(attachmentId);

      // Get attachment keys for current user
      const keys = await this.getAttachmentKeys(attachmentId);

      // Find the key for the current user/device
      const userKey = keys.find(
        key => key.userId === this.auth.userId && key.deviceId === this.auth.deviceId
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
      originalName: 'unknown',
      contentType: 'application/octet-stream',
      sizeBytes: 0,
      createdAt: Date.now(),
      uploaderId: 'unknown',
      attachmentKeyId: 'unknown',
    };
  }

  /**
   * Download encrypted attachment data
   */
  private async downloadEncryptedAttachment(_attachmentId: string): Promise<string> {
    // This would download the encrypted attachment from the server
    // For now, return a placeholder
    return '';
  }

  /**
   * Get channel members
   */
  private async getChannelMembers(
    _channelId: string
  ): Promise<{ userId: string; deviceId?: string }[]> {
    // This would fetch channel members from the server
    // For now, return the current user as a member
    return [
      {
        userId: this.auth.userId,
        deviceId: this.auth.deviceId,
      },
    ];
  }

  /**
   * Get conversation participants
   */
  private async getConversationParticipants(
    _conversationId: string
  ): Promise<{ userId: string; deviceId?: string }[]> {
    // This would fetch conversation participants from the server
    // For now, return the current user as a participant
    return [
      {
        userId: this.auth.userId,
        deviceId: this.auth.deviceId,
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
        attachmentKey: key,
        forUserId: userId,
        createdBy: this.auth.userId,
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
      return parsed.attachmentKey;
    } catch (error) {
      console.error('Failed to decrypt attachment key for user:', error);
      throw error;
    }
  }
}
