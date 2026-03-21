import { FullConfig } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Global teardown for E2E tests
 * 
 * This function runs after all tests and:
 * 1. Cleans up test data directories
 * 2. Shuts down any services
 * 3. Generates final reports
 */
async function globalTeardown(config: FullConfig) {
  console.log('🧹 Cleaning up E2E test environment...');
  
  try {
    const projectRoot = path.resolve(__dirname, '../..');
    const testDataDir = path.join(projectRoot, 'test-data');
    
    // Clean up test data directories
    if (fs.existsSync(testDataDir)) {
      const userDataDirs = fs.readdirSync(testDataDir).filter(dir => 
        dir.startsWith('test-user-data-')
      );
      
      for (const dir of userDataDirs) {
        const fullPath = path.join(testDataDir, dir);
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`🗑️  Cleaned up test data: ${dir}`);
      }
    }
    
    console.log('✅ E2E test environment cleaned up');
    
  } catch (error) {
    console.error('❌ E2E teardown failed:', error);
    throw error;
  }
}

export default globalTeardown;
