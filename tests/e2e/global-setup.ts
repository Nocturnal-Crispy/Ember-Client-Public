import { chromium, FullConfig } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Global setup for E2E tests
 * 
 * This function runs before all tests and:
 * 1. Ensures the Electron app is built
 * 2. Sets up test data directories
 * 3. Starts any required services
 */
async function globalSetup(config: FullConfig) {
  console.log('🚀 Setting up E2E test environment...');
  
  try {
    // Ensure we're in the right directory
    const projectRoot = path.resolve(__dirname, '../..');
    process.chdir(projectRoot);
    
    // Build the Electron app if not already built
    console.log('📦 Building Electron application...');
    await execAsync('npm run build');
    
    // Ensure test data directories exist
    const testDataDir = path.join(projectRoot, 'test-data');
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
    
    // Clean up any previous test data
    const userDataDirs = fs.readdirSync(testDataDir).filter(dir => 
      dir.startsWith('test-user-data-')
    );
    
    for (const dir of userDataDirs) {
      const fullPath = path.join(testDataDir, dir);
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`🧹 Cleaned up previous test data: ${dir}`);
    }
    
    console.log('✅ E2E test environment ready');
    
  } catch (error) {
    console.error('❌ E2E setup failed:', error);
    throw error;
  }
}

export default globalSetup;
