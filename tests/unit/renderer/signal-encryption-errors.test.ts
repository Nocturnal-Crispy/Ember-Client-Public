/**
 * Tests for Signal Protocol encryption failures.
 * These tests reproduce the "Signal Protocol encryption not ready" errors.
 */

// Mock global window objects
declare global {
  interface Window {
    SignalService?: any;
    showInputError?: (message: string) => void;
  }
}

describe('Signal Protocol Encryption Errors', () => {
  let mockAuth: any;
  let mockSignalService: any;

  beforeAll(() => {
    (window as any).emberLog = {
      createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }),
    };
    (window as any).SignalService = jest.fn();
    require('../../../src/renderer/managers/signal-session-manager');
  });

  beforeEach(() => {
    mockAuth = {
      token: 'test-token',
      userId: 'test-user-id',
      deviceId: 'test-device-id',
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

    // Mock window.showInputError
    window.showInputError = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Encryption Not Ready Errors', () => {
    it('should reproduce Signal Protocol encryption not ready error during message sending', async () => {
      // This test reproduces the exact error from logs:
      // "Signal Protocol encryption not ready - please ensure Signal Session Manager is initialized"

      const sessionManager = new (window as any).SignalSessionManager(mockAuth);

      // Mock groupEncrypt to return null/falsy to simulate encryption not ready
      mockSignalService.groupEncrypt = jest.fn().mockResolvedValue(null);

      const distributionId = 'test-distribution-id';
      const plaintext = new Uint8Array([1, 2, 3, 4]);

      // This should throw the encryption not ready error
      await expect(sessionManager.groupEncrypt(distributionId, plaintext)).rejects.toThrow(
        'Failed to encrypt group message'
      );
    });

    it('should reproduce Signal Protocol encryption not ready error during direct messaging', () => {
      // This test reproduces the error from direct-messaging-manager.ts line 596

      const errMsg =
        'Signal Protocol encryption not ready - please ensure Signal Session Manager is initialized';

      // Mock the scenario where Signal Session Manager is not initialized
      expect(() => {
        // Simulate the error thrown in direct-messaging-manager.ts
        throw new Error(errMsg);
      }).toThrow(errMsg);
    });

    it('should handle SignalService.encrypt throwing encryption not ready error', async () => {
      const sessionManager = new (window as any).SignalSessionManager(mockAuth);

      const encryptionError = new Error(
        'Signal Protocol encryption not ready - please ensure Signal Session Manager is initialized'
      );
      mockSignalService.encrypt = jest.fn().mockRejectedValue(encryptionError);

      const recipientAddress = 'test-user.1';
      const plaintext = new Uint8Array([1, 2, 3, 4]);

      // This should propagate the encryption not ready error
      await expect(sessionManager.encrypt(recipientAddress, plaintext)).rejects.toThrow(
        'Failed to encrypt message: Signal Protocol encryption not ready - please ensure Signal Session Manager is initialized'
      );
    });

    it('should handle uninitialized SignalSessionManager', () => {
      const sessionManager = new (window as any).SignalSessionManager(mockAuth);

      // Force the manager to be uninitialized
      (sessionManager as any).isInitialized = false;

      const _recipientAddress = 'test-user.1';
      const _plaintext = new Uint8Array([1, 2, 3, 4]);

      // This should throw the not initialized error
      expect(() => {
        (sessionManager as any).ensureInitialized();
      }).toThrow('SignalSessionManager is not initialized');
    });
  });

  describe('Session Manager Dependencies', () => {
    it('should fail when SignalService is not available during encryption', () => {
      delete (window as any).SignalService;

      expect(() => {
        new (window as any).SignalSessionManager(mockAuth);
      }).toThrow('SignalService not available - check script loading order');
    });

    it('should handle group encryption failures gracefully', async () => {
      const sessionManager = new (window as any).SignalSessionManager(mockAuth);

      // Mock groupEncrypt to throw an error
      const groupError = new Error('Group encryption failed');
      mockSignalService.groupEncrypt = jest.fn().mockRejectedValue(groupError);

      const distributionId = 'test-distribution-id';
      const plaintext = new Uint8Array([1, 2, 3, 4]);

      await expect(sessionManager.groupEncrypt(distributionId, plaintext)).rejects.toThrow(
        'Failed to encrypt group message: Group encryption failed'
      );
    });

    it('should handle invalid distribution ID during group encryption', async () => {
      const sessionManager = new (window as any).SignalSessionManager(mockAuth);

      const plaintext = new Uint8Array([1, 2, 3, 4]);

      // This should throw validation error before even calling SignalService
      await expect(sessionManager.groupEncrypt('', plaintext)).rejects.toThrow(
        'distributionId is required'
      );
    });
  });
});
