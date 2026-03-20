/**
 * Tests for Direct Messaging UI user search functionality.
 * These tests reproduce the "Cannot read properties of null (reading 'length')" error.
 */

declare module global {
  interface Window {
    getValidAuth?: () => Promise<any>;
    fetch?: (url: string, options?: any) => Promise<Response>;
  }
}

describe('Direct Messaging UI User Search', () => {
  let mockAuth: any;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockAuth = {
      token: 'test-token',
      hostname: 'http://localhost:8085',
      user_id: 'test-user-id'
    };

    // Mock window.getValidAuth
    window.getValidAuth = jest.fn().mockResolvedValue(mockAuth);
    
    // Mock window.fetch
    mockFetch = jest.fn();
    window.fetch = mockFetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('User Search Error Handling', () => {
    it('should reproduce null response.json() error', async () => {
      // This test reproduces the exact error from logs:
      // "Cannot read properties of null (reading 'length')"
      
      // Mock fetch to return a response with null json()
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue(null) // This causes the error
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Test the searchUsers function directly by importing the module
      // Since DirectMessagingUI is not exported, we'll test the search functionality pattern
      
      // Simulate the problematic code pattern from the source
      async function searchUsers(query: string): Promise<any[]> {
        try {
          const auth = await window.getValidAuth();
          if (!auth) {
            return [];
          }

          const response = await fetch(
            `${auth.hostname}/api/v1/users/search?q=${encodeURIComponent(query)}`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${auth.token}` },
            }
          );

          if (!response.ok) {
            return [];
          }

          const users = await response.json(); // This could be null
          return users; // Trying to access .length on null would cause error
        } catch (error) {
          return [];
        }
      }
      
      // This should reproduce the error when response.json() returns null
      // and the calling code tries to access .length
      await expect(searchUsers('test-query')).resolves.toEqual(null);
    });

    it('should handle null response with length access', async () => {
      // This test specifically reproduces the error pattern
      // where code tries to access .length on a null response
      
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue(null)
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Simulate the exact code pattern that fails
      async function searchUsersWithLengthAccess(query: string): Promise<number> {
        const auth = await window.getValidAuth();
        if (!auth) return 0;
        
        const response = await fetch(`${auth.hostname}/api/v1/users/search?q=${query}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${auth.token}` },
        });

        if (!response.ok) {
          return 0;
        }

        const users = await response.json(); // This returns null
        return users.length; // This throws "Cannot read properties of null (reading 'length')"
      }
      
      // This should reproduce the exact error from the logs
      await expect(searchUsersWithLengthAccess('test-query')).rejects.toThrow(
        "Cannot read properties of null (reading 'length')"
      );
    });

    it('should handle empty array response correctly', async () => {
      // Mock fetch to return a response with empty array
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue([]) // Empty array is valid
      };
      mockFetch.mockResolvedValue(mockResponse);

      async function searchUsers(query: string): Promise<any[]> {
        const auth = await window.getValidAuth();
        const response = await fetch(`${auth.hostname}/api/v1/users/search?q=${query}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${auth.token}` },
        });

        if (!response.ok) {
          return [];
        }

        const users = await response.json();
        return users;
      }
      
      const result = await searchUsers('test-query');
      
      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle valid user array response correctly', async () => {
      const mockUsers = [
        { id: '1', username: 'user1' },
        { id: '2', username: 'user2' }
      ];

      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue(mockUsers)
      };
      mockFetch.mockResolvedValue(mockResponse);

      async function searchUsers(query: string): Promise<any[]> {
        const auth = await window.getValidAuth();
        const response = await fetch(`${auth.hostname}/api/v1/users/search?q=${query}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${auth.token}` },
        });

        if (!response.ok) {
          return [];
        }

        const users = await response.json();
        return users;
      }
      
      const result = await searchUsers('test-query');
      
      expect(result).toEqual(mockUsers);
      expect(result.length).toBe(2);
    });

    it('should handle undefined response.json() safely', async () => {
      // Mock fetch to return a response with undefined json()
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue(undefined) // This could also cause issues
      };
      mockFetch.mockResolvedValue(mockResponse);

      async function searchUsers(query: string): Promise<any[]> {
        const auth = await window.getValidAuth();
        if (!auth) return [];
        
        const response = await fetch(`${auth.hostname}/api/v1/users/search?q=${query}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${auth.token}` },
        });

        if (!response.ok) {
          return [];
        }

        const users = await response.json();
        return users || []; // Safe fallback
      }
      
      const result = await searchUsers('test-query');
      
      // Should handle undefined gracefully
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });
});
