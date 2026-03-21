import { Page } from '@playwright/test';

/**
 * Test Helper Utilities
 * 
 * Common helper functions used across E2E tests for interacting
 * with the Ember application UI.
 */

export interface TestUser {
  username: string;
  email: string;
  password: string;
}

export interface TestServer {
  name: string;
  description?: string;
}

export interface TestMessage {
  content: string;
  channel?: string;
}

/**
 * Generates test user data
 * 
 * @param prefix Optional prefix for the username
 * @returns TestUser Generated test user data
 */
export function generateTestUser(prefix: string = 'testuser'): TestUser {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 3); // Shorter random part
  
  return {
    username: `${prefix}${random}`, // 3-20 characters: prefix (8) + random (3) = 11 chars
    email: `${prefix}-${timestamp}-${random}@test.com`,
    password: 'TestPassword123!'
  };
}

/**
 * Generates test server data
 * 
 * @param prefix Optional prefix for the server name
 * @returns TestServer Generated test server data
 */
export function generateTestServer(prefix: string = 'Test Server'): TestServer {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 5);
  
  return {
    name: `${prefix} ${timestamp}-${random}`,
    description: `Test server created at ${new Date().toISOString()}`
  };
}

/**
 * Generates test message data
 * 
 * @param prefix Optional prefix for the message content
 * @returns TestMessage Generated test message data
 */
export function generateTestMessage(prefix: string = 'Test message'): TestMessage {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 5);
  
  return {
    content: `${prefix} ${timestamp}-${random}`,
    channel: 'general'
  };
}

/**
 * Ensures the app is on the login screen and ready for registration
 * 
 * @param page The page to check/prepare
 * @returns Promise<void>
 */
export async function ensureLoginScreen(page: Page): Promise<void> {
  console.log('🔍 Ensuring login screen is ready...');
  
  // Check if we're on the main app (index.html) and need to logout
  const currentUrl = page.url();
  console.log(`📍 Current URL: ${currentUrl}`);
  
  if (currentUrl.includes('index.html')) {
    console.log('⚠️ On main app screen, attempting to logout...');
    
    // Try to find and click logout button
    const logoutSelectors = [
      '[data-testid="logout-button"]',
      '.logout-button',
      '#logout-button',
      'button:has-text("Logout")',
      'button:has-text("Log Out")',
      'a:has-text("Logout")',
      'a:has-text("Log Out")'
    ];
    
    for (const selector of logoutSelectors) {
      try {
        const button = await page.$(selector);
        if (button && await button.isVisible()) {
          console.log(`✅ Found logout button: ${selector}`);
          await button.click();
          await page.waitForTimeout(2000);
          break;
        }
      } catch {
        continue;
      }
    }
    
    // Wait for navigation to login screen
    try {
      await page.waitForFunction(() => {
        return document.location.href.includes('login.html');
      }, { timeout: 5000 });
      console.log('✅ Successfully logged out and redirected to login');
    } catch {
      console.log('⚠️ Could not confirm logout redirect');
    }
  }
  
  // Wait for login container to be ready
  try {
    await page.waitForSelector('.login-container', { timeout: 10000 });
    console.log('✅ Login container is ready');
  } catch (error) {
    console.log('⚠️ Login container not found, checking page state...');
    const content = await page.content();
    console.log(`📄 Page content length: ${content.length} characters`);
    
    if (content.length < 100) {
      throw new Error('Login screen not properly loaded');
    }
  }
}

/**
 * Waits for and finds an element by multiple possible selectors
 * 
 * @param page The page to search on
 * @param selectors Array of possible selectors to try
 * @param timeout Timeout in milliseconds
 * @returns Promise<HTMLElement> The found element
 */
export async function waitForSelector(page: Page, selectors: string[], timeout: number = 10000): Promise<any> {
  const errors: Error[] = [];
  
  for (const selector of selectors) {
    try {
      return await page.waitForSelector(selector, { timeout: 2000 });
    } catch (error) {
      errors.push(error as Error);
      continue;
    }
  }
  
  throw new Error(`None of the selectors ${JSON.stringify(selectors)} were found. Errors: ${errors.map(e => e.message).join(', ')}`);
}

