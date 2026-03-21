/**
 * test-constants.ts
 * 
 * Defined test credentials and constants for E2E tests
 * These will be used consistently across all tests
 */

// Test user credentials
export const TEST_USER = {
  username: 'testuser_ember',
  password: 'TestPassword123!',
  email: 'testuser@ember.local'
};

// Server configuration
export const TEST_SERVER = {
  hostname: 'http://localhost:8085'
};

// Test timeouts
export const TEST_TIMEOUTS = {
  SHORT: 1000,
  MEDIUM: 2000,
  LONG: 5000,
  EXTRA_LONG: 10000
};

// Test selectors that are commonly used
export const TEST_SELECTORS = {
  // Login/Registration form
  USERNAME_FIELD: '#username',
  PASSWORD_FIELD: '#password',
  CONFIRM_PASSWORD_FIELD: '#confirm-password',
  HOSTNAME_FIELD: '#hostname',
  SUBMIT_BUTTON: '#submit-btn',
  TOGGLE_MODE_BUTTON: '#toggle-mode',
  
  // Error handling
  ERROR_BANNER: '#error-banner',
  
  // Logout
  USERNAME_DISPLAY: '.username',
  LOGOUT_MENU_ITEM: '#menu-logout',
  LOGOUT_MODAL: '#logout-modal',
  LOGOUT_CONFIRM_BUTTON: '#modal-logout-btn',
  
  // Common containers
  LOGIN_CONTAINER: '.login-container',
  CONFIRM_PASSWORD_GROUP: '#confirm-password-group'
};

export default TEST_USER;
