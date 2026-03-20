/**
 * Unit tests for InviteEphemeralKeyService
 *
 * Tests the ephemeral key distribution service for Signal Protocol v2.3 invites.
 */

import { InviteEphemeralKeyService } from '../../../src/renderer/services/invite-ephemeral-key-service';
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

describe('InviteEphemeralKeyService', () => {
  let inviteEphemeralKeyService: InviteEphemeralKeyService;
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
      getCurrentEpoch: jest.fn(),
      rotateEpoch: jest.fn(),
      processPendingRotations: jest.fn(),
      decryptMessageWithEpoch: jest.fn(),
      getEpochService: jest.fn(),
      getEpochHistoryService: jest.fn(),
      getAuth: jest.fn(),
      isReady: jest.fn(),
      destroy: jest.fn(),
    } as any;

    // Create invite ephemeral key service
    inviteEphemeralKeyService = new InviteEphemeralKeyService(mockAuth, mockSignalSessionManager);

    // Mock successful fetch responses by default
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  describe('initialization', () => {
    it('should create InviteEphemeralKeyService with required dependencies', () => {
      expect(inviteEphemeralKeyService).toBeInstanceOf(InviteEphemeralKeyService);
    });

    it('should throw error if auth data is missing', () => {
      expect(() => {
        new InviteEphemeralKeyService(null as any, mockSignalSessionManager);
      }).toThrow('Auth data is required');
    });

    it('should throw error if SignalSessionManager is missing', () => {
      expect(() => {
        new InviteEphemeralKeyService(mockAuth, null as any);
      }).toThrow('SignalSessionManager is required');
    });
  });

  describe('createInviteEphemeralKeys', () => {
    it('should create ephemeral keys for invite', async () => {
      const request = {
        invite_id: 'invite-123',
        ember_id: 'ember-456',
        epoch_id: 'epoch-789',
        key_packages: [
          {
            user_id: 'user-123',
            device_id: 'device-456',
            encrypted_key_package: 'encrypted-package',
          },
        ],
      };

      const result = await inviteEphemeralKeyService.createInviteEphemeralKeys(request);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/invites/invite-123/ephemeral-keys',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify(request),
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      const request = {
        invite_id: 'invite-123',
        ember_id: 'ember-456',
        epoch_id: 'epoch-789',
        key_packages: [],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(inviteEphemeralKeyService.createInviteEphemeralKeys(request)).rejects.toThrow('Failed to create invite ephemeral keys: 500');
    });
  });

  describe('getInviteEphemeralKeys', () => {
    it('should fetch ephemeral keys for invite', async () => {
      const mockKeys = [
        {
          invite_id: 'invite-123',
          ember_id: 'ember-456',
          epoch_id: 'epoch-789',
          encrypted_package: 'encrypted-package-1',
          created_at: Date.now(),
        },
        {
          invite_id: 'invite-123',
          ember_id: 'ember-456',
          epoch_id: 'epoch-789',
          encrypted_package: 'encrypted-package-2',
          created_at: Date.now(),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ephemeral_keys: mockKeys }),
      });

      const result = await inviteEphemeralKeyService.getInviteEphemeralKeys('invite-123');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/invites/invite-123/ephemeral-keys',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );

      expect(result).toEqual(mockKeys);
    });

    it('should return empty array when no keys exist', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ephemeral_keys: [] }),
      });

      const result = await inviteEphemeralKeyService.getInviteEphemeralKeys('invite-123');
      expect(result).toEqual([]);
    });
  });

  describe('createInviteSenderKeyDistribution', () => {
    it('should create sender key distribution for invite', async () => {
      const request = {
        invite_id: 'invite-123',
        ember_id: 'ember-456',
        distribution_message: 'distribution-message',
      };

      await inviteEphemeralKeyService.createInviteSenderKeyDistribution(request);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/invites/invite-123/sender-key-distributions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify(request),
        })
      );
    });
  });

  describe('getInviteSenderKeyDistributions', () => {
    it('should fetch sender key distributions for invite', async () => {
      const mockDistributions = [
        {
          invite_id: 'invite-123',
          ember_id: 'ember-456',
          sender_user_id: 'user-789',
          sender_device_id: 'device-012',
          distribution_message: 'distribution-message-1',
          created_at: Date.now(),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sender_key_distributions: mockDistributions }),
      });

      const result = await inviteEphemeralKeyService.getInviteSenderKeyDistributions('invite-123');

      expect(result).toEqual(mockDistributions);
    });
  });

  describe('getInvitePendingPredistributions', () => {
    it('should fetch pending predistributions for invite', async () => {
      const mockPredistributions = [
        {
          invite_id: 'invite-123',
          ember_id: 'ember-456',
          user_id: 'user-789',
          device_id: 'device-012',
          predistribution_data: 'predistribution-data',
          created_at: Date.now(),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pending_predistributions: mockPredistributions }),
      });

      const result = await inviteEphemeralKeyService.getInvitePendingPredistributions('invite-123');

      expect(result).toEqual(mockPredistributions);
    });
  });

  describe('processInvitePendingPredistributions', () => {
    it('should process pending predistributions for invite', async () => {
      await inviteEphemeralKeyService.processInvitePendingPredistributions('invite-123');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.example.com/api/v1/invites/invite-123/pending-predistributions/process',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );
    });
  });

  describe('generateInviteEphemeralKeys', () => {
    it('should generate ephemeral keys for invite', async () => {
      const mockEpoch = {
        id: 'epoch-789',
        ember_id: 'ember-456',
        epoch_number: 1,
        created_at: Date.now(),
      };

      mockSignalSessionManager.getCurrentEpoch.mockResolvedValue(mockEpoch as any);

      const result = await inviteEphemeralKeyService.generateInviteEphemeralKeys('invite-123', 'ember-456');

      expect(result).toEqual({
        invite_id: 'invite-123',
        ember_id: 'ember-456',
        epoch_id: 'epoch-789',
        key_packages: [
          {
            user_id: 'user-123',
            device_id: 'device-456',
            encrypted_key_package: expect.any(String),
          },
        ],
      });

      expect(mockSignalSessionManager.getCurrentEpoch).toHaveBeenCalledWith('ember-456');
    });

    it('should throw error when no current epoch exists', async () => {
      mockSignalSessionManager.getCurrentEpoch.mockResolvedValue(null);

      await expect(inviteEphemeralKeyService.generateInviteEphemeralKeys('invite-123', 'ember-456')).rejects.toThrow('No current epoch found for ember');
    });
  });

  describe('generateInviteSenderKeyDistribution', () => {
    it('should generate sender key distribution for invite', async () => {
      const mockDistributionMessage = new TextEncoder().encode('distribution-message');
      mockSignalSessionManager.createSenderKeyDistribution.mockResolvedValue(mockDistributionMessage);

      const result = await inviteEphemeralKeyService.generateInviteSenderKeyDistribution('invite-123', 'ember-456');

      expect(result).toEqual({
        invite_id: 'invite-123',
        ember_id: 'ember-456',
        distribution_message: expect.any(String), // base64 encoded
      });

      expect(mockSignalSessionManager.createSenderKeyDistribution).toHaveBeenCalledWith('ember-456');
    });
  });

  describe('processInviteEphemeralKeys', () => {
    it('should process ephemeral keys and distributions for invite', async () => {
      const mockEphemeralKeys = [
        {
          invite_id: 'invite-123',
          ember_id: 'ember-456',
          epoch_id: 'epoch-789',
          encrypted_package: btoa(JSON.stringify({
            ephemeral_key: 'test-key',
            epoch_id: 'epoch-789',
            timestamp: Date.now(),
          })),
          created_at: Date.now(),
        },
      ];

      const mockSenderKeyDistributions = [
        {
          invite_id: 'invite-123',
          ember_id: 'ember-456',
          sender_user_id: 'user-789',
          sender_device_id: 'device-012',
          distribution_message: btoa(String.fromCharCode(...new TextEncoder().encode('distribution-message'))),
          created_at: Date.now(),
        },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ephemeral_keys: mockEphemeralKeys }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sender_key_distributions: mockSenderKeyDistributions }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await inviteEphemeralKeyService.processInviteEphemeralKeys('invite-123', 'ember-456');

      expect(mockSignalSessionManager.processSenderKeyDistribution).toHaveBeenCalledWith(
        'user-789.device-012',
        expect.any(Uint8Array)
      );

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('setupInviteEphemeralKeys', () => {
    it('should setup complete ephemeral keys for invite', async () => {
      const mockEpoch = {
        id: 'epoch-789',
        ember_id: 'ember-456',
        epoch_number: 1,
        created_at: Date.now(),
      };

      const mockDistributionMessage = new TextEncoder().encode('distribution-message');

      mockSignalSessionManager.getCurrentEpoch.mockResolvedValue(mockEpoch as any);
      mockSignalSessionManager.createSenderKeyDistribution.mockResolvedValue(mockDistributionMessage);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // createInviteEphemeralKeys
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // createInviteSenderKeyDistribution

      await inviteEphemeralKeyService.setupInviteEphemeralKeys('invite-123', 'ember-456');

      expect(mockSignalSessionManager.getCurrentEpoch).toHaveBeenCalledWith('ember-456');
      expect(mockSignalSessionManager.createSenderKeyDistribution).toHaveBeenCalledWith('ember-456');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('completeInviteAcceptance', () => {
    it('should complete invite acceptance with ephemeral key processing', async () => {
      const mockEphemeralKeys = [
        {
          invite_id: 'invite-123',
          ember_id: 'ember-456',
          epoch_id: 'epoch-789',
          encrypted_package: btoa(JSON.stringify({
            ephemeral_key: 'test-key',
            epoch_id: 'epoch-789',
            timestamp: Date.now(),
          })),
          created_at: Date.now(),
        },
      ];

      const mockSenderKeyDistributions = [
        {
          invite_id: 'invite-123',
          ember_id: 'ember-456',
          sender_user_id: 'user-789',
          sender_device_id: 'device-012',
          distribution_message: btoa(String.fromCharCode(...new TextEncoder().encode('distribution-message'))),
          created_at: Date.now(),
        },
      ];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ephemeral_keys: mockEphemeralKeys }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sender_key_distributions: mockSenderKeyDistributions }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await inviteEphemeralKeyService.completeInviteAcceptance('invite-123', 'ember-456');

      expect(mockSignalSessionManager.processSenderKeyDistribution).toHaveBeenCalledWith(
        'user-789.device-012',
        expect.any(Uint8Array)
      );

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(inviteEphemeralKeyService.getInviteEphemeralKeys('invite-123')).rejects.toThrow('Network error');
    });

    it('should handle invalid JSON responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(inviteEphemeralKeyService.getInviteEphemeralKeys('invite-123')).rejects.toThrow('Invalid JSON');
    });
  });
});
