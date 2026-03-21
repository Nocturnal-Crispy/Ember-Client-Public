import { test, expect } from '@playwright/test';
import { electronTest } from './utils/electron-app';
import { 
  takeScreenshot, 
  logPageState, 
  safeClick, 
  safeType, 
  waitForLoading,
  ensureLoginScreen
} from './utils/test-helpers';
import { TEST_USER, TEST_SERVER, TEST_TIMEOUTS, TEST_SELECTORS } from './test-constants';

/**
 * Registration Test Suite
 * 
 * This test suite handles user registration and must run successfully
 * before any other E2E tests that depend on a registered user.
 * 
 * The test creates a new user account and handles the save code page
 * that appears after successful registration.
 */
electronTest.describe.serial('User Registration', () => {
  
  electronTest('should register a new user successfully', async ({ page }) => {
    // Check if user is already registered by attempting to login first
    console.log('🔍 Checking if test user already exists...');
    
    // Ensure we're on the login screen
    await ensureLoginScreen(page);
    
    // Try to login with existing credentials
    const usernameField = await page.$(TEST_SELECTORS.USERNAME_FIELD);
    if (usernameField) {
      await usernameField.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.keyboard.type(TEST_USER.username);
    }
    
    const hostnameField = await page.$(TEST_SELECTORS.HOSTNAME_FIELD);
    if (hostnameField) {
      await hostnameField.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.keyboard.type(TEST_SERVER.hostname);
    }
    
    const passwordField = await page.$(TEST_SELECTORS.PASSWORD_FIELD);
    if (passwordField) {
      await passwordField.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.keyboard.type(TEST_USER.password);
    }
    
    // Submit login form
    await safeClick(page, TEST_SELECTORS.SUBMIT_BUTTON);
    
    // Wait a bit to see if login succeeds
    await page.waitForTimeout(3000);
    
    // Check if login was successful (we're in main app)
    const loginSuccess = await page.evaluate(() => {
      return document.location.href.includes('index.html') || 
             document.querySelector('.app-container') !== null ||
             document.querySelector('[data-testid="main-app"]') !== null;
    });
    
    if (loginSuccess) {
      console.log('✅ Test user already exists and login successful');
      // Mark registration as complete since user exists
      await page.evaluate(() => {
        window.localStorage.setItem('test-registration-complete', 'true');
      });
      test.skip(true, 'Test user already exists. Skipping registration.');
    }
    
    // If we get here, login failed, user probably doesn't exist, continue with registration
    console.log('ℹ️ Test user does not exist or login failed, proceeding with registration');
    // Go back to login screen if needed
    await ensureLoginScreen(page);
    
    // Use defined test user credentials
    console.log(`   Username: ${TEST_USER.username}`);
    console.log(`   Email: ${TEST_USER.email}`);
    
    // Ensure we're on the login screen before proceeding
    await ensureLoginScreen(page);
    
    // Take initial screenshot
    await takeScreenshot(page, 'registration-start');
    
    // Wait for the page to actually load content
    console.log('⏳ Waiting for page content to load...');
    await page.waitForTimeout(3000); // Give the app time to initialize
    
    // Check if we have actual content loaded
    const pageContent = await page.content();
    console.log(`📄 Page content length: ${pageContent.length} characters`);
    
    // Look for login form specifically
    const loginForm = await page.$('.login-container');
    if (!loginForm) {
      console.log('❌ Login container not found, page may not have loaded properly');
      await takeScreenshot(page, 'login-not-loaded');
      logPageState(page, 'login-not-loaded');
      throw new Error('Login form did not load properly');
    }
    
    console.log('✅ Login container found, proceeding with test...');
    
    try {
      // Step 1: Check if we're already in registration mode or need to switch
      logPageState(page, 'initial-state');
      
      // Check if we're already in registration mode by looking for confirm password field
      const confirmPasswordVisible = await page.$('#confirm-password') !== null;
      const submitButtonText = await page.$eval('#submit-btn-text', el => el.textContent).catch(() => 'Login');
      
      console.log(`📝 Submit button text: "${submitButtonText}"`);
      console.log(`📝 Confirm password field visible: ${confirmPasswordVisible}`);
      
      if (!confirmPasswordVisible || submitButtonText === 'Login') {
        // Need to switch to registration mode
        console.log('🔄 Switching to registration mode...');
        
        // Look for registration button or link
        const registrationSelectors = [
          '#toggle-mode', // Your actual register button ID
          'button#toggle-mode',
          '.link-btn#toggle-mode',
          'button:has-text("Register")',
          'a:has-text("Register")',
          'button:has-text("Sign Up")',
          'a:has-text("Sign Up")'
        ];
        
        let registrationClicked = false;
        for (const selector of registrationSelectors) {
          try {
            const button = await page.$(selector);
            if (button && await button.isVisible()) {
              console.log(`✅ Found registration button: ${selector}`);
              await safeClick(page, selector);
              await waitForLoading(page);
              registrationClicked = true;
              break;
            }
          } catch {
            continue;
          }
        }
        
        if (!registrationClicked) {
          console.log('⚠️ Could not find registration button, assuming already in registration mode');
        }
      } else {
        console.log('✅ Already in registration mode');
      }
      
      // Take screenshot after navigation
      await takeScreenshot(page, 'registration-page-loaded');
      logPageState(page, 'registration-page');
      
      // Step 2: Fill out the registration form
      console.log('📝 Filling out registration form...');
      
      // Username field
      const usernameSelectors = [
        '#username', // Your actual username input ID
        'input#username',
        'input[name="username"]',
        'input[placeholder*="username"]',
        'input[placeholder*="Username"]'
      ];
      
      await safeType(page, usernameSelectors[0], TEST_USER.username);
      console.log(`✅ Username entered: ${TEST_USER.username}`);
      
      // Email field - Note: Your form doesn't have email, it has hostname instead
      const hostnameSelectors = [
        '#hostname', // Your actual hostname input ID
        'input#hostname',
        'input[name="hostname"]',
        'input[placeholder*="hostname"]',
        'input[placeholder*="ember"]'
      ];
      
      await safeType(page, hostnameSelectors[0], TEST_SERVER.hostname);
      console.log(`✅ Hostname entered: ${TEST_SERVER.hostname}`);
      
      // Password field
      const passwordSelectors = [
        '#password', // Your actual password input ID
        'input#password',
        'input[name="password"]',
        'input[type="password"]',
        'input[placeholder*="password"]'
      ];
      
      await safeType(page, passwordSelectors[0], TEST_USER.password);
      console.log('✅ Password entered');
      
      // Confirm password field (only visible in registration mode)
      const confirmPasswordSelectors = [
        '#confirm-password', // Your actual confirm password ID
        'input#confirm-password',
        'input[name="confirmPassword"]',
        'input[name="confirm_password"]',
        'input[placeholder*="confirm"]'
      ];
      
      // Wait for confirm password field to be visible (it's hidden in login mode)
      await page.waitForTimeout(1000);
      
      for (const selector of confirmPasswordSelectors) {
        try {
          const element = await page.$(selector);
          if (element && await element.isVisible()) {
            await safeType(page, selector, TEST_USER.password);
            console.log(`✅ Confirm password entered`);
            break;
          }
        } catch {
          continue;
        }
      }
      
      // Take screenshot before submission
      await takeScreenshot(page, 'registration-form-filled');
      
      // Step 3: Submit the registration form
      console.log('🚀 Submitting registration form...');
      
      const submitSelectors = [
        '#submit-btn', // Your actual submit button ID
        'button#submit-btn',
        '.submit-btn',
        'button[type="submit"]',
        'button:has-text("Register")',
        'input[type="submit"]'
      ];
      
      await safeClick(page, submitSelectors[0]);
      await waitForLoading(page);
      
      // Take screenshot after submission
      await takeScreenshot(page, 'registration-submitted');
      
      // Step 4: Handle the save code page that appears after successful registration
      console.log('🔍 Checking for save code page...');
      
      // Wait a bit for the save code page to appear
      await page.waitForTimeout(2000);
      
      // Check if we're on the save code page
      const saveCodeSelectors = [
        '[data-testid="recovery-code"]',
        '.recovery-code',
        '#recovery-code',
        '[data-testid="save-code"]',
        '.save-code',
        '#save-code',
        'h1:has-text("Save Your Recovery Code")',
        'h2:has-text("Recovery Code")',
        'h1:has-text("Recovery Code")',
        '.code-display',
        '[data-testid="code-display"]'
      ];
      
      let onSaveCodePage = false;
      for (const selector of saveCodeSelectors) {
        try {
          const element = await page.$(selector);
          if (element && await element.isVisible()) {
            console.log(`✅ Found save code element: ${selector}`);
            onSaveCodePage = true;
            break;
          }
        } catch {
          continue;
        }
      }
      
      if (onSaveCodePage) {
        console.log('✅ Successfully registered - on save code page');
        await takeScreenshot(page, 'save-code-page');
        
        // Look for a "continue" or "done" button on the save code page
        const continueSelectors = [
          'button:has-text("I\'ve Saved My Code")',  // Actual button text
          'button:has-text("I\'ve Saved My Code")',  // Alternative quote handling
          'button:has-text("Continue")',            // Fallback
          'button[type="submit"]',                   // Any submit button
          '.btn-primary',                            // Common primary button class
          '.btn',                                    // Any button
          'button',                                  // Fallback to any button
          '[data-testid="continue-button"]',
          '.continue-button',
          '#continue-button',
          'button:has-text("Done")',
          'button:has-text("I Saved It")',
          'button:has-text("Next")',
          '[data-testid="done-button"]',
          '.done-button'
        ];
        
        let continueClicked = false;
        for (const selector of continueSelectors) {
          try {
            const button = await page.$(selector);
            if (button && await button.isVisible()) {
              console.log(`✅ Found continue button: ${selector}`);
              console.log(`🖱️ Attempting to click continue button: ${selector}`);
              await safeClick(page, selector);
              console.log(`✅ Successfully clicked continue button: ${selector}`);
              await waitForLoading(page);
              continueClicked = true;
              console.log(`✅ Continue button click completed`);
              break;
            }
          } catch (error) {
            console.log(`❌ Failed to click continue button ${selector}: ${error}`);
            continue;
          }
        }
        
        if (!continueClicked) {
          console.log('⚠️ Could not find continue button, but registration succeeded');
        }
        
        // Wait for navigation to main app (page might close/navigate)
        console.log('⏳ Waiting for navigation after continue button click...');
        try {
          await page.waitForTimeout(2000);
        } catch (error) {
          console.log('ℹ️ Page context destroyed during navigation (expected behavior)');
          // The page context was destroyed, which is normal after successful navigation
        }
      } else {
        console.log('⚠️ Save code page not found, checking if we went straight to main app...');
      }
      
      // Step 5: Verify we're now in the main app (not registration form anymore)
      console.log('🔍 Verifying we reached the main app...');
      
      const finalSubmitButtonText = await page.$eval('#submit-btn-text', el => el.textContent).catch(() => '');
      const stillOnRegistration = finalSubmitButtonText === 'Register';
      
      if (stillOnRegistration) {
        console.log('⚠️ Still on registration form, checking for errors...');
        
        // Check for error messages
        const errorSelectors = [
          '#error-banner:not(.hidden)',
          '.error-message:not(:empty)',
          '.error-banner:not(.hidden)',
          '[data-testid="error-message"]'
        ];
        
        let errorMessage = '';
        for (const selector of errorSelectors) {
          try {
            const errorElement = await page.$(selector);
            if (errorElement) {
              errorMessage = await errorElement.textContent() || '';
              if (errorMessage.trim()) {
                console.log(`❌ Registration failed with error: ${errorMessage}`);
                break;
              }
            }
          } catch {
            continue;
          }
        }
        
        // Take screenshot to see what's happening
        await takeScreenshot(page, 'registration-failed');
        
        if (!errorMessage) {
          console.log('❌ Registration failed but no error message visible');
        }
        
        throw new Error(`Registration failed${errorMessage ? ': ' + errorMessage : ' (no error message visible)'}`);
      }
      
      // Look for success indicators - we should be in the main app now
      const successSelectors = [
        // Main app indicators
        '[data-testid="main-app"]',
        '.app-container',
        '#app',
        '.server-list',
        '[data-testid="server-list"]',
        '.channel-list',
        '[data-testid="channel-list"]',
        // Or back to login (if the app logs out after registration)
        '#submit-btn-text:has-text("Login")',
        'form#auth-form:has(button:has-text("Login"))'
      ];
      
      let successFound = false;
      for (const selector of successSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          console.log(`✅ Registration success indicator found: ${selector}`);
          successFound = true;
          break;
        } catch {
          continue;
        }
      }
      
      if (!successFound) {
        // Take final screenshot to debug
        await takeScreenshot(page, 'registration-unknown-state');
        const finalPageState = await page.url();
        console.log(`❌ Unable to verify registration success. Final URL: ${finalPageState}`);
        throw new Error('Registration verification failed - unable to confirm successful registration');
      }
      
      console.log('🎉 User registration test completed successfully!');
      
      // Take final screenshot
      await takeScreenshot(page, 'registration-success');
      logPageState(page, 'registration-success');
      
      // Mark registration as successful for dependent tests
      await page.evaluate(() => {
        window.localStorage.setItem('test-registration-complete', 'true');
      });
      
    } catch (error) {
      console.error('❌ User registration test failed:', error);
      await takeScreenshot(page, 'registration-error');
      logPageState(page, 'registration-error');
      throw error;
    }
  });
});
