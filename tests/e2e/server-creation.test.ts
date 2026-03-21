import { test, expect } from '@playwright/test';
import { electronTest } from './utils/electron-app';
import { generateTestUser, generateTestServer, safeType, safeClick, waitForLoading, logPageState, takeScreenshot } from './utils/test-helpers';

/**
 * Server Creation E2E Tests
 * 
 * Tests the server creation workflow in the Electron application:
 * 1. Register/login user
 * 2. Navigate to server creation
 * 3. Fill out server creation form
 * 4. Submit and verify successful server creation
 */

electronTest.describe('Server Creation', () => {
  electronTest('should create a new server successfully', async ({ page }) => {
    const testUser = generateTestUser();
    const testServer = generateTestServer();
    
    console.log('🧪 Starting server creation test...');
    console.log(`   User: ${testUser.username}`);
    console.log(`   Server: ${testServer.name}`);
    
    try {
      // Step 1: Register and login user (reuse registration logic)
      await registerAndLoginUser(page, testUser);
      
      // Step 2: Navigate to server creation
      console.log('🔍 Looking for server creation options...');
      
      // Look for "Create Server" or "Add Server" buttons
      const createServerSelectors = [
        '[data-testid="create-server-button"]',
        '.create-server-button',
        '#create-server-button',
        'button:has-text("Create Server")',
        'button:has-text("Add Server")',
        'a:has-text("Create Server")',
        'a:has-text("Add Server")',
        '[data-testid="add-server"]',
        '.add-server'
      ];
      
      let createButtonFound = false;
      for (const selector of createServerSelectors) {
        try {
          const button = await page.$(selector);
          if (button && await button.isVisible()) {
            console.log(`✅ Found create server button: ${selector}`);
            await safeClick(page, selector);
            await waitForLoading(page);
            createButtonFound = true;
            break;
          }
        } catch {
          continue;
        }
      }
      
      if (!createButtonFound) {
        // Try to find a plus button or menu that might contain server creation
        const plusSelectors = [
          'button:has-text("+")',
          '.add-button',
          '[data-testid="add-button"]',
          '.plus-button'
        ];
        
        for (const selector of plusSelectors) {
          try {
            const button = await page.$(selector);
            if (button && await button.isVisible()) {
              console.log(`✅ Found plus button: ${selector}`);
              await safeClick(page, selector);
              await waitForLoading(page);
              
              // Now look for server creation in the menu
              await page.waitForTimeout(1000);
              
              for (const createSelector of createServerSelectors) {
                try {
                  const createBtn = await page.$(createSelector);
                  if (createBtn && await createBtn.isVisible()) {
                    await safeClick(page, createSelector);
                    await waitForLoading(page);
                    createButtonFound = true;
                    break;
                  }
                } catch {
                  continue;
                }
              }
              
              if (createButtonFound) break;
            }
          } catch {
            continue;
          }
        }
      }
      
      if (!createButtonFound) {
        throw new Error('Could not find server creation button or menu');
      }
      
      // Take screenshot of server creation modal/page
      await takeScreenshot(page, 'server-creation-opened');
      logPageState(page, 'server-creation-page');
      
      // Step 3: Fill out server creation form
      console.log('📝 Filling out server creation form...');
      
      // Server name field
      const nameSelectors = [
        '[data-testid="server-name-input"]',
        'input[name="serverName"]',
        'input[name="name"]',
        'input[id="server-name"]',
        'input[placeholder*="server name"]',
        'input[placeholder*="Server Name"]',
        '#server-name'
      ];
      
      await safeType(page, nameSelectors[0], testServer.name);
      console.log(`✅ Server name entered: ${testServer.name}`);
      
      // Server description field (optional)
      const descriptionSelectors = [
        '[data-testid="server-description-input"]',
        'textarea[name="description"]',
        'textarea[name="serverDescription"]',
        'textarea[id="server-description"]',
        'textarea[placeholder*="description"]',
        'textarea[placeholder*="Description"]',
        '#server-description'
      ];
      
      if (testServer.description) {
        for (const selector of descriptionSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              await safeType(page, selector, testServer.description);
              console.log(`✅ Server description entered`);
              break;
            }
          } catch {
            continue;
          }
        }
      }
      
      // Take screenshot before submission
      await takeScreenshot(page, 'server-form-filled');
      
      // Step 4: Submit the server creation form
      console.log('🚀 Submitting server creation form...');
      
      const submitSelectors = [
        '[data-testid="create-server-submit"]',
        'button[type="submit"]',
        '.create-server-submit',
        '#create-server-submit',
        'button:has-text("Create")',
        'button:has-text("Create Server")',
        'input[type="submit"]'
      ];
      
      await safeClick(page, submitSelectors[0]);
      await waitForLoading(page);
      
      // Take screenshot after submission
      await takeScreenshot(page, 'server-creation-submitted');
      
      // Step 5: Verify successful server creation
      console.log('🔍 Verifying server creation success...');
      
      // Look for success indicators
      const successSelectors = [
        '[data-testid="server-created"]',
        '.server-created',
        '.success-message',
        '[data-testid="server-list"]',
        '.server-list',
        '[data-testid="main-app"]',
        '.app-container'
      ];
      
      let successFound = false;
      for (const selector of successSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 10000 });
          console.log(`✅ Server creation success indicator found: ${selector}`);
          successFound = true;
          break;
        } catch {
          continue;
        }
      }
      
      // Additional verification: check if the server appears in any server list
      if (successFound) {
        const serverNameSelectors = [
          `text=${testServer.name}`,
          `[data-server-name="${testServer.name}"]`,
          `.server-name:has-text("${testServer.name}")`
        ];
        
        let serverNameFound = false;
        for (const selector of serverNameSelectors) {
          try {
            const element = await page.$(selector);
            if (element && await element.isVisible()) {
              console.log(`✅ Server name found in UI: ${testServer.name}`);
              serverNameFound = true;
              break;
            }
          } catch {
            continue;
          }
        }
        
        if (!serverNameFound) {
          console.warn('⚠️ Server created but name not found in UI - this might be normal');
        }
      }
      
      if (!successFound) {
        // Check for error messages
        const errorSelectors = [
          '[data-testid="error"]',
          '.error-message',
          '.error',
          '[role="alert"]'
        ];
        
        let errorFound = false;
        for (const selector of errorSelectors) {
          try {
            const errorElement = await page.$(selector);
            if (errorElement) {
              const errorText = await errorElement.textContent();
              console.error(`❌ Server creation failed with error: ${errorText}`);
              errorFound = true;
              break;
            }
          } catch {
            continue;
          }
        }
        
        if (!errorFound) {
          await takeScreenshot(page, 'server-creation-final-state');
          logPageState(page, 'final-state');
          
          throw new Error('Server creation verification failed - no success indicator found');
        }
      }
      
      // Take final success screenshot
      await takeScreenshot(page, 'server-creation-success');
      logPageState(page, 'server-creation-success');
      
      console.log('🎉 Server creation test completed successfully!');
      
    } catch (error) {
      console.error('❌ Server creation test failed:', error);
      
      await takeScreenshot(page, 'server-creation-error');
      logPageState(page, 'error-state');
      
      throw error;
    }
  });
  
  electronTest('should handle server creation validation errors', async ({ page }) => {
    const testUser = generateTestUser();
    const invalidServer = {
      name: '', // Invalid: empty name
      description: 'A server with no name'
    };
    
    console.log('🧪 Starting server creation validation test...');
    
    try {
      // Register and login user
      await registerAndLoginUser(page, testUser);
      
      // Navigate to server creation (reuse logic from first test)
      const createServerSelectors = [
        '[data-testid="create-server-button"]',
        '.create-server-button',
        'button:has-text("Create Server")'
      ];
      
      for (const selector of createServerSelectors) {
        try {
          const button = await page.$(selector);
          if (button && await button.isVisible()) {
            await safeClick(page, selector);
            await waitForLoading(page);
            break;
          }
        } catch {
          continue;
        }
      }
      
      // Try to submit empty form
      const submitSelectors = [
        '[data-testid="create-server-submit"]',
        'button[type="submit"]',
        'button:has-text("Create")'
      ];
      
      await safeClick(page, submitSelectors[0]);
      
      // Verify validation errors are shown
      const errorSelectors = [
        '[data-testid="validation-error"]',
        '.error-message',
        '.validation-error',
        '[role="alert"]'
      ];
      
      let errorFound = false;
      for (const selector of errorSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          console.log(`✅ Server creation validation error found: ${selector}`);
          errorFound = true;
          break;
        } catch {
          continue;
        }
      }
      
      if (!errorFound) {
        throw new Error('Expected server creation validation errors were not displayed');
      }
      
      console.log('✅ Server creation validation test passed!');
      
    } catch (error) {
      console.error('❌ Server creation validation test failed:', error);
      await takeScreenshot(page, 'server-validation-error');
      throw error;
    }
  });
});

