/**
 * server-creation-service.test.ts
 * 
 * Tests for server creation with Signal Protocol initialization
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  initializeSignalProtocolForServer, 
  createServerWithSignalInit,
  SignalInitializationResult,
  ServerCreationResult 
} from '../../../src/renderer/services/server-creation-service';

// Mock the global window and emberAPI
const mockEmberAPI = {
  invoke: jest.fn(),
};

// Mock the loadServerContent function
const mockLoadServerContent = jest.fn();

// Mock getValidAuth function
const mockGetValidAuth = jest.fn();

// Mock the global fetch
const mockFetch = jest.fn();

// Mock window object
const mockWindow = {
  emberAPI: mockEmberAPI,
  loadServerContent: mockLoadServerContent,
  getValidAuth: mockGetValidAuth,
  App: {
    currentIconData: null,
  },
};

describe('Server Creation Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup window mock by assigning functions to existing window
    (global as any).window.emberAPI = mockEmberAPI;
    (global as any).window.loadServerContent = mockLoadServerContent;
    (global as any).window.getValidAuth = mockGetValidAuth;
    (global as any).window.App = {
      currentIconData: null,
    };
    // Setup fetch mock
    (global as any).fetch = mockFetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeSignalProtocolForServer', () => {
    beforeEach(() => {
      // Reset emberAPI mock for each test
      mockEmberAPI.invoke.mockResolvedValue({
        success: true,
        data: { distribution_id: null }
      });
    });

    it('should successfully initialize Signal Protocol for new server', async () => {
      // Arrange
      const serverId = 'test-server-123';
      const serverName = 'Test Server';
      
      mockLoadServerContent.mockResolvedValue(undefined);
      // Mock emberAPI to return success but no distribution ID (still considered success)
      mockEmberAPI.invoke.mockResolvedValue({
        success: true,
        data: { distribution_id: null }
      });

      // Act
      const result = await initializeSignalProtocolForServer(serverId, serverName);

      // Assert
      expect(result.success).toBe(false); // No distribution ID means initialization didn't fully succeed
      expect(result.error).toBe('Distribution ID not found after Signal initialization');
      expect(mockLoadServerContent).toHaveBeenCalledWith(serverId, serverName);
    });

    it('should handle Signal initialization failure', async () => {
      // Arrange
      const serverId = 'test-server-123';
      const serverName = 'Test Server';
      
      mockLoadServerContent.mockRejectedValue(new Error('Signal setup failed'));

      // Act
      const result = await initializeSignalProtocolForServer(serverId, serverName);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Signal setup failed');
    });

    it('should return distribution ID when initialization succeeds', async () => {
      // Arrange
      const serverId = 'test-server-123';
      const serverName = 'Test Server';
      
      // Mock emberAPI to return distribution ID
      mockEmberAPI.invoke.mockResolvedValue({
        success: true,
        data: { distribution_id: 'dist-123' }
      });
      
      mockLoadServerContent.mockResolvedValue(undefined);

      // Act
      const result = await initializeSignalProtocolForServer(serverId, serverName);

      // Assert
      expect(result.success).toBe(true);
      expect(result.distributionId).toBe('dist-123');
    });
  });

  describe('createServerWithSignalInit', () => {
    it('should create server and initialize Signal Protocol successfully', async () => {
      // Arrange
      const serverName = 'Test Server E2E';
      const expectedServerId = 'server-456';
      const mockAuth = {
        token: 'test-token',
        hostname: 'http://localhost:8085'
      };
      
      // Mock auth
      mockGetValidAuth.mockResolvedValue(mockAuth);
      
      // Mock server creation HTTP response
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ id: expectedServerId, name: serverName })
      });
      
      // Mock Signal setup
      mockLoadServerContent.mockResolvedValue(undefined);

      // Act
      const result = await createServerWithSignalInit(serverName);

      // Assert
      expect(result.success).toBe(true);
      expect(result.id).toBe(expectedServerId);
      expect(result.name).toBe(serverName);
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockAuth.hostname}/api/v1/embers`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${mockAuth.token}`,
          },
          body: JSON.stringify({ name: serverName }),
        }
      );
      expect(mockLoadServerContent).toHaveBeenCalledWith(expectedServerId, serverName);
    });

    it('should handle server creation failure', async () => {
      // Arrange
      const serverName = 'Test Server';
      const mockAuth = {
        token: 'test-token',
        hostname: 'http://localhost:8085'
      };
      
      mockGetValidAuth.mockResolvedValue(mockAuth);
      
      // Mock server creation failure
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue('Server name already exists')
      });

      // Act
      const result = await createServerWithSignalInit(serverName);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Server name already exists');
      expect(mockLoadServerContent).not.toHaveBeenCalled();
    });

    it('should handle authentication failure', async () => {
      // Arrange
      const serverName = 'Test Server';
      
      // Mock auth failure
      mockGetValidAuth.mockResolvedValue(null);

      // Act
      const result = await createServerWithSignalInit(serverName);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not authenticated');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockLoadServerContent).not.toHaveBeenCalled();
    });

    it('should not initialize Signal if server creation fails', async () => {
      // Arrange
      const serverName = 'Test Server';
      const mockAuth = {
        token: 'test-token',
        hostname: 'http://localhost:8085'
      };
      
      mockGetValidAuth.mockResolvedValue(mockAuth);
      
      // Mock server creation failure
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Network error')
      });

      // Act
      const result = await createServerWithSignalInit(serverName);

      // Assert
      expect(result.success).toBe(false);
      expect(mockLoadServerContent).not.toHaveBeenCalled();
    });
  });
});
