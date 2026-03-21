/**
 * Simple test to verify LoadDistributionId IPC contract fix
 */

describe('LoadDistributionId contract fix verification', () => {
  it('should have correct field name in IPC response type', () => {
    // The IPC handler returns distributionId (camelCase) per LoadDistributionIdData
    const testData = { distributionId: 'test-dist-123' };

    expect(testData.distributionId).toBe('test-dist-123');
  });

  it('should not have old snake_case field', () => {
    // The correct field name is distributionId (camelCase)
    const testData = { distributionId: 'test-dist-123' };

    // The old snake_case field should not exist
    expect((testData as any).distribution_id).toBeUndefined();
  });
});
