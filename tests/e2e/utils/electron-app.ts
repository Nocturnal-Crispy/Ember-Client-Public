import { test, ElectronApplication, Page, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Electron App Test Utilities
 * 
 * Provides utilities for launching and managing the Electron application
 * during E2E tests with proper cleanup and isolation.
 */

export interface ElectronAppOptions {
  /** Custom user data directory for test isolation */
  userDataDir?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Command line arguments */
  args?: string[];
}

/**
 * Launches the Electron application for testing
 * 
 * @param options Configuration options for launching the app
 * @returns Promise<ElectronApplication> The launched Electron app
 */
export async function launchElectronApp(options: ElectronAppOptions = {}): Promise<ElectronApplication> {
  const projectRoot = path.resolve(__dirname, '../../../');
  const testDataDir = path.join(projectRoot, 'test-data');
  
  // Create unique user data directory for test isolation
  const testId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  // For now, let's try without custom user data to see if that's the issue
  const userDataDir = options.userDataDir || path.join(testDataDir, `test-user-data-${testId}`);
  
  // Ensure the directory exists
  if (userDataDir && !fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  
  // Path to the electron executable
  const electronExecutable = path.join(projectRoot, 'node_modules/electron/dist/electron');
  
  // Path to the built Electron app main script
  const electronMainPath = path.join(projectRoot, 'dist/main/index.js');
  
  // Verify the built app exists
  if (!fs.existsSync(electronMainPath)) {
    throw new Error(`Built Electron app not found at: ${electronMainPath}. Run 'npm run build' first.`);
  }
  
  console.log(`🚀 Launching Electron app with executable: ${electronExecutable}`);
  console.log(`🚀 Main script: ${electronMainPath}`);
  
  // Launch the Electron app EXACTLY like npm start does
  const electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [
      '.', // Exactly like "electron ."
      `--user-data-dir=${userDataDir}` // Use isolated user data directory for testing
    ],
    cwd: projectRoot, // Set working directory to project root
    env: {
      ...process.env, // Inherit all current environment variables
      E2E_TEST: 'true', // Disable single instance lock for testing
      NODE_ENV: 'test', // Additional test environment indicator
      ...(options.env || {})
    } as Record<string, string>
  });
  
  // Store test metadata for cleanup
  await electronApp.evaluate(({ app }) => {
    // Store test information in the app for debugging
    (app as any).testData = {
      isTestMode: true,
      startTime: new Date().toISOString()
    };
  });
  
  return electronApp;
}

/**
 * Gets the main window page from the Electron app
 * 
 * @param electronApp The Electron application
 * @param timeout Timeout in milliseconds (default: 30 seconds)
 * @returns Promise<Page> The main window page
 */
