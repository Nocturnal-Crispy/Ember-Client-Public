/**
 * Tests for sender key setup failures.
 * These tests reproduce the "Failed to create sender key distribution" error.
 */

// Mock global window objects
declare global {
  interface Window {
    emberAPI?: any;
    getValidAuth?: any;
    electronAPI?: any;
  }
}

describe('Sender Key Setup', () => {
  let mockEmberAPI: any;

  beforeEach(() => {
    // Mock emberAPI
    mockEmberAPI = {
      invoke: jest.fn(),
    };
    window.emberAPI = mockEmberAPI;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Reproduce the exact function logic from ember-manager.ts
  async function createSenderKeyForEmber(
    emberId: string
  ): Promise<{ distributionId: string; distributionMessage: string }> {
    const distributionId = await loadOrCreateDistributionId(emberId);
    const response = await window.emberAPI!.invoke<{ distributionMessage: string }>(
      'CreateSenderKeyDistribution',
      { distributionId }
    );
    if (!response.success || !response.data?.distributionMessage) {
      throw new Error('Failed to create sender key distribution');
    }
    return {
      distributionId,
      distributionMessage: response.data.distributionMessage,
    };
  }

  async function loadOrCreateDistributionId(emberId: string): Promise<string> {
    const response = await window.emberAPI!.invoke<{ distributionId: string }>(
      'LoadOrCreateDistributionId',
      { emberId }
    );
    if (!response.success || !response.data?.distributionId) {
      throw new Error('Failed to load or create distribution ID');
    }
    return response.data.distributionId;
  }

  describe('Sender Key Distribution Creation Failures', () => {
    it('should reproduce sender key setup failure when CreateSenderKeyDistribution fails', async () => {
      const emberId = 'test-ember-id';

      // Mock the API calls
      mockEmberAPI.invoke
        .mockResolvedValueOnce({ success: true, data: { distributionId: 'test-dist-id' } }) // loadOrCreateDistributionId
        .mockResolvedValueOnce({ success: false, data: null }); // CreateSenderKeyDistribution fails

      // This should throw the error
      await expect(createSenderKeyForEmber(emberId)).rejects.toThrow(
        'Failed to create sender key distribution'
      );
    });

    it('should reproduce sender key setup failure when CreateSenderKeyDistribution returns no distribution message', async () => {
      const emberId = 'test-ember-id';

      // Mock the API calls
      mockEmberAPI.invoke
        .mockResolvedValueOnce({ success: true, data: { distributionId: 'test-dist-id' } }) // loadOrCreateDistributionId
        .mockResolvedValueOnce({ success: true, data: null }); // CreateSenderKeyDistribution succeeds but no message

      // This should throw the error
      await expect(createSenderKeyForEmber(emberId)).rejects.toThrow(
        'Failed to create sender key distribution'
      );
    });

    it('should reproduce sender key setup failure when CreateSenderKeyDistribution throws error', async () => {
      const emberId = 'test-ember-id';

      // Mock the API calls
      mockEmberAPI.invoke
        .mockResolvedValueOnce({ success: true, data: { distributionId: 'test-dist-id' } }) // loadOrCreateDistributionId
        .mockRejectedValueOnce(new Error('IPC call failed')); // CreateSenderKeyDistribution throws

      // This should throw the error
      await expect(createSenderKeyForEmber(emberId)).rejects.toThrow('IPC call failed');
    });

    it('should reproduce sender key setup failure when loadOrCreateDistributionId fails', async () => {
      const emberId = 'test-ember-id';

      // Mock the API call to fail at the first step
      mockEmberAPI.invoke.mockResolvedValueOnce({ success: false, data: null }); // loadOrCreateDistributionId fails

      // This should throw the error
      await expect(createSenderKeyForEmber(emberId)).rejects.toThrow(
        'Failed to load or create distribution ID'
      );
    });
  });

  describe('Success Cases', () => {
    it('should successfully create sender key distribution when all API calls succeed', async () => {
      const emberId = 'test-ember-id';

      // Mock successful API calls
      mockEmberAPI.invoke
        .mockResolvedValueOnce({ success: true, data: { distributionId: 'test-dist-id' } }) // loadOrCreateDistributionId
        .mockResolvedValueOnce({ success: true, data: { distributionMessage: 'test-message' } }); // CreateSenderKeyDistribution succeeds

      const result = await createSenderKeyForEmber(emberId);

      expect(result).toEqual({
        distributionId: 'test-dist-id',
        distributionMessage: 'test-message',
      });
    });
  });

  describe('Error Handling in initializeEmber', () => {
    it('should demonstrate the error handling pattern used in initializeEmber', async () => {
      const emberId = 'test-ember-id';
      const mockLog = {
        warn: jest.fn(),
      };

      // Mock the API calls to fail sender key creation
      mockEmberAPI.invoke
        .mockResolvedValueOnce({ success: true, data: { distributionId: 'test-dist-id' } }) // loadOrCreateDistributionId
        .mockResolvedValueOnce({ success: false, data: null }); // CreateSenderKeyDistribution fails

      // Simulate the error handling pattern from initializeEmber
      try {
        await createSenderKeyForEmber(emberId);
        // If this succeeds, the test should fail
        expect(true).toBe(false);
      } catch (skErr) {
        // This is the expected behavior - error should be caught and logged as warning
        expect(skErr).toBeInstanceOf(Error);
        expect((skErr as Error).message).toBe('Failed to create sender key distribution');

        // Simulate the warning log that would occur
        mockLog.warn('Sender key setup deferred', {
          ember_id: emberId,
          error: (skErr as Error).message,
        });

        expect(mockLog.warn).toHaveBeenCalledWith('Sender key setup deferred', {
          ember_id: emberId,
          error: 'Failed to create sender key distribution',
        });
      }
    });
  });
});
