/**
 * Integration test for Direct Messaging system initialization error handling.
 * This test verifies that the renderer properly handles and logs errors during DM initialization.
 */

// Mock the modules that would be imported
jest.mock('../../src/renderer/managers/direct-messaging-manager', () => ({
  // Return a mock that throws an error when initializeDirectMessaging is called
  default: {
    initializeDirectMessaging: jest.fn().mockRejectedValue(new Error())
  }
}));

// Mock global window objects
declare global {
  interface Window {
    getValidAuth?: any;
    initializeDirectMessaging?: any;
    App?: any;
    emberLog?: any;
    fetchEmbers?: any;
    renderServerList?: any;
    hideWelcomeScreen?: any;
    showWelcomeScreen?: any;
  }
}

describe('Direct Messaging System Initialization - Integration', () => {
  let mockLog: any;
  let mockAuth: any;

  beforeEach(() => {
    // Reset window object
    delete (window as any).getValidAuth;
    delete (window as any).initializeDirectMessaging;
    delete (window as any).App;
    delete (window as any).emberLog;
    delete (window as any).fetchEmbers;

    mockAuth = {
      token: 'test-token',
      user_id: 'test-user-id',
      device_id: 'test-device-id',
      hostname: 'http://localhost:8085',
      username: 'test-user'
    };

    // Mock window.getValidAuth
    window.getValidAuth = jest.fn().mockResolvedValue(mockAuth);
    
    // Mock window.App
    window.App = {
      initializeSignalSessionManager: jest.fn(),
      emberKeyCache: new Map()
    } as any;
    
    // Mock logger
    mockLog = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    };
    window.emberLog = {
      createLogger: jest.fn().mockReturnValue(mockLog)
    } as any;
    
    // Mock other required functions
    window.fetchEmbers = jest.fn().mockResolvedValue([]);
    window.renderServerList = jest.fn();
    window.hideWelcomeScreen = jest.fn();
    window.showWelcomeScreen = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should properly handle and log Direct Messaging initialization errors', async () => {
    // Create an error with no enumerable properties to reproduce the original issue
    const emptyError = new Error();
    Object.defineProperty(emptyError, 'message', {
      value: 'Test error',
      enumerable: false
    });
    Object.defineProperty(emptyError, 'stack', {
      value: 'Test stack',
      enumerable: false
    });
    
    // Mock initializeDirectMessaging to throw the error
    window.initializeDirectMessaging = jest.fn().mockRejectedValue(emptyError);
    
    // Import and execute the renderer module (this will trigger the initialization)
    try {
      require('../../src/renderer/managers/renderer.ts');
      
      // Wait a bit for async initialization
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify error logging was called with proper error extraction
      expect(mockLog.error).toHaveBeenCalledWith(
        "Failed to initialize Direct Messaging system",
        expect.objectContaining({
          error: expect.objectContaining({
            message: expect.any(String),
            stack: expect.any(String),
            name: expect.any(String)
          })
        })
      );
    } catch (error) {
      // The renderer module might throw during initialization, which is expected
      // What we care about is that the error was logged properly
      expect(mockLog.error).toHaveBeenCalledWith(
        "Failed to initialize Direct Messaging system",
        expect.objectContaining({
          error: expect.objectContaining({
            message: expect.any(String),
            stack: expect.any(String),
            name: expect.any(String)
          })
        })
      );
    }
  });

  it('should handle successful Direct Messaging initialization', async () => {
    // Mock successful initialization
    window.initializeDirectMessaging = jest.fn().mockResolvedValue(undefined);
    
    try {
      require('../../src/renderer/managers/renderer.ts');
      
      // Wait a bit for async initialization
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify success logging was called
      expect(mockLog.info).toHaveBeenCalledWith("Direct Messaging system initialized");
    } catch (error) {
      // If there are other initialization issues, that's okay for this test
      // We're mainly testing that DM initialization success is logged
      expect(mockLog.info).toHaveBeenCalledWith("Direct Messaging system initialized");
    }
  });
});
