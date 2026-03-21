/**
 * Unit tests for SignalSessionManager
 *
 * Tests the Signal session management wrapper that provides the interface
 * expected by DirectMessagingManager.
 */

import { SignalSessionManager } from '../../../src/renderer/managers/signal-session-manager';
import { SignalService } from '../../../src/renderer/services/signal-service';

// Mock the SignalService
jest.mock('../../../src/renderer/services/signal-service');
const MockSignalService = SignalService as jest.MockedClass<typeof SignalService>;

// Mock window.emberAPI
const mockEmberAPI = {
  invoke: jest.fn(),
};

// Mock window.electronAPI
const mockElectronAPI = {
  ipc: {
    invoke: jest.fn(),
  },
};

// Setup global mocks
beforeAll(() => {
  (window as any).SignalService = MockSignalService;
  (window as any).emberAPI = mockEmberAPI;
  (window as any).electronAPI = mockElectronAPI;
});

describe('SignalSessionManager', () => {
  let signalSessionManager: SignalSessionManager;
  let mockSignalService: jest.Mocked<SignalService>;
  const mockAuth = {
    token: 'test-token',
    hostname: 'https://test.example.com',
    user_id: 'user-123',
    device_id: 'device-456',
    username: 'testuser',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a mock SignalService instance
    mockSignalService = {
      hasSession: jest.fn(),
      ensureSession: jest.fn(),
      encrypt: jest.fn(),
      decrypt: jest.fn(),
      getLocalDevice: jest.fn(),
      createSenderKeyDistribution: jest.fn(),
      processSenderKeyDistribution: jest.fn(),
      groupEncrypt: jest.fn(),
      groupDecrypt: jest.fn(),
    } as any;

    MockSignalService.mockImplementation(() => mockSignalService);
    
    signalSessionManager = new SignalSessionManager(mockAuth);
  });

  describe('initialization', () => {
    it('should create SignalService with provided auth data', () => {
      expect(MockSignalService).toHaveBeenCalledWith(mockAuth);
    });

    it('should throw error if auth data is missing required fields', () => {
      const invalidAuth = { token: 'test' } as any;
      expect(() => new SignalSessionManager(invalidAuth)).toThrow('Invalid auth data');
    });
  });

  describe('hasSession', () => {
    it('should delegate to SignalService.hasSession', async () => {
      mockSignalService.hasSession.mockResolvedValue(true);
      
      const result = await signalSessionManager.hasSession('user-789', 'device-123');
      
      expect(mockSignalService.hasSession).toHaveBeenCalledWith('user-789', 'device-123');
      expect(result).toBe(true);
    });

    it('should handle errors from SignalService', async () => {
      mockSignalService.hasSession.mockRejectedValue(new Error('IPC error'));
      
      await expect(signalSessionManager.hasSession('user-789', 'device-123'))
        .rejects.toThrow('IPC error');
    });
  });

  describe('ensureSession', () => {
    it('should delegate to SignalService.ensureSession', async () => {
      mockSignalService.ensureSession.mockResolvedValue(undefined);
      
      await signalSessionManager.ensureSession('user-789', 'device-123');
      
      expect(mockSignalService.ensureSession).toHaveBeenCalledWith('user-789', 'device-123');
    });

    it('should handle errors from SignalService', async () => {
      mockSignalService.ensureSession.mockRejectedValue(new Error('Session establishment failed'));
      
      await expect(signalSessionManager.ensureSession('user-789', 'device-123'))
        .rejects.toThrow('Session establishment failed');
    });
  });

  describe('encrypt', () => {
    it('should delegate to SignalService.encrypt', async () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const expectedResult = { 
        ciphertext: new Uint8Array([4, 5, 6]), 
        messageType: 3 
      };
      
      mockSignalService.encrypt.mockResolvedValue(expectedResult);
      
      const result = await signalSessionManager.encrypt('user-789.device-123', plaintext);
      
      expect(mockSignalService.encrypt).toHaveBeenCalledWith('user-789.device-123', plaintext);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('decrypt', () => {
    it('should delegate to SignalService.decrypt', async () => {
      const ciphertext = new Uint8Array([4, 5, 6]);
      const expectedPlaintext = new Uint8Array([1, 2, 3]);
      
      mockSignalService.decrypt.mockResolvedValue(expectedPlaintext);
      
      const result = await signalSessionManager.decrypt('user-789.device-123', ciphertext, 3);
      
      expect(mockSignalService.decrypt).toHaveBeenCalledWith('user-789.device-123', ciphertext, 3);
      expect(result).toEqual(expectedPlaintext);
    });
  });

  describe('groupEncrypt', () => {
    it('should delegate to SignalService.groupEncrypt', async () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const expectedCiphertext = new Uint8Array([4, 5, 6]);
      
      mockSignalService.groupEncrypt.mockResolvedValue(expectedCiphertext);
      
      const result = await signalSessionManager.groupEncrypt('dist-123', plaintext);
      
      expect(mockSignalService.groupEncrypt).toHaveBeenCalledWith('dist-123', plaintext);
      expect(result).toEqual(expectedCiphertext);
    });
  });

  describe('groupDecrypt', () => {
    it('should delegate to SignalService.groupDecrypt', async () => {
      const ciphertext = new Uint8Array([4, 5, 6]);
      const expectedPlaintext = new Uint8Array([1, 2, 3]);
      
      mockSignalService.groupDecrypt.mockResolvedValue(expectedPlaintext);
      
      const result = await signalSessionManager.groupDecrypt('user-789.device-123', ciphertext);
      
      expect(mockSignalService.groupDecrypt).toHaveBeenCalledWith('user-789.device-123', ciphertext);
      expect(result).toEqual(expectedPlaintext);
    });
  });

  describe('createSenderKeyDistribution', () => {
    it('should delegate to SignalService.createSenderKeyDistribution', async () => {
      const expectedDistribution = new Uint8Array([7, 8, 9]);
      
      mockSignalService.createSenderKeyDistribution.mockResolvedValue(expectedDistribution);
      
      const result = await signalSessionManager.createSenderKeyDistribution('dist-123');
      
      expect(mockSignalService.createSenderKeyDistribution).toHaveBeenCalledWith('dist-123');
      expect(result).toEqual(expectedDistribution);
    });
  });

  describe('processSenderKeyDistribution', () => {
    it('should delegate to SignalService.processSenderKeyDistribution', async () => {
      const distributionMessage = new Uint8Array([7, 8, 9]);
      
      mockSignalService.processSenderKeyDistribution.mockResolvedValue(undefined);
      
      await signalSessionManager.processSenderKeyDistribution('user-789.device-123', distributionMessage);
      
      expect(mockSignalService.processSenderKeyDistribution).toHaveBeenCalledWith('user-789.device-123', distributionMessage);
    });
  });

  describe('error handling', () => {
    it('should wrap SignalService errors with context', async () => {
      mockSignalService.hasSession.mockRejectedValue(new Error('IPC connection failed'));
      
      await expect(signalSessionManager.hasSession('user-789', 'device-123'))
        .rejects.toThrow('IPC connection failed');
    });

    it('should handle malformed addresses gracefully', async () => {
      // Test with invalid address format
      await expect(signalSessionManager.encrypt('invalid-address', new Uint8Array([1])))
        .rejects.toThrow();
    });
  });

  describe('lifecycle', () => {
    it('should not throw during creation', () => {
      expect(() => new SignalSessionManager(mockAuth)).not.toThrow();
    });

    it('should maintain reference to SignalService instance', () => {
      expect(signalSessionManager['signalService']).toBe(mockSignalService);
    });
  });
});