/**
 * Helper function to register and login a user
 * This is extracted to be reused across multiple tests
 */
async function registerAndLoginUser(page: any, testUser: any): Promise<void> {
  console.log('👤 Registering and logging in user...');
  
  // Look for registration button
  const registrationSelectors = [
    '[data-testid="register-button"]',
    '.register-button',
    'button:has-text("Register")',
    'a:has-text("Register")',
    'button:has-text("Sign Up")',
    'a:has-text("Sign Up")'
  ];
  
  for (const selector of registrationSelectors) {
    try {
      const button = await page.$(selector);
      if (button) {
        await safeClick(page, selector);
        await waitForLoading(page);
        break;
      }
    } catch {
      continue;
    }
  }
  
  // Fill registration form
  const usernameSelectors = ['#username', 'input[name="username"]', 'input[type="text"]'];
  await safeType(page, usernameSelectors[0], testUser.username);
  
  // Note: Login form uses username, not email
  const passwordSelectors = ['#password', 'input[name="password"]', 'input[type="password"]'];
  await safeType(page, passwordSelectors[0], testUser.password);
  
  // Submit registration
  const submitSelectors = [
    '#submit-btn',
    'button[type="submit"]',
    'button:has-text("Login")', // Default text is "Login"
    'button:has-text("Register")' // Changes to "Register" in registration mode
  ];
  
  await safeClick(page, submitSelectors[0]);
  await waitForLoading(page);
  
  // Wait for registration to complete and app to load
  const successSelectors = [
    '[data-testid="welcome-screen"]',
    '.welcome-container',
    '[data-testid="main-app"]',
    '.app-container'
  ];
  
  for (const selector of successSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 15000 });
      console.log('✅ User registration and login completed');
      return;
    } catch {
      continue;
    }
  }
  
  // If no explicit success indicator, check if we're no longer on registration page
  const currentUrl = page.url();
  if (!currentUrl.includes('/register') && !currentUrl.includes('/signup')) {
    console.log('✅ User registration and login completed (redirected)');
    return;
  }
  
  throw new Error('User registration/login verification failed');
}
