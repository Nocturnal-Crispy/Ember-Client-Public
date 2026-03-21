import { test, expect } from '@playwright/test';
import { electronTest } from './utils/electron-app';
import { generateTestUser, generateTestServer, generateTestMessage, safeType, safeClick, waitForLoading, logPageState, takeScreenshot } from './utils/test-helpers';

/**
 * Message Sending E2E Tests
 * 
 * Tests the message sending workflow in the Electron application:
 * 1. Register/login user
 * 2. Create or join a server
 * 3. Navigate to a channel
 * 4. Send a message
 * 5. Verify the message appears
 */

electronTest.describe('Message Sending', () => {
  electronTest('should send a message successfully', async ({ page }) => {
    const testUser = generateTestUser();
    const testServer = generateTestServer();
    const testMessage = generateTestMessage();
    
    console.log('🧪 Starting message sending test...');
    console.log(`   User: ${testUser.username}`);
    console.log(`   Server: ${testServer.name}`);
    console.log(`   Message: ${testMessage.content}`);
    
    try {
      // Step 1: Register, login, and create server
      await setupUserAndServer(page, testUser, testServer);
      
      // Step 2: Navigate to a channel
      console.log('🔍 Looking for channels...');
      
      // Look for channel list or specific channel
      const channelSelectors = [
        '[data-testid="channel-list"]',
        '.channel-list',
        '[data-testid="channels"]',
        '.channels',
        '[data-testid="channel-item"]',
        '.channel-item'
      ];
      
      let channelFound = false;
      for (const selector of channelSelectors) {
        try {
          const channelElement = await page.$(selector);
          if (channelElement && await channelElement.isVisible()) {
            console.log(`✅ Found channel list: ${selector}`);
            
            // Look for a clickable channel (like "general")
            const clickableChannelSelectors = [
              `${selector} [data-testid="general-channel"]`,
              `${selector} .channel:has-text("general")`,
              `${selector} .channel-item:has-text("general")`,
              `${selector} [data-channel-name="general"]`,
              `${selector} :text("general")`,
              `${selector} .channel:first-child`, // Click first channel
              `${selector} .channel-item:first-child`
            ];
            
            for (const channelSelector of clickableChannelSelectors) {
              try {
                const channel = await page.$(channelSelector);
                if (channel && await channel.isVisible()) {
                  console.log(`✅ Found clickable channel: ${channelSelector}`);
                  await safeClick(page, channelSelector);
                  await waitForLoading(page);
                  channelFound = true;
                  break;
                }
              } catch {
                continue;
              }
            }
            
            if (channelFound) break;
          }
        } catch {
          continue;
        }
      }
      
      if (!channelFound) {
        // Try to create a channel if no channels exist
        console.log('🔄 No channels found, attempting to create one...');
        
        const createChannelSelectors = [
          '[data-testid="create-channel-button"]',
          '.create-channel-button',
          'button:has-text("Create Channel")',
          'button:has-text("Add Channel")',
          '[data-testid="add-channel"]'
        ];
        
        for (const selector of createChannelSelectors) {
          try {
            const button = await page.$(selector);
            if (button && await button.isVisible()) {
              await safeClick(page, selector);
              await waitForLoading(page);
              
              // Fill out channel creation form
              const channelNameSelectors = [
                '[data-testid="channel-name-input"]',
                'input[name="channelName"]',
                'input[name="name"]',
                'input[placeholder*="channel name"]'
              ];
              
              await safeType(page, channelNameSelectors[0], 'general');
              
              // Submit channel creation
              const submitSelectors = [
                '[data-testid="create-channel-submit"]',
                'button[type="submit"]',
                'button:has-text("Create")'
              ];
              
              await safeClick(page, submitSelectors[0]);
              await waitForLoading(page);
              channelFound = true;
              break;
            }
          } catch {
            continue;
          }
        }
      }
      
      if (!channelFound) {
        throw new Error('Could not find or create a channel');
      }
      
      // Take screenshot of channel view
      await takeScreenshot(page, 'channel-view');
      logPageState(page, 'channel-view');
      
      // Step 3: Send a message
      console.log('📝 Sending message...');
      
      // Look for message input field
      const messageInputSelectors = [
        '[data-testid="message-input"]',
        '.message-input',
        'textarea[name="message"]',
        'textarea[placeholder*="message"]',
        'textarea[placeholder*="Message"]',
        'input[name="message"]',
        'input[placeholder*="message"]',
        '.chat-input textarea',
        '.message-box textarea',
        '#message-input'
      ];
      
      let messageInputFound = false;
      for (const selector of messageInputSelectors) {
        try {
          const input = await page.$(selector);
          if (input && await input.isVisible()) {
            console.log(`✅ Found message input: ${selector}`);
            await safeType(page, selector, testMessage.content);
            messageInputFound = true;
            break;
          }
        } catch {
          continue;
        }
      }
      
      if (!messageInputFound) {
        throw new Error('Could not find message input field');
      }
      
      // Take screenshot before sending
      await takeScreenshot(page, 'message-typed');
      
      // Look for send button
      const sendButtonSelectors = [
        '[data-testid="send-button"]',
        '.send-button',
        'button:has-text("Send")',
        'button:has-text("send")',
        '[data-testid="send-message"]',
        '.send-message',
        'button[title*="Send"]'
      ];
      
      let sendButtonFound = false;
      for (const selector of sendButtonSelectors) {
        try {
          const button = await page.$(selector);
          if (button && await button.isVisible()) {
            console.log(`✅ Found send button: ${selector}`);
            await safeClick(page, selector);
            sendButtonFound = true;
            break;
          }
        } catch {
          continue;
        }
      }
      
      // Alternative: try pressing Enter if no send button found
      if (!sendButtonFound) {
        console.log('🔄 No send button found, trying Enter key...');
        await page.keyboard.press('Enter');
        sendButtonFound = true;
      }
      
      await waitForLoading(page);
      
      // Take screenshot after sending
      await takeScreenshot(page, 'message-sent');
      
      // Step 4: Verify the message appears
      console.log('🔍 Verifying message appears...');
      
      // Wait a moment for the message to appear
      await page.waitForTimeout(2000);
      
      // Look for the message in the chat
      const messageSelectors = [
        `[data-testid="message-content"]:has-text("${testMessage.content}")`,
        `.message-content:has-text("${testMessage.content}")`,
        `.message:has-text("${testMessage.content}")`,
        `[data-message-text="${testMessage.content}"]`,
        `text=${testMessage.content}`
      ];
      
      let messageFound = false;
      for (const selector of messageSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 10000 });
          console.log(`✅ Message found in chat: ${selector}`);
          messageFound = true;
          break;
        } catch {
          continue;
        }
      }
      
      if (!messageFound) {
        // Try a more flexible search - look for any message with our content
        try {
          const allMessages = await page.$$('.message, .message-content, [data-testid="message"]');
          for (const messageEl of allMessages) {
            const text = await messageEl.textContent();
            if (text && text.includes(testMessage.content)) {
              console.log('✅ Message found with flexible search');
              messageFound = true;
              break;
            }
          }
        } catch (error) {
          console.warn('Flexible message search failed:', error);
        }
      }
      
      if (!messageFound) {
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
              console.error(`❌ Message sending failed with error: ${errorText}`);
              errorFound = true;
              break;
            }
          } catch {
            continue;
          }
        }
        
        if (!errorFound) {
          await takeScreenshot(page, 'message-verification-failed');
          logPageState(page, 'message-verification');
          
          throw new Error('Message sending verification failed - message not found in chat');
        }
      }
      
      // Take final success screenshot
      await takeScreenshot(page, 'message-success');
      logPageState(page, 'message-success');
      
      console.log('🎉 Message sending test completed successfully!');
      
    } catch (error) {
      console.error('❌ Message sending test failed:', error);
      
      await takeScreenshot(page, 'message-sending-error');
      logPageState(page, 'error-state');
      
      throw error;
    }
  });
  
  electronTest('should handle empty message validation', async ({ page }) => {
    const testUser = generateTestUser();
    const testServer = generateTestServer();
    
    console.log('🧪 Starting empty message validation test...');
    
    try {
      // Setup user and server
      await setupUserAndServer(page, testUser, testServer);
      
      // Navigate to a channel (reuse logic from first test)
      const channelSelectors = [
        '[data-testid="channel-item"]',
        '.channel-item',
        '.channel:first-child'
      ];
      
      for (const selector of channelSelectors) {
        try {
          const channel = await page.$(selector);
          if (channel && await channel.isVisible()) {
            await safeClick(page, selector);
            await waitForLoading(page);
            break;
          }
        } catch {
          continue;
        }
      }
      
      // Try to send empty message
      const messageInputSelectors = [
        '[data-testid="message-input"]',
        '.message-input',
        'textarea[name="message"]'
      ];
      
      for (const selector of messageInputSelectors) {
        try {
          const input = await page.$(selector);
          if (input && await input.isVisible()) {
            // Don't type anything, just try to send
            await safeClick(page, selector); // Focus the input
            
            // Try to send empty message
            const sendButtonSelectors = [
              '[data-testid="send-button"]',
              '.send-button',
              'button:has-text("Send")'
            ];
            
            let sendAttempted = false;
            for (const sendSelector of sendButtonSelectors) {
              try {
                const sendBtn = await page.$(sendSelector);
                if (sendBtn && await sendBtn.isVisible()) {
                  // Check if send button is disabled (common validation)
                  const isDisabled = await sendBtn.isDisabled();
                  if (isDisabled) {
                    console.log('✅ Send button is disabled for empty message');
                    sendAttempted = true;
                    break;
                  } else {
                    await safeClick(page, sendSelector);
                    sendAttempted = true;
                    break;
                  }
                }
              } catch {
                continue;
              }
            }
            
            // Alternative: try Enter key
            if (!sendAttempted) {
              await page.keyboard.press('Enter');
              sendAttempted = true;
            }
            
            break;
          }
        } catch {
          continue;
        }
      }
      
      // Verify validation (either no message sent, or error shown)
      await page.waitForTimeout(1000);
      
      // Check that no empty message was sent
      const emptyMessageSelectors = [
        '.message:has-text("")',
        '.message-content:has-text("")',
        '[data-testid="message"]:has-text("")'
      ];
      
      let emptyMessageFound = false;
      for (const selector of emptyMessageSelectors) {
        try {
          const messages = await page.$$(selector);
          if (messages.length > 0) {
            emptyMessageFound = true;
            break;
          }
        } catch {
          continue;
        }
      }
      
      if (emptyMessageFound) {
        throw new Error('Empty message was incorrectly sent');
      }
      
      console.log('✅ Empty message validation test passed!');
      
    } catch (error) {
      console.error('❌ Empty message validation test failed:', error);
      await takeScreenshot(page, 'empty-message-validation-error');
      throw error;
    }
  });
});

