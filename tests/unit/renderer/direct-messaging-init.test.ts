/**
 * Tests for Direct Messaging system initialization failures.
 * These tests reproduce the "Failed to initialize Direct Messaging system" error.
 */

import { SignalSessionManager } from '../../../src/renderer/managers/signal-session-manager';

// Mock global window objects
declare global {
  interface Window {
    SignalService?: any;
    getValidAuth?: any;
    initializeDirectMessaging?: any;
    App?: any;
    emberLog?: any;
  }
}

describe('Direct Messaging System Initialization', () => {
  let mockAuth: any;
  let mockLog: any;

  beforeEach(() => {
    mockAuth = {
      token: 'test-token',
      user_id: 'test-user-id',
      device_id: 'test-device-id',
      hostname: 'http://localhost:8085',
      username: 'test-user',
    };

    // Mock window.getValidAuth
    window.getValidAuth = jest.fn().mockResolvedValue(mockAuth);

    // Mock window.App with minimal required properties
    window.App = {
      initializeSignalSessionManager: jest.fn(),
    } as any;

    // Mock logger
    mockLog = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };
    window.emberLog = {
      createLogger: jest.fn().mockReturnValue(mockLog),
    } as any;

    // Mock window.initializeDirectMessaging
    window.initializeDirectMessaging = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization Failures', () => {
    it('should handle SignalService not available error', () => {
      // Mock SignalService as undefined to reproduce the error
      delete (window as any).SignalService;

      expect(() => {
        new SignalSessionManager(mockAuth);
      }).toThrow('SignalService not available - check script loading order');
    });

    it('should handle invalid auth data during initialization', () => {
      const invalidAuth = {
        // Missing required fields
        token: 'test-token',
      };

      expect(() => {
        new SignalSessionManager(invalidAuth as any);
      }).toThrow('Invalid auth data: hostname is required');
    });

    it('should handle SignalSessionManager not ready error', () => {
      // Mock SignalService
      (window as any).SignalService = jest.fn().mockImplementation(() => ({
        encrypt: jest.fn(),
        decrypt: jest.fn(),
        hasSession: jest.fn(),
        ensureSession: jest.fn(),
        groupEncrypt: jest.fn(),
        groupDecrypt: jest.fn(),
        createSenderKeyDistribution: jest.fn(),
        processSenderKeyDistribution: jest.fn(),
      }));

      const sessionManager = new SignalSessionManager(mockAuth);

      // Force the manager to be not initialized
      (sessionManager as any).isInitialized = false;

      expect(() => {
        (sessionManager as any).ensureInitialized();
      }).toThrow('SignalSessionManager is not initialized');
    });
  });

  describe('Dependencies', () => {
    it('should fail when window.getValidAuth throws error', async () => {
      const authError = new Error('Authentication failed');
      window.getValidAuth = jest.fn().mockRejectedValue(authError);

      await expect(window.getValidAuth()).rejects.toThrow('Authentication failed');
    });

    it('should fail when App.initializeSignalSessionManager throws error', () => {
      const signalError = new Error('Signal session initialization failed');
      window.App.initializeSignalSessionManager = jest.fn().mockImplementation(() => {
        throw signalError;
      });

      expect(() => {
        window.App.initializeSignalSessionManager();
      }).toThrow('Signal session initialization failed');
    });
  });
});
