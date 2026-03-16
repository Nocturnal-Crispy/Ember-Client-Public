/**
 * Unit tests for src/renderer/utils/username-click-handler.ts
 *
 * Tests that username elements get click handlers that trigger
 * the user details modal.
 */

// @jest-environment jsdom

let mockOpenUserDetailsModal: jest.Mock;

beforeAll(() => {
  // 1. Load app-state
  require('../../../src/renderer/managers/app-state');

  // 2. Mock window.electronAPI
  (window as any).electronAPI = {
    ipc: {
      invoke: jest.fn().mockResolvedValue(null),
      send: jest.fn(),
      on: jest.fn(),
    },
    nacl: {},
    naclUtil: {},
    crypto: {},
  };

  // 3. Mock window.emberLog
  (window as any).emberLog = {
    createLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };

  // 4. Mock openUserDetailsModal (will be set by user-details-modal module)
  mockOpenUserDetailsModal = jest.fn();
  (window as any).openUserDetailsModal = mockOpenUserDetailsModal;

  // 5. Load the IIFE module
  require('../../../src/renderer/utils/username-click-handler');
});

beforeEach(() => {
  mockOpenUserDetailsModal.mockClear();
});

describe('makeUsernameClickable', () => {
  it('adds cursor: pointer style to the element', () => {
    const el = document.createElement('span');
    window.makeUsernameClickable(el, 'u1', 'Alice');

    expect(el.style.cursor).toBe('pointer');
  });

  it('clicking the element calls openUserDetailsModal with correct args', () => {
    const el = document.createElement('span');
    window.makeUsernameClickable(el, 'u2', 'Bob');

    el.click();

    expect(mockOpenUserDetailsModal).toHaveBeenCalledTimes(1);
    expect(mockOpenUserDetailsModal).toHaveBeenCalledWith('u2', 'Bob');
  });

  it('does not call openUserDetailsModal before element is clicked', () => {
    const el = document.createElement('span');
    window.makeUsernameClickable(el, 'u3', 'Carol');

    expect(mockOpenUserDetailsModal).not.toHaveBeenCalled();
  });

  it('adds username-clickable class to the element', () => {
    const el = document.createElement('span');
    window.makeUsernameClickable(el, 'u4', 'Dave');

    expect(el.classList.contains('username-clickable')).toBe(true);
  });

  it('handles multiple clicks correctly', () => {
    const el = document.createElement('span');
    window.makeUsernameClickable(el, 'u5', 'Eve');

    el.click();
    el.click();
    el.click();

    expect(mockOpenUserDetailsModal).toHaveBeenCalledTimes(3);
  });

  it('works with different element types (div, span, etc.)', () => {
    const div = document.createElement('div');
    window.makeUsernameClickable(div, 'u6', 'Frank');

    div.click();

    expect(mockOpenUserDetailsModal).toHaveBeenCalledWith('u6', 'Frank');
  });
});
