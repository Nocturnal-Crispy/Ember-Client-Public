import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for Electron E2E testing
 *
 * This configuration sets up Playwright to test the built Electron application
 * with proper cleanup, timeouts, and reporting.
 */
export default defineConfig({
  testDir: './tests/e2e',

  // Global timeout for each test
  timeout: 60_000,

  // Global timeout for the entire test suite
  globalTimeout: 10 * 60_000,

  // Don't run tests in parallel by default to avoid conflicts
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI and locally to avoid multiple Electron instances
  workers: 1,

  // Reporter configuration
  reporter: [
    [
      'html',
      {
        outputFolder: 'test-results-report', // Separate directory for HTML report
        open: 'never',
      },
    ],
    [
      'json',
      {
        outputFile: 'test-results/test-results.json', // JSON results go to test-results
      },
    ],
    [
      'junit',
      {
        outputFile: 'test-results/test-results.xml', // XML results go to test-results
      },
    ],
    process.env.CI ? ['github'] : ['list'],
  ],

  // Shared settings for all tests
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    // For Electron, this will be overridden in the test setup

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Record video on failure
    video: 'retain-on-failure',

    // Take screenshot on failure
    screenshot: 'only-on-failure',

    // Global timeout for actions (click, type, etc.)
    actionTimeout: 10_000,

    // Global timeout for navigation
    navigationTimeout: 30_000,
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'electron',
      use: {
        // Use minimal configuration for Electron - don't inherit from Chrome devices
        // Use real display for testing
        launchOptions: {
          env: {
            ...process.env,
            DISPLAY: ':1', // Use your real display
          },
        },
      },
    },
  ],

  // Global setup and teardown
  globalSetup: require.resolve('./tests/e2e/global-setup.ts'),
  globalTeardown: require.resolve('./tests/e2e/global-teardown.ts'),

  // Test environment variables
  testIgnore: ['**/node_modules/**', '**/dist/**', '**/release/**'],
});
