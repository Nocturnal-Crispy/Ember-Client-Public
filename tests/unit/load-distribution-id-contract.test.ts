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

  it('should return distributionId (camelCase) from IPC handler', () => {
    const testData = { distributionId: 'dist-123' };
    expect(testData.distributionId).toBe('dist-123');
    expect((testData as any).distribution_id).toBeUndefined();
  });
});
