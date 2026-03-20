/**
 * Test to verify the require error fix works
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { AuthData } from 'ember-shared';

// Mock the global window object for testing
const mockWindow = {
  App: {} as any,
  electronAPI: {
    ipc: {
      invoke: jest.fn(),
      on: jest.fn(),
      removeAllListeners: jest.fn()
    }
  },
  getAuthSync: jest.fn(() => ({
    token: 'test-token',
    hostname: 'https://test.example.com',
    user_id: 'test-user-id',
    device_id: 'test-device-id',
    username: 'testuser'
  })),
  SignalSessionManager: jest.fn().mockImplementation((auth: AuthData) => ({
    isReady: () => true,
    getAuth: () => auth
  }))
};

// Set up global window mock before tests
delete (global as any).window;
Object.defineProperty(global, 'window', {
  value: mockWindow,
  writable: true
});

describe('App State require fix verification', () => {
  beforeEach(() => {
    // Reset window.App before each test
    mockWindow.App = {};
    
    // Reset mocks
    mockWindow.electronAPI.ipc.invoke.mockClear();
    mockWindow.electronAPI.ipc.on.mockClear();
    mockWindow.electronAPI.ipc.removeAllListeners.mockClear();
    mockWindow.getAuthSync.mockClear();
    mockWindow.SignalSessionManager.mockClear();
  });

  it('should successfully initialize SignalSessionManager using global reference', () => {
    // Import the app-state module
    require('../../../../src/renderer/managers/app-state');
    
    // This should now work without throwing "require is not defined"
    expect(() => {
      mockWindow.App.initializeSignalSessionManager();
    }).not.toThrow('require is not defined');
    
    // Verify SignalSessionManager was called
    expect(mockWindow.SignalSessionManager).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'test-token',
        hostname: 'https://test.example.com',
        user_id: 'test-user-id',
        device_id: 'test-device-id',
        username: 'testuser'
      })
    );
  });

  it('should throw proper error when SignalSessionManager is not available globally', () => {
    require('../../../../src/renderer/managers/app-state');
    
    // Remove SignalSessionManager from global
    delete mockWindow.SignalSessionManager;
    
    expect(() => {
      mockWindow.App.initializeSignalSessionManager();
    }).toThrow('SignalSessionManager not available - ensure signal-session-manager.js is loaded first');
  });
});