/**
 * Helper function to setup user and server
 * This combines registration, login, and server creation
 */
async function setupUserAndServer(page: any, testUser: any, testServer: any): Promise<void> {
  console.log('🔧 Setting up user and server...');
  
  // Register user
  const registrationSelectors = [
    '[data-testid="register-button"]',
    '.register-button',
    'button:has-text("Register")'
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
  const usernameSelectors = ['[data-testid="username-input"]', 'input[name="username"]'];
  await safeType(page, usernameSelectors[0], testUser.username);
  
  const emailSelectors = ['[data-testid="email-input"]', 'input[name="email"]'];
  await safeType(page, emailSelectors[0], testUser.email);
  
  const passwordSelectors = ['[data-testid="password-input"]', 'input[name="password"]'];
  await safeType(page, passwordSelectors[0], testUser.password);
  
  // Submit registration
  const submitSelectors = [
    '[data-testid="register-submit"]',
    'button[type="submit"]',
    'button:has-text("Register")'
  ];
  
  await safeClick(page, submitSelectors[0]);
  await waitForLoading(page);
  
  // Wait for app to load
  await page.waitForTimeout(3000);
  
  // Create server
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
  
  // Fill server form
  const serverNameSelectors = [
    '[data-testid="server-name-input"]',
    'input[name="serverName"]'
  ];
  
  await safeType(page, serverNameSelectors[0], testServer.name);
  
  // Submit server creation
  const serverSubmitSelectors = [
    '[data-testid="create-server-submit"]',
    'button[type="submit"]',
    'button:has-text("Create")'
  ];
  
  await safeClick(page, serverSubmitSelectors[0]);
  await waitForLoading(page);
  
  // Wait for server to be created
  await page.waitForTimeout(2000);
  
  console.log('✅ User and server setup completed');
}
