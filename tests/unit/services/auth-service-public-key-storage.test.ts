/**
 * TDD: auth-service.ts public key storage during registration — RED phase
 * 
 * Tests for CRITICAL-03: IpcIdentityKeyStore.getIdentityKeyPair() returns privateKey: new Uint8Array(0)
 * 
 * The issue is that during registration, only the private key is stored in safeStorage, but the public key
 * is not stored separately. This causes getIdentityKeyPair() to fail because it can't find the public key.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

describe('auth-service.ts public key storage during registration', () => {
  let mockIpcRenderer: any;
  let mockElectronAPI: any;
  let mockAuthService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock ipcRenderer
    mockIpcRenderer = {
      invoke: jest.fn(),
    };

    // Mock electronAPI with complete structure
    mockElectronAPI = {
      ipc: mockIpcRenderer,
      authService: {
        register: jest.fn(),
        login: jest.fn(),
      },
      crypto: {
        generateEmberKey: jest.fn(),
        encryptEmberKeyForUser: jest.fn(),
        decryptEmberKeyForUser: jest.fn(),
        encryptMessage: jest.fn(),
        decryptMessage: jest.fn(),
      },
    };

    // Set up global window object BEFORE loading the module
    (global as any).window = {
      electronAPI: mockElectronAPI,
      emberLog: {
        createLogger: () => ({
          info: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
          warn: jest.fn(),
        }),
      },
    };

    // Mock other required globals
    (global as any).Buffer = Buffer;
    (global as any).btoa = (str: string) => Buffer.from(str).toString('base64');
  });

  it('should store public key in safeStorage during successful registration', async () => {
    // Mock successful registration response
    const mockAuthResponse = {
      token: 'test-token',
      user_id: 'user-123',
      device_id: 'device-123',
      username: 'testuser',
    };

    mockElectronAPI.authService.register.mockResolvedValue(mockAuthResponse);

    // Mock the Signal identity generation that happens during registration
    const mockSignalIdentity = {
      identityKeyPair: {
        publicKey: new Uint8Array([1, 2, 3, 4]), // Mock public key
        privateKey: new Uint8Array([5, 6, 7, 8]), // Mock private key
      },
      registrationId: 12345,
    };

    // Load the auth-service module (this will trigger the registration flow)
    require('../../../src/renderer/services/auth-service');

    // Simulate the registration success callback that stores keys in safeStorage
    // This is where the current implementation stores ONLY the private key
    const privateKeyBase64 = Buffer.from(mockSignalIdentity.identityKeyPair.privateKey).toString('base64');
    
    // Current implementation: Only stores private key
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('set-safe-storage', {
      key: 'identity_key_user-123_device-123',
      value: privateKeyBase64,
    });

    // This test demonstrates the BUG: public key is NOT stored
    // The implementation should also store the public key, but it doesn't
    const publicKeyBase64 = Buffer.from(mockSignalIdentity.identityKeyPair.publicKey).toString('base64');
    
    // This call should exist but doesn't (RED phase - failing test)
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('set-safe-storage', {
      key: 'identity_pubkey_user-123_device-123',
      value: publicKeyBase64,
    });
  });

  it('should store both private and public keys with correct key format', async () => {
    // Mock successful registration response
    const mockAuthResponse = {
      token: 'test-token',
      user_id: 'user-456',
      device_id: 'device-456',
      username: 'testuser2',
    };

    mockElectronAPI.authService.register.mockResolvedValue(mockAuthResponse);

    // Mock Signal identity
    const mockSignalIdentity = {
      identityKeyPair: {
        publicKey: new Uint8Array([10, 20, 30, 40, 50]),
        privateKey: new Uint8Array([60, 70, 80, 90, 100]),
      },
      registrationId: 54321,
    };

    // Load the auth-service module
    require('../../../src/renderer/services/auth-service');

    // Verify the key naming pattern is correct
    const privateKeyBase64 = Buffer.from(mockSignalIdentity.identityKeyPair.privateKey).toString('base64');
    const publicKeyBase64 = Buffer.from(mockSignalIdentity.identityKeyPair.publicKey).toString('base64');

    // Current implementation stores private key correctly
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('set-safe-storage', {
      key: 'identity_key_user-456_device-456',
      value: privateKeyBase64,
    });

    // BUG: Public key storage is missing
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('set-safe-storage', {
      key: 'identity_pubkey_user-456_device-456',
      value: publicKeyBase64,
    });
  });

  it('should continue registration even if safeStorage storage fails', async () => {
    // Mock successful registration response
    const mockAuthResponse = {
      token: 'test-token',
      user_id: 'user-789',
      device_id: 'device-789',
      username: 'testuser3',
    };

    mockElectronAPI.authService.register.mockResolvedValue(mockAuthResponse);

    // Mock safeStorage failure
    mockIpcRenderer.invoke.mockRejectedValue(new Error('Storage failed'));

    // Load the auth-service module
    require('../../../src/renderer/services/auth-service');

    // Registration should still succeed despite storage failure
    expect(mockElectronAPI.authService.register).toHaveBeenCalled();
    // The error should be caught and logged, but not throw
  });
});
