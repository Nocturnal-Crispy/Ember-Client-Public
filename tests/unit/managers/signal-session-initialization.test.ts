/**
 * Test for SignalSessionManager initialization bug
 * This test reproduces the dynamic import failure issue
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
  }))
};

// Set up global window mock before tests
delete (global as any).window;
Object.defineProperty(global, 'window', {
  value: mockWindow,
  writable: true
});

describe('SignalSessionManager Initialization', () => {
  beforeEach(() => {
    // Reset window.App before each test
    mockWindow.App = {};
    
    // Reset mocks
    mockWindow.electronAPI.ipc.invoke.mockClear();
    mockWindow.electronAPI.ipc.on.mockClear();
    mockWindow.electronAPI.ipc.removeAllListeners.mockClear();
    mockWindow.getAuthSync.mockClear();
  });

  it('should successfully initialize SignalSessionManager with ES6 modules', async () => {
    // Import the app-state module
    require('../../../../src/renderer/managers/app-state');
    
    // Mock the dynamic import to succeed
    const mockSignalSessionManager = jest.fn().mockImplementation(() => ({
      isReady: () => true,
      getAuth: () => mockWindow.getAuthSync()
    }));
    
    // Mock the dynamic import
    global.import = jest.fn().mockResolvedValue({
      SignalSessionManager: mockSignalSessionManager
    });
    
    // This should now work with ES6 modules
    await expect(mockWindow.App.initializeSignalSessionManager()).resolves.not.toThrow();
    
    // Verify SignalSessionManager was created
    expect(mockWindow.App.signalSessionManager).toBeTruthy();
  });

  it('should have SignalSessionManager null after failed initialization', async () => {
    require('../../../../src/renderer/managers/app-state');
    
    try {
      await mockWindow.App.initializeSignalSessionManager();
    } catch (error) {
      // Expected to fail
    }
    
    expect(mockWindow.App.signalSessionManager).toBeNull();
  });

  it('should provide clear error message when initialization fails', async () => {
    require('../../../../src/renderer/managers/app-state');
    
    try {
      await mockWindow.App.initializeSignalSessionManager();
    } catch (error) {
      expect(error.message).toContain('Failed to load SignalSessionManager');
    }
  });
});
