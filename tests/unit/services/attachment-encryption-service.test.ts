/**
 * Unit tests for AttachmentEncryptionService
 *
 * Tests the per-attachment encryption service for Signal Protocol v2.3.
 */

import { AttachmentEncryptionService } from '../../../src/renderer/services/attachment-encryption-service';
import { SignalSessionManager } from '../../../src/renderer/managers/signal-session-manager';

// Mock fetch for API calls
global.fetch = jest.fn();

// Mock window.emberAPI for auth
const mockAuth = {
  token: 'test-token',
  hostname: 'https://test.example.com',
  userId: 'user-123',
  deviceId: 'device-456',
  username: 'testuser',
};

describe('AttachmentEncryptionService', () => {
  let attachmentEncryptionService: AttachmentEncryptionService;
  let mockSignalSessionManager: jest.Mocked<SignalSessionManager>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock SignalSessionManager
    mockSignalSessionManager = {
      hasSession: jest.fn(),
      ensureSession: jest.fn(),
      encrypt: jest.fn(),
      decrypt: jest.fn(),
      groupEncrypt: jest.fn(),
      groupDecrypt: jest.fn(),
      createSenderKeyDistribution: jest.fn(),
      processSenderKeyDistribution: jest.fn(),
      getAuth: jest.fn(),
      isReady: jest.fn(),
      destroy: jest.fn(),
    } as any;

    // Create attachment encryption service
    attachmentEncryptionService = new AttachmentEncryptionService(
      mockAuth,
      mockSignalSessionManager
    );

    // Mock successful fetch responses by default
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  describe('initialization', () => {
    it('should create AttachmentEncryptionService with required dependencies', () => {
      expect(attachmentEncryptionService).toBeInstanceOf(AttachmentEncryptionService);
    });

    it('should throw error if auth data is missing', () => {
      expect(() => {
        new AttachmentEncryptionService(null as any, mockSignalSessionManager);
      }).toThrow('Auth data is required');
    });

    it('should throw error if SignalSessionManager is missing', () => {
      expect(() => {
        new AttachmentEncryptionService(mockAuth, null as any);
      }).toThrow('SignalSessionManager is required');
    });
  });

  describe('generateAttachmentKey', () => {
    it('should generate a cryptographically secure key', () => {
      const key = attachmentEncryptionService.generateAttachmentKey();

      expect(key).toMatch(/^[a-f0-9]{64}$/); // 32 bytes = 64 hex characters
      expect(key.length).toBe(64);
    });

    it('should generate different keys each time', () => {
      const key1 = attachmentEncryptionService.generateAttachmentKey();
      const key2 = attachmentEncryptionService.generateAttachmentKey();

      expect(key1).not.toBe(key2);
    });
  });

  describe('encryptAttachmentData and decryptAttachmentData', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const originalData = new TextEncoder().encode('Hello, World!');
      const key = 'a'.repeat(64); // Simple key for testing

      const encryptedData = await attachmentEncryptionService.encryptAttachmentData(
        originalData,
        key
      );
      const decryptedData = await attachmentEncryptionService.decryptAttachmentData(
        encryptedData,
        key
      );

      expect(decryptedData).toEqual(originalData);
    });

    it('should produce different encrypted data for same input (random IV)', async () => {
      const originalData = new TextEncoder().encode('Hello, World!');
      const key = 'a'.repeat(64);

      const encryptedData1 = await attachmentEncryptionService.encryptAttachmentData(
        originalData,
        key
      );
      const encryptedData2 = await attachmentEncryptionService.encryptAttachmentData(
        originalData,
        key
      );

      expect(encryptedData1).not.toBe(encryptedData2); // AES-GCM uses a random IV per encryption
    });

    it('should handle empty data', async () => {
      const originalData = new Uint8Array(0);
      const key = 'a'.repeat(64);

      const encryptedData = await attachmentEncryptionService.encryptAttachmentData(
        originalData,
        key
      );
      const decryptedData = await attachmentEncryptionService.decryptAttachmentData(
        encryptedData,
        key
      );

      expect(decryptedData).toEqual(originalData);
    });
  });

  describe('createChannelAttachmentKeys', () => {
    it('should create attachment keys for channel members', async () => {
      const attachmentId = 'attachment-123';
      const channelId = 'channel-456';
      const key = 'a'.repeat(64);

      await attachmentEncryptionService.createChannelAttachmentKeys(attachmentId, channelId, key);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/attachments/attachment-123/keys',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('"attachmentId":"attachment-123"'),
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      const attachmentId = 'attachment-123';
      const channelId = 'channel-456';
      const key = 'a'.repeat(64);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        attachmentEncryptionService.createChannelAttachmentKeys(attachmentId, channelId, key)
      ).rejects.toThrow('Failed to create attachment keys: 500');
    });
  });

  describe('createConversationAttachmentKeys', () => {
    it('should create attachment keys for conversation participants', async () => {
      const attachmentId = 'attachment-123';
      const conversationId = 'conversation-456';
      const key = 'a'.repeat(64);

      await attachmentEncryptionService.createConversationAttachmentKeys(
        attachmentId,
        conversationId,
        key
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/attachments/attachment-123/keys',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        })
      );
    });
  });

  describe('getAttachmentKeys', () => {
    it('should fetch attachment keys', async () => {
      const mockKeys = [
        {
          id: 'key-123',
          attachmentId: 'attachment-456',
          userId: 'user-123',
          deviceId: 'device-456',
          encryptedKey: 'encrypted-key',
          createdAt: Date.now(),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: mockKeys }),
      });

      const result = await attachmentEncryptionService.getAttachmentKeys('attachment-456');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/attachments/attachment-456/keys',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );

      expect(result).toEqual(mockKeys);
    });

    it('should return empty array when no keys exist', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [] }),
      });

      const result = await attachmentEncryptionService.getAttachmentKeys('attachment-456');
      expect(result).toEqual([]);
    });
  });

  describe('uploadChannelAttachment', () => {
    it('should upload channel attachment with encryption', async () => {
      const channelId = 'channel-123';
      const fileName = 'test.txt';
      const contentType = 'text/plain';
      const data = new TextEncoder().encode('Hello, World!');

      const mockMetadata = {
        id: 'attachment-456',
        channelId,
        uploaderId: 'user-123',
        originalName: fileName,
        contentType,
        sizeBytes: data.length,
        createdAt: Date.now(),
        attachmentKeyId: 'key-789',
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => mockMetadata }) // Upload attachment
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // Create keys

      const result = await attachmentEncryptionService.uploadChannelAttachment(
        channelId,
        fileName,
        contentType,
        data
      );

      expect(result).toEqual(mockMetadata);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle upload errors gracefully', async () => {
      const channelId = 'channel-123';
      const fileName = 'test.txt';
      const contentType = 'text/plain';
      const data = new TextEncoder().encode('Hello, World!');

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        attachmentEncryptionService.uploadChannelAttachment(channelId, fileName, contentType, data)
      ).rejects.toThrow('Failed to upload attachment: 500');
    });
  });

  describe('uploadConversationAttachment', () => {
    it('should upload conversation attachment with encryption', async () => {
      const conversationId = 'conversation-123';
      const fileName = 'test.txt';
      const contentType = 'text/plain';
      const data = new TextEncoder().encode('Hello, World!');

      const mockMetadata = {
        id: 'attachment-456',
        conversationId,
        uploaderId: 'user-123',
        originalName: fileName,
        contentType,
        sizeBytes: data.length,
        createdAt: Date.now(),
        attachmentKeyId: 'key-789',
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => mockMetadata }) // Upload attachment
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // Create keys

      const result = await attachmentEncryptionService.uploadConversationAttachment(
        conversationId,
        fileName,
        contentType,
        data
      );

      expect(result).toEqual(mockMetadata);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('downloadAttachment', () => {
    it('should download and decrypt attachment', async () => {
      const attachmentId = 'attachment-123';
      const originalData = new TextEncoder().encode('Hello, World!');
      const key = 'a'.repeat(64);
      const encryptedData = await attachmentEncryptionService.encryptAttachmentData(
        originalData,
        key
      );

      const mockMetadata = {
        id: attachmentId,
        originalName: 'test.txt',
        contentType: 'text/plain',
        sizeBytes: originalData.length,
        createdAt: Date.now(),
        uploaderId: 'user-123',
        attachmentKeyId: 'key-789',
      };

      const mockKeys = [
        {
          id: 'key-123',
          attachmentId,
          userId: 'user-123',
          deviceId: 'device-456',
          encrypted_key: btoa(
            JSON.stringify({
              attachmentKey: key,
              forUserId: 'user-123',
              createdBy: 'user-123',
              timestamp: Date.now(),
            })
          ),
          createdAt: Date.now(),
        },
      ];

      // Mock the internal methods and API calls
      jest
        .spyOn(attachmentEncryptionService as any, 'getAttachmentMetadata')
        .mockResolvedValue(mockMetadata);
      jest
        .spyOn(attachmentEncryptionService as any, 'downloadEncryptedAttachment')
        .mockResolvedValue(encryptedData);
      jest.spyOn(attachmentEncryptionService, 'getAttachmentKeys').mockResolvedValue(mockKeys);

      const result = await attachmentEncryptionService.downloadAttachment(attachmentId);

      expect(result.data).toEqual(originalData);
      expect(result.metadata).toEqual(mockMetadata);
    });

    it('should throw error when no key found for user', async () => {
      const attachmentId = 'attachment-123';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [] }),
      });

      await expect(attachmentEncryptionService.downloadAttachment(attachmentId)).rejects.toThrow(
        'No attachment key found for current user'
      );
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(attachmentEncryptionService.getAttachmentKeys('attachment-123')).rejects.toThrow(
        'Network error'
      );
    });

    it('should handle invalid JSON responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(attachmentEncryptionService.getAttachmentKeys('attachment-123')).rejects.toThrow(
        'Invalid JSON'
      );
    });
  });
});
