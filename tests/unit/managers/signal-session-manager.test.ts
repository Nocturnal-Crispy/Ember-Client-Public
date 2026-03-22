/**
 * Unit tests for SignalSessionManager
 *
 * Tests the Signal session management wrapper that provides the interface
 * expected by DirectMessagingManager.
 *
 * SignalSessionManager is a non-module renderer script (no `export`).
 * We set up window mocks, require() the file to execute it, then access
 * the class via window.SignalSessionManager.
 */

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

// Mock SignalService constructor
const MockSignalService = jest.fn();

// Mock emberLog
const mockEmberLog = {
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

// Setup global mocks BEFORE loading the module
beforeAll(() => {
  (window as any).SignalService = MockSignalService;
  (window as any).emberAPI = mockEmberAPI;
  (window as any).electronAPI = mockElectronAPI;
  (window as any).emberLog = mockEmberLog;

  // Load the module — this sets window.SignalSessionManager
  require('../../../src/renderer/managers/signal-session-manager');
});

// Get the class from window (set by the script's global export)
function getSSMClass(): any {
  return (window as any).SignalSessionManager;
}

describe('SignalSessionManager', () => {
  let signalSessionManager: any;
  let mockSignalService: any;
  const mockAuth = {
    token: 'test-token',
    hostname: 'https://test.example.com',
    userId: 'user-123',
    deviceId: 'device-456',
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
    };

    MockSignalService.mockImplementation(() => mockSignalService);

    const SSMClass = getSSMClass();
    signalSessionManager = new SSMClass(mockAuth);
  });

  describe('initialization', () => {
    it('should create SignalService with provided auth data', () => {
      expect(MockSignalService).toHaveBeenCalledWith(mockAuth);
    });

    it('should throw error if auth data is missing required fields', () => {
      const SSMClass = getSSMClass();
      expect(() => new SSMClass({ token: 'test' })).toThrow('Invalid auth data');
    });

    it('should throw error if auth data is null', () => {
      const SSMClass = getSSMClass();
      expect(() => new SSMClass(null)).toThrow('Invalid auth data');
    });

    it('should throw error if hostname is not a valid URL', () => {
      const SSMClass = getSSMClass();
      expect(
        () =>
          new SSMClass({
            ...mockAuth,
            hostname: 'not-a-valid-url',
          })
      ).toThrow('Invalid auth data: hostname must be a valid URL');
    });
  });

  describe('hasSession', () => {
    it('should call SignalService.hasSession with correct params', async () => {
      mockSignalService.hasSession.mockResolvedValue(true);
      const result = await signalSessionManager.hasSession('user-1', 'device-1');
      expect(result).toBe(true);
      expect(mockSignalService.hasSession).toHaveBeenCalledWith('user-1', 'device-1');
    });

    it('should throw if userId or deviceId is missing', async () => {
      await expect(signalSessionManager.hasSession('', 'device-1')).rejects.toThrow(
        'userId and deviceId are required'
      );
    });
  });

  describe('ensureSession', () => {
    it('should call SignalService.ensureSession with correct params', async () => {
      mockSignalService.ensureSession.mockResolvedValue(undefined);
      await signalSessionManager.ensureSession('user-1', 'device-1');
      expect(mockSignalService.ensureSession).toHaveBeenCalledWith('user-1', 'device-1');
    });
  });

  describe('encrypt', () => {
    it('should call SignalService.encrypt with correct params', async () => {
      const mockResult = { ciphertext: new Uint8Array([1, 2, 3]), messageType: 3 };
      mockSignalService.encrypt.mockResolvedValue(mockResult);

      const result = await signalSessionManager.encrypt(
        'user-1.device-1',
        new Uint8Array([4, 5, 6])
      );

      expect(result).toEqual(mockResult);
      expect(mockSignalService.encrypt).toHaveBeenCalledWith(
        'user-1.device-1',
        new Uint8Array([4, 5, 6])
      );
    });

    it('should throw if address format is invalid', async () => {
      await expect(
        signalSessionManager.encrypt('invalid-address', new Uint8Array([1]))
      ).rejects.toThrow('Invalid address format');
    });
  });

  describe('decrypt', () => {
    it('should call SignalService.decrypt with correct params', async () => {
      const mockPlaintext = new Uint8Array([7, 8, 9]);
      mockSignalService.decrypt.mockResolvedValue(mockPlaintext);

      const result = await signalSessionManager.decrypt(
        'user-1.device-1',
        new Uint8Array([1, 2]),
        3
      );

      expect(result).toEqual(mockPlaintext);
    });
  });

  describe('groupEncrypt', () => {
    it('should call SignalService.groupEncrypt', async () => {
      const mockCiphertext = new Uint8Array([10, 11, 12]);
      mockSignalService.groupEncrypt.mockResolvedValue(mockCiphertext);

      const result = await signalSessionManager.groupEncrypt('dist-1', new Uint8Array([1, 2, 3]));
      expect(result).toEqual(mockCiphertext);
    });

    it('should throw if groupEncrypt returns null', async () => {
      mockSignalService.groupEncrypt.mockResolvedValue(null);
      await expect(
        signalSessionManager.groupEncrypt('dist-1', new Uint8Array([1]))
      ).rejects.toThrow('Encryption unavailable');
    });
  });

  describe('groupDecrypt', () => {
    it('should call SignalService.groupDecrypt', async () => {
      const mockPlaintext = new Uint8Array([13, 14]);
      mockSignalService.groupDecrypt.mockResolvedValue(mockPlaintext);

      const result = await signalSessionManager.groupDecrypt(
        'user-1.device-1',
        new Uint8Array([1, 2])
      );
      expect(result).toEqual(mockPlaintext);
    });
  });

  describe('getAuth', () => {
    it('should return a copy of auth data', () => {
      const auth = signalSessionManager.getAuth();
      expect(auth).toEqual(mockAuth);
      expect(auth).not.toBe(mockAuth); // Should be a copy
    });
  });

  describe('isReady', () => {
    it('should return true when initialized', () => {
      expect(signalSessionManager.isReady()).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should set isInitialized to false', () => {
      signalSessionManager.destroy();
      expect(signalSessionManager.isReady()).toBe(false);
    });
  });
});