/**
 * Safely types text into an input field
 * 
 * @param page The page containing the input
 * @param selector Selector for the input field
 * @param text Text to type
 * @param clearFirst Whether to clear the field first
 */
export async function safeType(page: Page, selector: string, text: string, clearFirst: boolean = true): Promise<void> {
  try {
    const element = await waitForSelector(page, [selector]);
    
    if (clearFirst) {
      await element.fill(''); // Clear the field using fill with empty string
    }
    
    await element.fill(text);
    await page.waitForTimeout(100); // Small delay to ensure the text is registered
  } catch (error) {
    throw new Error(`Failed to type text into ${selector}: ${error}`);
  }
}

/**
 * Safely clicks a button or clickable element
 * 
 * @param page The page containing the element
 * @param selector Selector for the clickable element
 * @param waitForNavigation Whether to wait for navigation after click
 */
export async function safeClick(page: Page, selector: string, waitForNavigation: boolean = false): Promise<void> {
  try {
    const element = await waitForSelector(page, [selector]);
    
    // Ensure the element is visible and clickable
    await element.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200); // Wait for any animations
    
    if (waitForNavigation) {
      await Promise.all([
        page.waitForNavigation({ timeout: 10000 }),
        element.click()
      ]);
    } else {
      await element.click();
    }
    
    await page.waitForTimeout(200); // Small delay to ensure the click is processed
  } catch (error) {
    throw new Error(`Failed to click ${selector}: ${error}`);
  }
}

/**
 * Checks if an element exists on the page
 * 
 * @param page The page to check
 * @param selector Selector for the element
 * @returns boolean Whether the element exists
 */
export async function elementExists(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Takes a screenshot with a descriptive filename
 * 
 * @param page The page to screenshot
 * @param name Descriptive name for the screenshot
 * @param fullPage Whether to take a full page screenshot
 */
export async function takeScreenshot(page: Page, name: string, fullPage: boolean = true): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${name}-${timestamp}.png`;
  
  // Ensure screenshots directory exists
  const screenshotDir = 'test-results/screenshots';
  
  try {
    await page.screenshot({ 
      path: `${screenshotDir}/${filename}`, 
      fullPage 
    });
    console.log(`📸 Screenshot saved: ${filename}`);
  } catch (error) {
    console.warn(`Failed to take screenshot ${filename}:`, error);
  }
}

/**
 * Logs debug information about the current page state
 * 
 * @param page The page to analyze
 * @param context Context for the log message
 */
export async function logPageState(page: Page, context: string): Promise<void> {
  try {
    const url = page.url();
    const title = await page.title();
    
    console.log(`🔍 Page state [${context}]:`);
    console.log(`   URL: ${url}`);
    console.log(`   Title: ${title}`);
    
    // Check for common error indicators
    const errorSelectors = [
      '.error-message',
      '[data-testid="error"]',
      '.error',
      '[role="alert"]'
    ];
    
    for (const selector of errorSelectors) {
      if (await elementExists(page, selector)) {
        const errorText = await page.textContent(selector);
        console.warn(`   ⚠️  Error found (${selector}): ${errorText}`);
      }
    }
    
  } catch (error) {
    console.warn(`Failed to log page state for ${context}:`, error);
  }
}

/**
 * Waits for a loading state to complete
 * 
 * @param page The page to wait on
 * @param timeout Timeout in milliseconds
 */
export async function waitForLoading(page: Page, timeout: number = 30000): Promise<void> {
  try {
    // Wait for common loading indicators to disappear
    const loadingSelectors = [
      '.loading',
      '[data-testid="loading"]',
      '.spinner',
      '[data-testid="spinner"]'
    ];
    
    for (const selector of loadingSelectors) {
      try {
        await page.waitForSelector(selector, { state: 'hidden', timeout: 2000 });
      } catch {
        // Loading indicator might not exist, that's fine
      }
    }
    
    // Additional wait to ensure any async operations complete
    await page.waitForTimeout(1000);
    
  } catch (error) {
    console.warn('Loading state detection failed, proceeding anyway:', error);
  }
}
