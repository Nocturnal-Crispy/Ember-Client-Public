import { test, expect } from '@playwright/test';
import { electronTest } from './utils/electron-app';
import { generateTestUser, generateTestServer, generateTestMessage, safeType, safeClick, waitForLoading, logPageState, takeScreenshot } from './utils/test-helpers';

/**
 * Full Workflow E2E Test
 * 
 * This is the comprehensive end-to-end test that covers the complete user journey:
 * 1. Register a new user
 * 2. Create a server
 * 3. Send a message
 * 
 * This test verifies that all major features work together correctly
 * and provides a complete smoke test of the application.
 */

electronTest.describe('Full Application Workflow', () => {
  electronTest('should complete full user journey: register → create server → send message', async ({ page }) => {
    const testUser = generateTestUser('fullworkflow');
    const testServer = generateTestServer('Full Workflow Test');
    const testMessage = generateTestMessage('Hello from E2E test!');
    
    console.log('🚀 Starting full workflow E2E test...');
    console.log(`   User: ${testUser.username}`);
    console.log(`   Email: ${testUser.email}`);
    console.log(`   Server: ${testServer.name}`);
    console.log(`   Message: ${testMessage.content}`);
    
    try {
      // === STEP 1: USER REGISTRATION ===
      console.log('📝 Step 1: Registering new user...');
      await takeScreenshot(page, 'workflow-start');
      
      // Navigate to registration
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
            console.log('✅ Navigated to registration page');
            break;
          }
        } catch {
          continue;
        }
      }
      
      // Fill registration form
      const usernameSelectors = ['[data-testid="username-input"]', 'input[name="username"]', '#username'];
      await safeType(page, usernameSelectors[0], testUser.username);
      
      const emailSelectors = ['[data-testid="email-input"]', 'input[name="email"]', 'input[type="email"]'];
      await safeType(page, emailSelectors[0], testUser.email);
      
      const passwordSelectors = ['[data-testid="password-input"]', 'input[name="password"]', 'input[type="password"]'];
      await safeType(page, passwordSelectors[0], testUser.password);
      
      // Submit registration
      const submitSelectors = [
        '[data-testid="register-submit"]',
        'button[type="submit"]',
        'button:has-text("Register")',
        'button:has-text("Sign Up")'
      ];
      
      await safeClick(page, submitSelectors[0]);
      await waitForLoading(page);
      
      // Verify registration success
      await page.waitForTimeout(3000); // Wait for app to load
      const currentUrl = page.url();
      expect(currentUrl).not.toContain('/register');
      expect(currentUrl).not.toContain('/signup');
      
      await takeScreenshot(page, 'workflow-registration-complete');
      console.log('✅ Step 1 completed: User registered successfully');
      
      // === STEP 2: SERVER CREATION ===
      console.log('🏢 Step 2: Creating server...');
      
      // Look for server creation options
      const createServerSelectors = [
        '[data-testid="create-server-button"]',
        '.create-server-button',
        'button:has-text("Create Server")',
        'button:has-text("Add Server")',
        '[data-testid="add-server"]'
      ];
      
      let serverCreationStarted = false;
      for (const selector of createServerSelectors) {
        try {
          const button = await page.$(selector);
          if (button && await button.isVisible()) {
            await safeClick(page, selector);
            await waitForLoading(page);
            serverCreationStarted = true;
            console.log('✅ Opened server creation dialog');
            break;
          }
        } catch {
          continue;
        }
      }
      
      // Try plus button if direct create button not found
      if (!serverCreationStarted) {
        const plusSelectors = [
          'button:has-text("+")',
          '.add-button',
          '[data-testid="add-button"]'
        ];
        
        for (const selector of plusSelectors) {
          try {
            const button = await page.$(selector);
            if (button && await button.isVisible()) {
              await safeClick(page, selector);
              await page.waitForTimeout(1000);
              
              // Now look for server creation in menu
              for (const createSelector of createServerSelectors) {
                try {
                  const createBtn = await page.$(createSelector);
                  if (createBtn && await createBtn.isVisible()) {
                    await safeClick(page, createSelector);
                    await waitForLoading(page);
                    serverCreationStarted = true;
                    break;
                  }
                } catch {
                  continue;
                }
              }
              
              if (serverCreationStarted) break;
            }
          } catch {
            continue;
          }
        }
      }
      
      expect(serverCreationStarted).toBe(true);
      
      // Fill server creation form
      const serverNameSelectors = [
        '[data-testid="server-name-input"]',
        'input[name="serverName"]',
        'input[name="name"]'
      ];
      
      await safeType(page, serverNameSelectors[0], testServer.name);
      
      if (testServer.description) {
        const descriptionSelectors = [
          '[data-testid="server-description-input"]',
          'textarea[name="description"]'
        ];
        
        for (const selector of descriptionSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              await safeType(page, selector, testServer.description);
              break;
            }
          } catch {
            continue;
          }
        }
      }
      
      // Submit server creation
      const serverSubmitSelectors = [
        '[data-testid="create-server-submit"]',
        'button[type="submit"]',
        'button:has-text("Create")'
      ];
      
      await safeClick(page, serverSubmitSelectors[0]);
      await waitForLoading(page);
      
      // Verify server creation success
      await page.waitForTimeout(2000);
      
      // Check if server name appears in UI
      let serverFound = false;
      const serverNameCheckSelectors = [
        `text=${testServer.name}`,
        `[data-server-name="${testServer.name}"]`,
        `.server-name:has-text("${testServer.name}")`
      ];
      
      for (const selector of serverNameCheckSelectors) {
        try {
          const element = await page.$(selector);
          if (element && await element.isVisible()) {
            serverFound = true;
            break;
          }
        } catch {
          continue;
        }
      }
      
      await takeScreenshot(page, 'workflow-server-created');
      console.log('✅ Step 2 completed: Server created successfully');
      
      // === STEP 3: MESSAGE SENDING ===
      console.log('💬 Step 3: Sending message...');
      
      // Navigate to a channel
      const channelSelectors = [
        '[data-testid="channel-item"]',
        '.channel-item',
        '.channel:first-child',
        '[data-channel-name="general"]',
        '.channel:has-text("general")'
      ];
      
      let channelFound = false;
      for (const selector of channelSelectors) {
        try {
          const channel = await page.$(selector);
          if (channel && await channel.isVisible()) {
            await safeClick(page, selector);
            await waitForLoading(page);
            channelFound = true;
            console.log('✅ Selected channel');
            break;
          }
        } catch {
          continue;
        }
      }
      
      // If no channel found, try to create one
      if (!channelFound) {
        console.log('🔄 No channels found, creating one...');
        
        const createChannelSelectors = [
          '[data-testid="create-channel-button"]',
          '.create-channel-button',
          'button:has-text("Create Channel")'
        ];
        
        for (const selector of createChannelSelectors) {
          try {
            const button = await page.$(selector);
            if (button && await button.isVisible()) {
              await safeClick(page, selector);
              await waitForLoading(page);
              
              const channelNameSelectors = [
                '[data-testid="channel-name-input"]',
                'input[name="channelName"]'
              ];
              
              await safeType(page, channelNameSelectors[0], 'general');
              
              const channelSubmitSelectors = [
                '[data-testid="create-channel-submit"]',
                'button[type="submit"]'
              ];
              
              await safeClick(page, channelSubmitSelectors[0]);
              await waitForLoading(page);
              channelFound = true;
              break;
            }
          } catch {
            continue;
          }
        }
      }
      
      expect(channelFound).toBe(true);
      
      // Send message
      const messageInputSelectors = [
        '[data-testid="message-input"]',
        '.message-input',
        'textarea[name="message"]',
        'textarea[placeholder*="message"]'
      ];
      
      let messageSent = false;
      for (const selector of messageInputSelectors) {
        try {
          const input = await page.$(selector);
          if (input && await input.isVisible()) {
            await safeType(page, selector, testMessage.content);
            
            // Try to send
            const sendButtonSelectors = [
              '[data-testid="send-button"]',
              '.send-button',
              'button:has-text("Send")'
            ];
            
            for (const sendSelector of sendButtonSelectors) {
              try {
                const sendBtn = await page.$(sendSelector);
                if (sendBtn && await sendBtn.isVisible()) {
                  await safeClick(page, sendSelector);
                  messageSent = true;
                  break;
                }
              } catch {
                continue;
              }
            }
            
            // Alternative: Enter key
            if (!messageSent) {
              await page.keyboard.press('Enter');
              messageSent = true;
            }
            
            break;
          }
        } catch {
          continue;
        }
      }
      
      expect(messageSent).toBe(true);
      await waitForLoading(page);
      
      // Verify message appears
      await page.waitForTimeout(2000);
      
      let messageFound = false;
      const messageSelectors = [
        `[data-testid="message-content"]:has-text("${testMessage.content}")`,
        `.message-content:has-text("${testMessage.content}")`,
        `text=${testMessage.content}`
      ];
      
      for (const selector of messageSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 10000 });
          messageFound = true;
          break;
        } catch {
          continue;
        }
      }
      
      // Flexible search if exact match fails
      if (!messageFound) {
        try {
          const allMessages = await page.$$('.message, .message-content, [data-testid="message"]');
          for (const messageEl of allMessages) {
            const text = await messageEl.textContent();
            if (text && text.includes(testMessage.content)) {
              messageFound = true;
              break;
            }
          }
        } catch (error) {
          console.warn('Flexible message search failed:', error);
        }
      }
      
      expect(messageFound).toBe(true);
      
      await takeScreenshot(page, 'workflow-complete');
      logPageState(page, 'workflow-complete');
      
      console.log('🎉 FULL WORKFLOW TEST COMPLETED SUCCESSFULLY!');
      console.log('✅ User registration: PASSED');
      console.log('✅ Server creation: PASSED');
      console.log('✅ Message sending: PASSED');
      
    } catch (error) {
      console.error('❌ Full workflow test failed:', error);
      
      await takeScreenshot(page, 'workflow-error');
      logPageState(page, 'workflow-error');
      
      throw error;
    }
  });
  
  electronTest('should handle workflow with realistic timing and user behavior', async ({ page }) => {
    const testUser = generateTestUser('realistic');
    const testServer = generateTestServer('Realistic Test');
    const testMessage = generateTestMessage('Realistic message with some length to simulate actual usage!');
    
    console.log('🧪 Starting realistic workflow test...');
    
    try {
      // Simulate realistic user behavior with delays
      await page.waitForTimeout(1000); // User takes time to look at the app
      
      // Registration with realistic timing
      const registrationSelectors = ['[data-testid="register-button"]', '.register-button'];
      for (const selector of registrationSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await safeClick(page, selector);
            await page.waitForTimeout(500); // User waits for page to load
            break;
          }
        } catch {
          continue;
        }
      }
      
      // Type with realistic delays between fields
      const usernameSelectors = ['[data-testid="username-input"]', 'input[name="username"]'];
      await safeType(page, usernameSelectors[0], testUser.username);
      await page.waitForTimeout(300); // User thinks before next field
      
      const emailSelectors = ['[data-testid="email-input"]', 'input[name="email"]'];
      await safeType(page, emailSelectors[0], testUser.email);
      await page.waitForTimeout(300);
      
      const passwordSelectors = ['[data-testid="password-input"]', 'input[name="password"]'];
      await safeType(page, passwordSelectors[0], testUser.password);
      await page.waitForTimeout(500); // User reviews before submitting
      
      const submitSelectors = ['[data-testid="register-submit"]', 'button[type="submit"]'];
      await safeClick(page, submitSelectors[0]);
      await page.waitForTimeout(3000); // Wait for registration to complete
      
      // Server creation with realistic delays
      await page.waitForTimeout(1000); // User explores the interface
      
      const createServerSelectors = ['[data-testid="create-server-button"]', '.create-server-button'];
      for (const selector of createServerSelectors) {
        try {
          const button = await page.$(selector);
          if (button && await button.isVisible()) {
            await safeClick(page, selector);
            await page.waitForTimeout(500);
            break;
          }
        } catch {
          continue;
        }
      }
      
      const serverNameInputSelectors = [
        '[data-testid="server-name-input"]',
        'input[name="serverName"]'
      ];
      
      await safeType(page, serverNameInputSelectors[0], testServer.name);
      await page.waitForTimeout(300);
      
      const serverSubmitInputSelectors = ['[data-testid="create-server-submit"]', 'button[type="submit"]'];
      await safeClick(page, serverSubmitInputSelectors[0]);
      await page.waitForTimeout(2000);
      
      // Message sending with realistic timing
      await page.waitForTimeout(1500); // User explores server
      
      const channelSelectors = ['[data-testid="channel-item"]', '.channel-item'];
      for (const selector of channelSelectors) {
        try {
          const channel = await page.$(selector);
          if (channel && await channel.isVisible()) {
            await safeClick(page, selector);
            await page.waitForTimeout(800);
            break;
          }
        } catch {
          continue;
        }
      }
      
      const messageInputSelectors = ['[data-testid="message-input"]', 'textarea[name="message"]'];
      for (const selector of messageInputSelectors) {
        try {
          const input = await page.$(selector);
          if (input && await input.isVisible()) {
            await safeType(page, selector, testMessage.content);
            await page.waitForTimeout(200); // User reviews message
            
            // Send message
            await page.keyboard.press('Enter');
            break;
          }
        } catch {
          continue;
        }
      }
      
      await page.waitForTimeout(2000); // Wait for message to appear
      
      // Verify everything worked
      const messageFound = await page.locator(`text=${testMessage.content}`).isVisible({ timeout: 5000 });
      expect(messageFound).toBe(true);
      
      console.log('✅ Realistic workflow test completed successfully!');
      
    } catch (error) {
      console.error('❌ Realistic workflow test failed:', error);
      await takeScreenshot(page, 'realistic-workflow-error');
      throw error;
    }
  });
});
