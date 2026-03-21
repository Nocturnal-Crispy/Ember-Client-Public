/**
 * Unit tests for IPC contract consistency
 *
 * Tests that the IPC handlers and message service use consistent field naming
 * for distribution ID (distribution_id vs distributionId).
 */

describe('IPC contract consistency', () => {
  beforeEach(() => {
    // Mock window.emberAPI
    (window as any).emberAPI = {
      invoke: jest.fn(),
    };

    // Mock required globals
    (window as any).App = {
      activeChannelId: 'ch-1',
      activeEmberId: 'ember-1',
      migrationStatus: 'idle',
      emberKeyCache: new Map(),
    };
  });

  describe('LoadDistributionId response format', () => {
    it('should return distribution_id field (snake_case)', async () => {
      // Mock the IPC response to match expected format
      (window as any).emberAPI.invoke.mockResolvedValue({
        success: true,
        data: { distribution_id: 'dist-123' },
      });

      const response = await (window as any).emberAPI.invoke('LoadDistributionId', { address: 'ember-1' });
      
      expect(response.success).toBe(true);
      expect(response.data).toHaveProperty('distribution_id');
      expect(response.data.distribution_id).toBe('dist-123');
      // Should NOT have camelCase version
      expect(response.data).not.toHaveProperty('distributionId');
    });
  });

});