export async function getMainWindow(electronApp: ElectronApplication, timeout: number = 30000): Promise<Page> {
  console.log('🔍 Looking for Electron windows...');
  
  // Wait for a window to open
  const windows = await electronApp.windows();
  console.log(`📊 Found ${windows.length} windows`);
  
  if (windows.length === 0) {
    console.log('❌ No windows found, waiting for first window...');
    const window = await electronApp.firstWindow({ timeout });
    console.log('✅ First window found');
    return window;
  }
  
  // Use the first available window
  const window = windows[0];
  console.log('✅ Using existing window');
  
  // Wait for the window to be fully loaded
  await window.waitForLoadState('domcontentloaded', { timeout });
  
  // Debug window state
  const url = window.url();
  const title = await window.title();
  console.log(`📍 Window URL: ${url}`);
  console.log(`📝 Window title: ${title}`);
  
  // Wait for the app to be ready - could be login screen or main app
  console.log('⏳ Waiting for app to load...');
  
  // First wait for the URL to change from about:blank to the actual file
  if (url === 'about:blank') {
    console.log('⚠️ Window is still at about:blank, waiting for navigation...');
    
    try {
      await window.waitForFunction(() => {
        return document.location.href !== 'about:blank' && (
          document.location.href.includes('login.html') || 
          document.location.href.includes('index.html')
        );
      }, { timeout: 10000 });
      console.log('✅ App page URL loaded');
    } catch (error) {
      console.log('⚠️ App URL not found, checking current state...');
      const currentUrl = window.url();
      console.log(`📍 Current URL after wait: ${currentUrl}`);
      
      if (currentUrl === 'about:blank') {
        // Try to get page content to debug
        const content = await window.content();
        console.log(`📄 Page content: ${content.substring(0, 200)}...`);
        throw new Error('Electron app failed to navigate to app page');
      }
    }
  }
  
  // Now determine which screen we're on and handle accordingly
  const finalUrl = window.url();
  console.log(`📍 Final window URL: ${finalUrl}`);
  
  if (finalUrl.includes('login.html')) {
    // We're on the login screen - perfect for registration tests
    console.log('✅ Login screen loaded');
    
    // Wait for the login container to appear
    try {
      await window.waitForSelector('.login-container', { timeout: 10000 });
      console.log('✅ Login container found');
    } catch (error) {
      console.log('⚠️ Login container not found, checking for any content...');
      
      // Check if we have any meaningful content
      const content = await window.content();
      console.log(`📄 Window content length: ${content.length} characters`);
      
      if (content.length < 100) {
        throw new Error('Electron app loaded login page but content appears empty');
      }
    }
  } else if (finalUrl.includes('index.html')) {
    // We're on the main app screen - need to logout for registration tests
    console.log('⚠️ Main app loaded - user is already logged in');
    
    // Try to logout if we can find logout controls
    try {
      const logoutSelectors = [
        '[data-testid="logout-button"]',
        '.logout-button',
        '#logout-button',
        'button:has-text("Logout")',
        'button:has-text("Log Out")',
        'a:has-text("Logout")',
        'a:has-text("Log Out")'
      ];
      
      let loggedOut = false;
      for (const selector of logoutSelectors) {
        try {
          const button = await window.$(selector);
          if (button && await button.isVisible()) {
            console.log(`✅ Found logout button: ${selector}`);
            await button.click();
            await window.waitForTimeout(2000); // Wait for logout to process
            loggedOut = true;
            break;
          }
        } catch {
          continue;
        }
      }
      
      if (!loggedOut) {
        console.log('⚠️ Could not find logout button, but continuing with test...');
      }
    } catch (error) {
      console.log('⚠️ Error during logout attempt:', error);
    }
  } else {
    console.log(`📍 Unknown app state: ${finalUrl}`);
  }
  
  return window;
}

/**
 * Waits for the Electron app to be fully ready
 * 
 * @param page The page to wait on
 * @param timeout Timeout in milliseconds
 */
export async function waitForAppReady(page: Page, timeout: number = 30000): Promise<void> {
  // Wait for either the login screen or main app to be ready
  try {
    await Promise.race([
      // Login screen
      page.waitForSelector('[data-testid="login-form"], .login-container, #login-form', { timeout }),
      // Main app (already logged in)
      page.waitForSelector('[data-testid="main-app"], .app-container, #app', { timeout }),
      // Welcome screen
      page.waitForSelector('[data-testid="welcome-screen"], .welcome-container', { timeout })
    ]);
  } catch (error) {
    console.log('⚠️  Could not detect app ready state, proceeding anyway...');
  }
}

/**
 * Cleans up the Electron application and user data
 * 
 * @param electronApp The Electron application to close
 * @param userDataDir Optional user data directory to clean up
 */
export async function cleanupElectronApp(electronApp: ElectronApplication, userDataDir?: string): Promise<void> {
  try {
    // Close the Electron app
    if (electronApp && !electronApp.process().killed) {
      await electronApp.close();
      console.log('✅ Electron app closed');
    }
    
    // Clean up user data directory if specified
    if (userDataDir && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
      console.log(`🗑️  Cleaned up user data: ${userDataDir}`);
    }
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  }
}

/**
 * Test fixture that provides a managed Electron application
 */
export const electronTest = test.extend<{ electronApp: ElectronApplication; page: Page }>({
  electronApp: async ({}, use) => {
    const electronApp = await launchElectronApp();
    await use(electronApp);
    await cleanupElectronApp(electronApp);
  },
  
  page: async ({ electronApp }, use) => {
    const page = await getMainWindow(electronApp);
    await waitForAppReady(page);
    await use(page);
  }
});
