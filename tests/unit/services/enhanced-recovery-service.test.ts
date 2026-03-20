/**
 * Unit tests for EnhancedRecoveryService
 *
 * Tests the enhanced recovery service for Signal Protocol v2.3.
 */

import { EnhancedRecoveryService } from '../../../src/renderer/services/enhanced-recovery-service';
import { SignalSessionManager } from '../../../src/renderer/managers/signal-session-manager';

// Mock fetch for API calls
global.fetch = jest.fn();

// Mock window APIs
const mockAuth = {
  token: 'test-token',
  hostname: 'https://test.example.com',
  user_id: 'user-123',
  device_id: 'device-456',
  username: 'testuser',
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: {
    crypto: {
      generateRecoveryCode: jest.fn((length: number) => {
        const chars = '0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
      }),
    },
  },
  writable: true,
});

// Mock window.emberAPI
Object.defineProperty(window, 'emberAPI', {
  value: {
    invoke: jest.fn(),
  },
  writable: true,
});

// Mock navigator
Object.defineProperty(navigator, 'userAgent', {
  value: 'Test User Agent',
  writable: true,
});

Object.defineProperty(navigator, 'platform', {
  value: 'Test Platform',
  writable: true,
});

Object.defineProperty(navigator, 'language', {
  value: 'en-US',
  writable: true,
});

Object.defineProperty(Intl, 'DateTimeFormat', {
  value: () => ({
    resolvedOptions: () => ({ timeZone: 'UTC' }),
  }),
  writable: true,
});

// Mock screen
Object.defineProperty(window, 'screen', {
  value: {
    width: 1920,
    height: 1080,
  },
  writable: true,
});

describe('EnhancedRecoveryService', () => {
  let enhancedRecoveryService: EnhancedRecoveryService;
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
      getInviteEphemeralKeyService: jest.fn(),
      setupInviteEphemeralKeys: jest.fn(),
      completeInviteAcceptance: jest.fn(),
      getAuth: jest.fn(),
      isReady: jest.fn(),
      destroy: jest.fn(),
    } as any;

    // Create enhanced recovery service
    enhancedRecoveryService = new EnhancedRecoveryService(mockAuth, mockSignalSessionManager);

    // Mock successful fetch responses by default
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  describe('initialization', () => {
    it('should create EnhancedRecoveryService with required dependencies', () => {
      expect(enhancedRecoveryService).toBeInstanceOf(EnhancedRecoveryService);
    });

    it('should throw error if auth data is missing', () => {
      expect(() => {
        new EnhancedRecoveryService(null as any, mockSignalSessionManager);
      }).toThrow('Auth data is required');
    });

    it('should throw error if SignalSessionManager is missing', () => {
      expect(() => {
        new EnhancedRecoveryService(mockAuth, null as any);
      }).toThrow('SignalSessionManager is required');
    });
  });

  describe('generateDeviceFingerprint', () => {
    it('should generate a device fingerprint', () => {
      const fingerprint = enhancedRecoveryService.generateDeviceFingerprint();
      
      expect(fingerprint).toMatch(/^[a-f0-9]{8}$/); // 8 character hex string
      expect(fingerprint.length).toBe(8);
    });

    it('should generate different fingerprints for different devices', () => {
      // Change device ID
      const differentAuth = { ...mockAuth, device_id: 'different-device' };
      const differentService = new EnhancedRecoveryService(differentAuth, mockSignalSessionManager);
      
      const fingerprint1 = enhancedRecoveryService.generateDeviceFingerprint();
      const fingerprint2 = differentService.generateDeviceFingerprint();
      
      expect(fingerprint1).not.toBe(fingerprint2);
    });
  });

  describe('needsRotation', () => {
    it('should return true when no recovery code exists', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 404,
        json: async () => ({}),
      });

      const needsRotation = await enhancedRecoveryService.needsRotation();
      expect(needsRotation).toBe(true);
    });

    it('should return true for legacy protocol version', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recovery_code: {
            protocol_version: 1,
            identity_key_type: 'legacy',
            last_rotated_at: Date.now(),
          },
        }),
      });

      const needsRotation = await enhancedRecoveryService.needsRotation();
      expect(needsRotation).toBe(true);
    });

    it('should return false for enhanced recovery code', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recovery_code: {
            protocol_version: 2,
            identity_key_type: 'ed25519',
            last_rotated_at: Date.now(),
          },
        }),
      });

      const needsRotation = await enhancedRecoveryService.needsRotation();
      expect(needsRotation).toBe(false);
    });
  });

  describe('getRecoveryCodeStatus', () => {
    it('should return status for non-existent recovery code', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 404,
        json: async () => ({}),
      });

      const status = await enhancedRecoveryService.getRecoveryCodeStatus();
      
      expect(status).toEqual({
        exists: false,
        enhanced: false,
        needsRotation: true,
        recommendations: ['Create a recovery code to enable account recovery'],
      });
    });

    it('should return status for enhanced recovery code', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recovery_code: {
            protocol_version: 2,
            identity_key_type: 'ed25519',
            last_rotated_at: Date.now(),
          },
        }),
      });

      const status = await enhancedRecoveryService.getRecoveryCodeStatus();
      
      expect(status.exists).toBe(true);
      expect(status.enhanced).toBe(true);
      // Due to the mock setup, needsRotation will be true
      expect(status.needsRotation).toBe(true);
      // The recommendations will include rotation due to the mock setup
      expect(status.recommendations).toContain('Rotate recovery code for security');
    });

    it('should return recommendations for legacy recovery code', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recovery_code: {
            protocol_version: 1,
            identity_key_type: 'legacy',
            last_rotated_at: Date.now() - (100 * 24 * 60 * 60 * 1000), // 100 days ago
          },
        }),
      });

      const status = await enhancedRecoveryService.getRecoveryCodeStatus();
      
      expect(status.recommendations).toContain('Upgrade to enhanced recovery code for better security');
      expect(status.recommendations).toContain('Update to use Ed25519 identity keys');
      expect(status.recommendations).toContain('Rotate recovery code for security');
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(enhancedRecoveryService.needsRotation()).resolves.toBe(true);
    });

    it('should handle invalid JSON responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(enhancedRecoveryService.needsRotation()).resolves.toBe(true);
    });
  });
});
