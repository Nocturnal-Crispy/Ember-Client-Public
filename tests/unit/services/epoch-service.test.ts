/**
 * Unit tests for EpochService
 *
 * Tests the client-side epoch management service that handles
 * epoch rotation, key management, and history decryption.
 */

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

describe('EpochService', () => {
  let epochService: EpochService;
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
    } as any;

    // Create epoch service
    epochService = new EpochService(mockAuth, mockSignalSessionManager);

    // Mock successful fetch responses by default
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  describe('initialization', () => {
    it('should create EpochService with auth and SignalSessionManager', () => {
      expect(epochService).toBeInstanceOf(EpochService);
    });

    it('should throw error if auth data is missing', () => {
      expect(() => {
        new EpochService(null as any, mockSignalSessionManager);
      }).toThrow('Auth data is required');
    });

    it('should throw error if SignalSessionManager is missing', () => {
      expect(() => {
        new EpochService(mockAuth, null as any);
      }).toThrow('SignalSessionManager is required');
    });
  });

  describe('getCurrentEpoch', () => {
    it('should fetch current epoch for ember', async () => {
      const mockEpoch = {
        id: 'epoch-123',
        ember_id: 'ember-456',
        epoch_number: 1,
        created_at: Date.now(),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ epochs: [mockEpoch] }),
      });

      const result = await epochService.getCurrentEpoch('ember-456');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/embers/ember-456/epochs?limit=1',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );

      expect(result).toEqual(mockEpoch);
    });

    it('should handle API errors gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(epochService.getCurrentEpoch('ember-456')).rejects.toThrow('Failed to fetch current epoch');
    });

    it('should return null if no epochs exist', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ epochs: [] }),
      });

      const result = await epochService.getCurrentEpoch('ember-456');
      expect(result).toBeNull();
    });
  });

  describe('createEpoch', () => {
    it('should create new epoch with rotation data', async () => {
      const mockEpoch = {
        id: 'epoch-789',
        ember_id: 'ember-456',
        epoch_number: 2,
        created_at: Date.now(),
      };

      const rotationData = 'rotation-payload';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => (mockEpoch),
      });

      const result = await epochService.createEpoch('ember-456', rotationData);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/embers/ember-456/epochs',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ rotation_data: rotationData }),
        })
      );

      expect(result).toEqual(mockEpoch);
    });

    it('should create epoch without rotation data', async () => {
      const mockEpoch = {
        id: 'epoch-789',
        ember_id: 'ember-456',
        epoch_number: 2,
        created_at: Date.now(),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => (mockEpoch),
      });

      const result = await epochService.createEpoch('ember-456');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/embers/ember-456/epochs',
        expect.objectContaining({
          body: JSON.stringify({}),
        })
      );

      expect(result).toEqual(mockEpoch);
    });
  });

  describe('getPendingRotations', () => {
    it('should fetch pending epoch rotations', async () => {
      const mockRotations = [
        {
          id: 'rotation-1',
          ember_id: 'ember-456',
          epoch_number: 2,
          rotation_data: 'rotation-data-1',
          created_at: Date.now(),
        },
        {
          id: 'rotation-2',
          ember_id: 'ember-789',
          epoch_number: 3,
          rotation_data: 'rotation-data-2',
          created_at: Date.now(),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pending_rotations: mockRotations }),
      });

      const result = await epochService.getPendingRotations();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/embers/pending-epoch-rotations',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );

      expect(result).toEqual(mockRotations);
    });
  });

  describe('acknowledgeRotation', () => {
    it('should acknowledge epoch rotation', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'rotation acknowledged' }),
      });

      await epochService.acknowledgeRotation('rotation-123');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/pending-epoch-rotations/rotation-123',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );
    });
  });

  describe('epoch key management', () => {
    it('should fetch epoch keys', async () => {
      const mockKeys = [
        {
          user_id: 'user-123',
          device_id: 'device-456',
          encrypted_key: 'encrypted-key-1',
          created_at: Date.now(),
        },
        {
          user_id: 'user-789',
          device_id: 'device-012',
          encrypted_key: 'encrypted-key-2',
          created_at: Date.now(),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ epoch_id: 'epoch-123', ember_id: 'ember-456', keys: mockKeys }),
      });

      const result = await epochService.getEpochKeys('epoch-123');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/epochs/epoch-123/keys',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );

      expect(result).toEqual(mockKeys);
    });

    it('should store epoch keys', async () => {
      const keys = [
        {
          user_id: 'user-123',
          device_id: 'device-456',
          encrypted_key: 'encrypted-key-1',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'stored 1 epoch keys' }),
      });

      await epochService.storeEpochKeys('epoch-123', 'ember-456', keys);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/epochs/epoch-123/keys',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ keys }),
        })
      );
    });

    it('should fetch user epoch keys for ember', async () => {
      const mockEpochKeys = {
        'epoch-123': [
          {
            user_id: 'user-123',
            device_id: 'device-456',
            encrypted_key: 'encrypted-key-1',
            created_at: Date.now(),
          },
        ],
        'epoch-456': [
          {
            user_id: 'user-123',
            device_id: 'device-456',
            encrypted_key: 'encrypted-key-2',
            created_at: Date.now(),
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ember_id: 'ember-456', epoch_keys: mockEpochKeys }),
      });

      const result = await epochService.getUserEpochKeys('ember-456');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/embers/ember-456/epoch-keys',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );

      expect(result).toEqual(mockEpochKeys);
    });
  });

  describe('epoch rotation workflow', () => {
    it('should handle complete epoch rotation', async () => {
      // Mock current epoch
      const currentEpoch = {
        id: 'epoch-123',
        ember_id: 'ember-456',
        epoch_number: 1,
        created_at: Date.now(),
      };

      // Mock new epoch creation
      const newEpoch = {
        id: 'epoch-456',
        ember_id: 'ember-456',
        epoch_number: 2,
        created_at: Date.now(),
      };

      // Mock SignalSessionManager methods
      mockSignalSessionManager.groupEncrypt.mockResolvedValue(new TextEncoder().encode('encrypted-rotation-data'));

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ epochs: [currentEpoch] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => (newEpoch) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'stored 1 epoch keys' }) });

      const result = await epochService.rotateEpoch('ember-456');

      expect(mockSignalSessionManager.groupEncrypt).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(3); // getCurrentEpoch, createEpoch, storeEpochKeys
      expect(result).toEqual(newEpoch);
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(epochService.getCurrentEpoch('ember-456')).rejects.toThrow('Network error');
    });

    it('should handle invalid JSON responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(epochService.getCurrentEpoch('ember-456')).rejects.toThrow('Invalid JSON');
    });
  });
});
