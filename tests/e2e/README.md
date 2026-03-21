# Ember E2E Testing with Playwright

This directory contains end-to-end tests for the Ember Electron application using Playwright. These tests use the **actual built Electron application** to provide realistic testing of the complete user workflow.

## 🎯 What These Tests Cover

### Complete User Journey
- **User Registration**: Create new accounts with validation
- **Server Creation**: Set up chat servers with proper configuration  
- **Message Sending**: Send and verify messages in channels
- **Full Workflow**: End-to-end test covering the entire user experience

### Test Files
- `user-registration.test.ts` - User registration and validation
- `server-creation.test.ts` - Server creation and management
- `message-sending.test.ts` - Message sending and channel interaction
- `full-workflow.test.ts` - Complete end-to-end user journey

## 🚀 Getting Started

### Prerequisites
```bash
# Install dependencies
npm install

# Install Playwright browsers
npm run test:e2e:install
```

### Running Tests

#### Basic E2E Tests
```bash
# Run all E2E tests (headless)
npm run test:e2e

# Run with visible browser (for debugging)
npm run test:e2e:headed

# Run specific test file
npx playwright test tests/e2e/user-registration.test.ts

# Run specific test
npx playwright test --grep "should register a new user successfully"
```

#### Debug Mode
```bash
# Debug mode with browser inspector
npm run test:e2e:debug

# Interactive UI mode
npm run test:e2e:ui
```

#### Reports
```bash
# View HTML report
npm run test:e2e:report

# Run all tests (unit + E2E)
npm run test:all
```

## 🏗️ Test Architecture

### Test Utilities
- `utils/electron-app.ts` - Electron application lifecycle management
- `utils/test-helpers.ts` - Common test helper functions

### Global Setup/Teardown
- `global-setup.ts` - Runs before all tests (build app, clean data)
- `global-teardown.ts` - Runs after all tests (cleanup)

### Configuration
- `playwright.config.ts` - Playwright configuration for Electron testing

## 🔧 How It Works

### 1. **App Launch**
```typescript
const electronApp = await launchElectronApp({
  userDataDir: '/path/to/isolated/data',
  env: { EMBER_TEST_MODE: 'true' }
});
```

### 2. **Test Isolation**
- Each test gets a fresh user data directory
- No shared state between tests
- Automatic cleanup after each test

### 3. **Real User Interactions**
- Clicks buttons and links
- Types in forms
- Waits for loading states
- Verifies UI elements

### 4. **Comprehensive Verification**
- Screenshots on success/failure
- Console logging for debugging
- Error detection and reporting

## 📝 Test Examples

### User Registration
```typescript
// Navigate to registration
await safeClick(page, '[data-testid="register-button"]');

// Fill form
await safeType(page, '[data-testid="username-input"]', testUser.username);
await safeType(page, '[data-testid="email-input"]', testUser.email);
await safeType(page, '[data-testid="password-input"]', testUser.password);

// Submit
await safeClick(page, '[data-testid="register-submit"]');

// Verify success
await expect(page.locator('text=Registration successful')).toBeVisible();
```

### Message Sending
```typescript
// Select channel
await safeClick(page, '.channel-item:first-child');

// Type message
await safeType(page, '[data-testid="message-input"]', testMessage.content);

// Send
await page.keyboard.press('Enter');

// Verify message appears
await expect(page.locator(`text=${testMessage.content}`)).toBeVisible();
```

## 🐛 Debugging

### Screenshots
Tests automatically capture screenshots:
- `test-results/screenshots/` - All test screenshots
- Named with test context and timestamp

### Video Recording
Videos are recorded for failed tests automatically.

### Console Logs
```typescript
logPageState(page, 'context'); // Logs URL, title, errors
```

### Headed Mode
```bash
npm run test:e2e:headed
```

## 🔄 CI/CD Integration

### GitHub Actions
```yaml
- name: Run E2E Tests
  run: |
    npm run build
    npm run test:e2e:install
    npm run test:e2e
```

### Docker
```dockerfile
RUN npm run test:e2e:install
CMD ["npm", "run", "test:e2e"]
```

## 📊 Test Data

### Generated Test Data
- **Users**: `testuser-123456-abcde@test.com`
- **Servers**: `Test Server 123456-abcde`
- **Messages**: `Test message 123456-abcde`

### Data Isolation
- Each test gets unique timestamped data
- Automatic cleanup prevents data leaks
- No conflicts between concurrent tests

## 🛠️ Customization

### Adding New Tests
1. Create test file in `tests/e2e/`
2. Use `electronTest` fixture
3. Follow existing patterns

### Test Helpers
```typescript
// Generate test data
const user = generateTestUser('mytest');
const server = generateTestServer('My Server');
const message = generateTestMessage('Hello');

// Common actions
await safeClick(page, selector);
await safeType(page, selector, text);
await waitForLoading(page);
```

### Selectors
Tests use multiple selector strategies for robustness:
- `data-testid` attributes (preferred)
- CSS classes
- Text content
- ARIA attributes

## 🚨 Troubleshooting

### Common Issues

#### "Built Electron app not found"
```bash
npm run build
```

#### "Playwright browsers not installed"
```bash
npm run test:e2e:install
```

#### Tests timeout
- Increase timeout in `playwright.config.ts`
- Check if app is slow to load
- Verify network connectivity

#### Element not found
- Use `waitForSelector` with longer timeout
- Check if selector is correct
- Verify element is visible

### Debug Steps
1. Run with `--headed` flag
2. Add `logPageState()` calls
3. Take screenshots manually
4. Check browser console for errors

## 📈 Best Practices

### Test Design
- **Independent**: Each test should work in isolation
- **Deterministic**: Same result every time
- **Fast**: Minimize unnecessary waits
- **Clear**: Descriptive names and assertions

### Selectors
- Prefer `data-testid` for test-specific elements
- Use semantic selectors over implementation details
- Have fallback selectors for robustness

### Error Handling
- Always check for error states
- Provide helpful error messages
- Capture screenshots on failure

### Performance
- Reuse test helpers
- Avoid unnecessary page loads
- Clean up resources properly

## 🎯 Future Enhancements

### Planned Features
- **Multi-user testing**: Test collaboration scenarios
- **Network simulation**: Test with slow/poor connections
- **Accessibility testing**: Verify screen reader support
- **Performance testing**: Measure app responsiveness

### Advanced Scenarios
- **File uploads**: Test image/document sharing
- **Voice/video**: Test audio/video calling
- **Notifications**: Test system notifications
- **Offline mode**: Test app behavior without network

---

## 🤝 Contributing

When adding E2E tests:

1. **Follow existing patterns** - Use the same structure and helpers
2. **Add meaningful assertions** - Verify actual functionality
3. **Handle edge cases** - Test both success and failure scenarios
4. **Keep tests isolated** - No dependencies between tests
5. **Document complex scenarios** - Add comments for non-obvious logic

## 📞 Support

For questions about E2E testing:
- Check this README first
- Look at existing test examples
- Review Playwright documentation
- Ask in team channels for specific Ember testing questions
