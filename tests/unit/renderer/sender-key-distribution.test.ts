/**
 * Tests for Sender Key Distribution failures.
 * These tests reproduce the "Failed to create sender key distribution" errors.
 */

import { SignalSessionManager } from '../../../src/renderer/managers/signal-session-manager';

// Mock global window objects
declare global {
  interface Window {
    SignalService?: any;
  }
}

describe('Sender Key Distribution Failures', () => {
  let mockAuth: any;
  let mockSignalService: any;

  beforeEach(() => {
    mockAuth = {
      token: 'test-token',
      user_id: 'test-user-id',
      device_id: 'test-device-id',
      hostname: 'http://localhost:8085',
      username: 'test-user',
    };

    mockSignalService = {
      encrypt: jest.fn(),
      decrypt: jest.fn(),
      hasSession: jest.fn(),
      ensureSession: jest.fn(),
      groupEncrypt: jest.fn(),
      groupDecrypt: jest.fn(),
      createSenderKeyDistribution: jest.fn(),
      processSenderKeyDistribution: jest.fn(),
    };

    // Mock window.SignalService
    (window as any).SignalService = jest.fn().mockImplementation(() => mockSignalService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Sender Key Distribution Failures', () => {
    it('should reproduce sender key distribution failure error', async () => {
      // This test reproduces the exact error from logs:
      // "Failed to create sender key distribution"

      const sessionManager = new SignalSessionManager(mockAuth);

      // Mock createSenderKeyDistribution to throw an error
      const distributionError = new Error('Failed to create sender key distribution');
      mockSignalService.createSenderKeyDistribution = jest
        .fn()
        .mockRejectedValue(distributionError);

      const distributionId = 'test-distribution-id';

      // This should reproduce the exact error from the logs
      await expect(sessionManager.createSenderKeyDistribution(distributionId)).rejects.toThrow(
        'Failed to create sender key distribution: Failed to create sender key distribution'
      );

      // Verify the SignalService method was called
      expect(mockSignalService.createSenderKeyDistribution).toHaveBeenCalledWith(distributionId);
    });

    it('should handle sender key setup deferred scenario', async () => {
      // This test reproduces the warning from logs:
      // "Sender key setup deferred { ember_id='...', error='Failed to create sender key distribution' }"

      const sessionManager = new SignalSessionManager(mockAuth);

      // Mock createSenderKeyDistribution to throw the specific error
      const deferredError = new Error('Failed to create sender key distribution');
      mockSignalService.createSenderKeyDistribution = jest.fn().mockRejectedValue(deferredError);

      const emberId = '3a90a6c4-9460-4148-b985-6e86ef15a1eb';
      const distributionId = emberId; // In the logs, ember_id is used as distributionId

      try {
        await sessionManager.createSenderKeyDistribution(distributionId);
      } catch (error) {
        // This should match the error pattern from the logs
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Failed to create sender key distribution');
      }
    });

    it('should handle uninitialized SignalSessionManager during sender key creation', () => {
      const sessionManager = new SignalSessionManager(mockAuth);

      // Force the manager to be uninitialized
      (sessionManager as any).isInitialized = false;

      const _distributionId = 'test-distribution-id';

      // This should throw the not initialized error
      expect(() => {
        (sessionManager as any).ensureInitialized();
      }).toThrow('SignalSessionManager is not initialized');
    });

    it('should handle invalid distribution ID during sender key creation', async () => {
      const sessionManager = new SignalSessionManager(mockAuth);

      // This should throw validation error before even calling SignalService
      await expect(sessionManager.createSenderKeyDistribution('')).rejects.toThrow(
        'distributionId is required'
      );
    });

    it('should handle SignalService.createSenderKeyDistribution throwing generic error', async () => {
      const sessionManager = new SignalSessionManager(mockAuth);

      // Mock createSenderKeyDistribution to throw a generic error
      const genericError = new Error('Signal service unavailable');
      mockSignalService.createSenderKeyDistribution = jest.fn().mockRejectedValue(genericError);

      const distributionId = 'test-distribution-id';

      await expect(sessionManager.createSenderKeyDistribution(distributionId)).rejects.toThrow(
        'Failed to create sender key distribution: Signal service unavailable'
      );
    });
  });

  describe('Sender Key Processing Failures', () => {
    it('should handle sender key distribution processing failures', async () => {
      const sessionManager = new SignalSessionManager(mockAuth);

      // Mock processSenderKeyDistribution to throw an error
      const processingError = new Error('Failed to process sender key distribution');
      mockSignalService.processSenderKeyDistribution = jest.fn().mockRejectedValue(processingError);

      const senderAddress = 'test-user.1';
      const distributionMessage = new Uint8Array([1, 2, 3, 4]);

      await expect(
        sessionManager.processSenderKeyDistribution(senderAddress, distributionMessage)
      ).rejects.toThrow(
        'Failed to process sender key distribution: Failed to process sender key distribution'
      );

      // Verify the SignalService method was called
      expect(mockSignalService.processSenderKeyDistribution).toHaveBeenCalledWith(
        senderAddress,
        distributionMessage
      );
    });

    it('should handle invalid sender address format during processing', async () => {
      const sessionManager = new SignalSessionManager(mockAuth);

      const distributionMessage = new Uint8Array([1, 2, 3, 4]);

      // This should throw validation error for invalid address format
      await expect(
        sessionManager.processSenderKeyDistribution('invalid-address', distributionMessage)
      ).rejects.toThrow('Invalid address format. Expected: userId.deviceId');
    });
  });

  describe('Dependencies', () => {
    it('should fail when SignalService is not available during sender key creation', () => {
      delete (window as any).SignalService;

      expect(() => {
        new SignalSessionManager(mockAuth);
      }).toThrow('SignalService not available - check script loading order');
    });

    it('should handle SignalService.createSenderKeyDistribution returning null', async () => {
      const sessionManager = new SignalSessionManager(mockAuth);

      // Mock createSenderKeyDistribution to return null
      mockSignalService.createSenderKeyDistribution = jest.fn().mockResolvedValue(null);

      const distributionId = 'test-distribution-id';

      // This should still work (null is a valid return value)
      const result = await sessionManager.createSenderKeyDistribution(distributionId);
      expect(result).toBeNull();

      // Verify the SignalService method was called
      expect(mockSignalService.createSenderKeyDistribution).toHaveBeenCalledWith(distributionId);
    });
  });
});
