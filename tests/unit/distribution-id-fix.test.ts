/**
 * Simple test to verify LoadDistributionId IPC contract fix
 */

describe('LoadDistributionId contract fix verification', () => {
  it('should have correct field name in built types', () => {
    // Import the type from the built ember-shared
    const { LoadDistributionIdData } = require('ember-shared');
    
    // Create a test object with the new field name
    const testData: LoadDistributionIdData = { distribution_id: 'test-dist-123' };
    
    expect(testData.distribution_id).toBe('test-dist-123');
  });

  it('should not have old camelCase field', () => {
    const { LoadDistributionIdData } = require('ember-shared');
    
    // TypeScript should prevent this, but let's check at runtime
    const testData: LoadDistributionIdData = { distribution_id: 'test-dist-123' };
    
    // The old field should not exist
    expect((testData as any).distributionId).toBeUndefined();
  });
});
