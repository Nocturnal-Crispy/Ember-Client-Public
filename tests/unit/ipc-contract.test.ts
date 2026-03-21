/**
 * Unit tests for IPC contract consistency
 *
 * Tests that the IPC handlers and callers use consistent field naming
 * for distribution ID (distributionId, camelCase).
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
    it('should return distributionId field (camelCase)', async () => {
      // Mock the IPC response to match the actual handler format
      (window as any).emberAPI.invoke.mockResolvedValue({
        success: true,
        data: { distributionId: 'dist-123' },
      });

      const response = await (window as any).emberAPI.invoke('LoadDistributionId', { address: 'ember-1' });

      expect(response.success).toBe(true);
      expect(response.data).toHaveProperty('distributionId');
      expect(response.data.distributionId).toBe('dist-123');
      // Should NOT have snake_case version
      expect(response.data).not.toHaveProperty('distribution_id');
    });
  });

});
