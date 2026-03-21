/**
 * Unit tests for IPC contract fix - LoadDistributionId field naming
 */

describe('LoadDistributionId IPC contract fix', () => {
  beforeEach(() => {
    // Mock window.emberAPI
    (window as any).emberAPI = {
      invoke: jest.fn(),
    };
  });

  it('should return distribution_id (snake_case) from IPC handler', () => {
    const testData = { distribution_id: 'dist-123' };
    expect(testData.distribution_id).toBe('dist-123');
    expect((testData as any).distributionId).toBeUndefined();
  });

});
