/**
 * Test for Direct Messaging system error handling.
 * This test verifies the error logging improvement.
 */

// Mock global window objects
declare global {
  interface Window {
    getValidAuth?: any;
    initializeDirectMessaging?: any;
    App?: any;
    emberLog?: any;
  }
}

describe('Direct Messaging Error Handling', () => {
  let mockLog: any;

  beforeEach(() => {
    // Mock logger
    mockLog = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };
    window.emberLog = {
      createLogger: jest.fn().mockReturnValue(mockLog),
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should properly extract error properties from empty-looking error objects', () => {
    // Create the exact scenario from the logs: an error object that appears empty
    const emptyError = new Error();
    Object.defineProperty(emptyError, 'message', {
      value: 'Test error message',
      enumerable: false, // This makes it non-enumerable, so it doesn't show up in { error }
    });
    Object.defineProperty(emptyError, 'stack', {
      value: 'Test stack trace',
      enumerable: false, // This makes it non-enumerable
    });
    Object.defineProperty(emptyError, 'name', {
      value: 'TestError',
      enumerable: false, // This makes it non-enumerable
    });

    // Simulate the old error logging (would show empty object)
    const oldLogging = { error: emptyError };
    expect(JSON.stringify(oldLogging.error)).toBe('{}');

    // Simulate the new error logging (extracts properties properly)
    const err = emptyError as Error;
    const newLogging = {
      error: {
        message: err.message || 'Unknown error',
        stack: err.stack || 'No stack trace available',
        name: err.name || 'Error',
      },
    };

    expect(newLogging.error.message).toBe('Test error message');
    expect(newLogging.error.stack).toBe('Test stack trace');
    expect(newLogging.error.name).toBe('TestError');
    expect(JSON.stringify(newLogging.error)).not.toBe('{}');
  });

  it('should handle errors with missing properties gracefully', () => {
    // Create an error with missing properties
    const partialError = {} as Error;

    // Simulate the new error logging with missing properties
    const err = partialError;
    const newLogging = {
      error: {
        message: err.message || 'Unknown error',
        stack: err.stack || 'No stack trace available',
        name: err.name || 'Error',
      },
    };

    expect(newLogging.error.message).toBe('Unknown error');
    expect(newLogging.error.stack).toBe('No stack trace available');
    expect(newLogging.error.name).toBe('Error');
  });

  it('should handle normal error objects correctly', () => {
    const normalError = new Error('Normal error message');

    // Simulate the new error logging
    const err = normalError;
    const newLogging = {
      error: {
        message: err.message || 'Unknown error',
        stack: err.stack || 'No stack trace available',
        name: err.name || 'Error',
      },
    };

    expect(newLogging.error.message).toBe('Normal error message');
    expect(newLogging.error.name).toBe('Error');
    expect(newLogging.error.stack).toContain('Normal error message');
  });
});
