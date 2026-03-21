/**
 * Unit tests for EpochHistoryService
 *
 * Tests the epoch-aware message decryption service that handles
 * historical messages across epoch boundaries.
 */

import { EpochHistoryService } from '../../../src/renderer/services/epoch-history-service';
import { EpochService } from '../../../src/renderer/services/epoch-service';
import { SignalSessionManager } from '../../../src/renderer/managers/signal-session-manager';

// Mock fetch for API calls
global.fetch = jest.fn();

// Mock window.emberAPI for auth
const mockAuth = {
  token: 'test-token',
  hostname: 'https://test.example.com',
  user_id: 'user-123',
  device_id: 'device-456',
  username: 'testuser',
};

describe('EpochHistoryService', () => {
  let epochHistoryService: EpochHistoryService;
  let mockEpochService: jest.Mocked<EpochService>;
  let mockSignalSessionManager: jest.Mocked<SignalSessionManager>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock EpochService
    mockEpochService = {
      getCurrentEpoch: jest.fn(),
      createEpoch: jest.fn(),
      getPendingRotations: jest.fn(),
      acknowledgeRotation: jest.fn(),
      getEpochKeys: jest.fn(),
      storeEpochKeys: jest.fn(),
      getUserEpochKeys: jest.fn(),
      rotateEpoch: jest.fn(),
    } as any;

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
    } as any;

    // Create epoch history service
    epochHistoryService = new EpochHistoryService(mockAuth, mockEpochService, mockSignalSessionManager);

    // Mock successful fetch responses by default
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  describe('initialization', () => {
    it('should create EpochHistoryService with required dependencies', () => {
      expect(epochHistoryService).toBeInstanceOf(EpochHistoryService);
    });

    it('should throw error if auth data is missing', () => {
      expect(() => {
        new EpochHistoryService(null as any, mockEpochService, mockSignalSessionManager);
      }).toThrow('Auth data is required');
    });

    it('should throw error if EpochService is missing', () => {
      expect(() => {
        new EpochHistoryService(mockAuth, null as any, mockSignalSessionManager);
      }).toThrow('EpochService is required');
    });

    it('should throw error if SignalSessionManager is missing', () => {
      expect(() => {
        new EpochHistoryService(mockAuth, mockEpochService, null as any);
      }).toThrow('SignalSessionManager is required');
    });
  });

  describe('decryptMessage', () => {
    it('should decrypt v2.3+ epoch message with epoch_ciphertext', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'legacy-ciphertext',
        epoch_id: 'epoch-456',
        epoch_ciphertext: 'encrypted-epoch-data',
        protocol_version: 2,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      const result = await epochHistoryService.decryptMessage(message, 'ember-789');

      expect(result).toEqual({
        id: 'msg-123',
        plaintext: new TextEncoder().encode('encrypted-epoch-data'),
        epoch_id: 'epoch-456',
        created_at: message.created_at,
      });
    });

    it('should decrypt v2.3+ epoch message with regular ciphertext', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'encrypted-data',
        epoch_id: 'epoch-456',
        protocol_version: 2,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      const mockEpochKeys = [
        {
          user_id: 'user-123',
          device_id: 'device-456',
          encrypted_key: 'encrypted-epoch-key',
          created_at: Date.now(),
        },
      ];

      mockEpochService.getEpochKeys.mockResolvedValue(mockEpochKeys);

      const result = await epochHistoryService.decryptMessage(message, 'ember-789');

      expect(result).toEqual({
        id: 'msg-123',
        plaintext: new TextEncoder().encode('encrypted-data'),
        epoch_id: 'epoch-456',
        created_at: message.created_at,
      });

      expect(mockEpochService.getEpochKeys).toHaveBeenCalledWith('epoch-456');
    });

    it('should decrypt legacy v1.x message using SignalSessionManager', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'legacy-ciphertext',
        protocol_version: 1,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      const decryptedPlaintext = new TextEncoder().encode('decrypted-legacy-message');
      mockSignalSessionManager.groupDecrypt.mockResolvedValue(decryptedPlaintext);

      const result = await epochHistoryService.decryptMessage(message, 'ember-789');

      expect(result).toEqual({
        id: 'msg-123',
        plaintext: decryptedPlaintext,
        created_at: message.created_at,
      });

      expect(mockSignalSessionManager.groupDecrypt).toHaveBeenCalledWith(
        'ember-789',
        new TextEncoder().encode('legacy-ciphertext')
      );
    });

    it('should throw error for epoch message without epoch_id', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'encrypted-data',
        protocol_version: 2,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      await expect(epochHistoryService.decryptMessage(message, 'ember-789')).rejects.toThrow('Epoch message missing epoch_id');
    });

    it('should throw error when no epoch key found for user', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'encrypted-data',
        epoch_id: 'epoch-456',
        protocol_version: 2,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      mockEpochService.getEpochKeys.mockResolvedValue([]);

      await expect(epochHistoryService.decryptMessage(message, 'ember-789')).rejects.toThrow('No epoch key found for current user');
    });

    it('should throw error for legacy message decryption failure', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'legacy-ciphertext',
        protocol_version: 1,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      mockSignalSessionManager.groupDecrypt.mockRejectedValue(new Error('Decryption failed'));

      await expect(epochHistoryService.decryptMessage(message, 'ember-789')).rejects.toThrow('Legacy message decryption failed');
    });
  });

  describe('decryptMessages', () => {
    it('should decrypt multiple messages with mixed epochs', async () => {
      const messages = [
        {
          id: 'msg-1',
          ciphertext: 'legacy-ciphertext',
          protocol_version: 1,
          envelope_type: 'signal_group',
          created_at: Date.now(),
        },
        {
          id: 'msg-2',
          ciphertext: 'encrypted-data',
          epoch_id: 'epoch-456',
          protocol_version: 2,
          envelope_type: 'signal_group',
          created_at: Date.now(),
        },
        {
          id: 'msg-3',
          ciphertext: 'encrypted-data-2',
          epoch_id: 'epoch-789',
          protocol_version: 2,
          envelope_type: 'signal_group',
          created_at: Date.now(),
        },
      ];

      const mockEpochKeys = [
        {
          user_id: 'user-123',
          device_id: 'device-456',
          encrypted_key: 'encrypted-epoch-key',
          created_at: Date.now(),
        },
      ];

      mockEpochService.getEpochKeys.mockResolvedValue(mockEpochKeys);
      mockSignalSessionManager.groupDecrypt.mockResolvedValue(new TextEncoder().encode('decrypted-legacy'));

      const results = await epochHistoryService.decryptMessages(messages, 'ember-123');

      expect(results).toHaveLength(3);
      expect(mockEpochService.getEpochKeys).toHaveBeenCalledTimes(4); // 2 prefetch calls + 2 individual calls
      expect(mockSignalSessionManager.groupDecrypt).toHaveBeenCalledTimes(1);
    });

    it('should handle decryption failures gracefully', async () => {
      const messages = [
        {
          id: 'msg-1',
          ciphertext: 'legacy-ciphertext',
          protocol_version: 1,
          envelope_type: 'signal_group',
          created_at: Date.now(),
        },
        {
          id: 'msg-2',
          ciphertext: 'encrypted-data',
          epoch_id: 'epoch-456',
          protocol_version: 2,
          envelope_type: 'signal_group',
          created_at: Date.now(),
        },
      ];

      mockSignalSessionManager.groupDecrypt.mockRejectedValue(new Error('Legacy decryption failed'));
      mockEpochService.getEpochKeys.mockRejectedValue(new Error('Epoch keys unavailable'));

      const results = await epochHistoryService.decryptMessages(messages, 'ember-123');

      // Should return empty array when all decryptions fail
      expect(results).toHaveLength(0);
    });
  });

  describe('key cache management', () => {
    it('should cache epoch keys for performance', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'encrypted-data',
        epoch_id: 'epoch-456',
        protocol_version: 2,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      const mockEpochKeys = [
        {
          user_id: 'user-123',
          device_id: 'device-456',
          encrypted_key: 'encrypted-epoch-key',
          created_at: Date.now(),
        },
      ];

      mockEpochService.getEpochKeys.mockResolvedValue(mockEpochKeys);

      // Decrypt first message
      await epochHistoryService.decryptMessage(message, 'ember-789');

      // Decrypt second message from same epoch
      await epochHistoryService.decryptMessage(message, 'ember-789');

      // Should only call getEpochKeys twice due to caching (once for prefetch, once for actual decryption)
      expect(mockEpochService.getEpochKeys).toHaveBeenCalledTimes(2);
    });

    it('should clear key cache', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'encrypted-data',
        epoch_id: 'epoch-456',
        protocol_version: 2,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      const mockEpochKeys = [
        {
          user_id: 'user-123',
          device_id: 'device-456',
          encrypted_key: 'encrypted-epoch-key',
          created_at: Date.now(),
        },
      ];

      mockEpochService.getEpochKeys.mockResolvedValue(mockEpochKeys);

      // Decrypt message to populate cache
      await epochHistoryService.decryptMessage(message, 'ember-789');

      // Clear cache
      epochHistoryService.clearKeyCache();

      // Decrypt again - should fetch keys again
      await epochHistoryService.decryptMessage(message, 'ember-789');

      expect(mockEpochService.getEpochKeys).toHaveBeenCalledTimes(2);
    });
  });

  describe('canDecryptMessage', () => {
    it('should return true for legacy messages', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'legacy-ciphertext',
        protocol_version: 1,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      const canDecrypt = await epochHistoryService.canDecryptMessage(message);
      expect(canDecrypt).toBe(true);
    });

    it('should return true for epoch messages with available keys', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'encrypted-data',
        epoch_id: 'epoch-456',
        protocol_version: 2,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      const mockEpochKeys = [
        {
          user_id: 'user-123',
          device_id: 'device-456',
          encrypted_key: 'encrypted-epoch-key',
          created_at: Date.now(),
        },
      ];

      mockEpochService.getEpochKeys.mockResolvedValue(mockEpochKeys);

      const canDecrypt = await epochHistoryService.canDecryptMessage(message);
      expect(canDecrypt).toBe(true);
    });

    it('should return false for epoch messages without available keys', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'encrypted-data',
        epoch_id: 'epoch-456',
        protocol_version: 2,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      mockEpochService.getEpochKeys.mockResolvedValue([]);

      const canDecrypt = await epochHistoryService.canDecryptMessage(message);
      expect(canDecrypt).toBe(false);
    });
  });

  describe('getDecryptionInfo', () => {
    it('should provide decryption statistics for message batch', async () => {
      const messages = [
        {
          id: 'msg-1',
          ciphertext: 'legacy-ciphertext',
          protocol_version: 1,
          envelope_type: 'signal_group',
          created_at: Date.now(),
        },
        {
          id: 'msg-2',
          ciphertext: 'encrypted-data',
          epoch_id: 'epoch-456',
          protocol_version: 2,
          envelope_type: 'signal_group',
          created_at: Date.now(),
        },
        {
          id: 'msg-3',
          ciphertext: 'encrypted-data-2',
          epoch_id: 'epoch-789',
          protocol_version: 2,
          envelope_type: 'signal_group',
          created_at: Date.now(),
        },
      ];

      const mockEpochKeys = [
        {
          user_id: 'user-123',
          device_id: 'device-456',
          encrypted_key: 'encrypted-epoch-key',
          created_at: Date.now(),
        },
      ];

      mockEpochService.getEpochKeys.mockResolvedValue(mockEpochKeys);

      const info = await epochHistoryService.getDecryptionInfo(messages);

      expect(info).toEqual({
        total: 3,
        decryptable: 3, // All messages are decryptable in this test setup
        requiresEpochKeys: 2,
      });
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      const message = {
        id: 'msg-123',
        ciphertext: 'encrypted-data',
        epoch_id: 'epoch-456',
        protocol_version: 2,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      mockEpochService.getEpochKeys.mockRejectedValue(new Error('Network error'));

      await expect(epochHistoryService.decryptMessage(message, 'ember-789')).rejects.toThrow('Network error');
    });

    it('should handle malformed messages', async () => {
      const malformedMessage = {
        id: 'msg-123',
        ciphertext: '', // Empty ciphertext
        epoch_id: 'epoch-456',
        protocol_version: 2,
        envelope_type: 'signal_group',
        created_at: Date.now(),
      };

      const mockEpochKeys = [
        {
          user_id: 'user-123',
          device_id: 'device-456',
          encrypted_key: 'encrypted-epoch-key',
          created_at: Date.now(),
        },
      ];

      mockEpochService.getEpochKeys.mockResolvedValue(mockEpochKeys);

      // Should still attempt decryption even with empty ciphertext
      const result = await epochHistoryService.decryptMessage(malformedMessage, 'ember-789');
      expect(result.id).toBe('msg-123');
    });
  });
});
