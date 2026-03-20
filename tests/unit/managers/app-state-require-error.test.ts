/**
 * Test for app-state require error bug
 * This test reproduces the ReferenceError: require is not defined issue
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

describe('App State initializeSignalSessionManager', () => {
  beforeEach(() => {
    // Reset window.App before each test
    mockWindow.App = {};
    
    // Reset mocks
    mockWindow.electronAPI.ipc.invoke.mockClear();
    mockWindow.electronAPI.ipc.on.mockClear();
    mockWindow.electronAPI.ipc.removeAllListeners.mockClear();
    mockWindow.getAuthSync.mockClear();
  });

  it('should throw ReferenceError when using require in renderer context', () => {
    // Import the app-state module
    require('../../../../src/renderer/managers/app-state');
    
    // This should throw ReferenceError: require is not defined
    expect(() => {
      mockWindow.App.initializeSignalSessionManager();
    }).toThrow('require is not defined');
  });

  it('should have proper auth validation', () => {
    require('../../../../src/renderer/managers/app-state');
    
    // Test with missing auth
    mockWindow.getAuthSync.mockReturnValue(null as any);
    
    expect(() => {
      mockWindow.App.initializeSignalSessionManager();
    }).toThrow('Not authenticated - cannot initialize SignalSessionManager');
  });

  it('should validate electronAPI availability', () => {
    require('../../../../src/renderer/managers/app-state');
    
    // Test with missing electronAPI
    (mockWindow as any).electronAPI = null;
    
    expect(() => {
      mockWindow.App.initializeSignalSessionManager();
    }).toThrow('electronAPI not available');
  });
});
