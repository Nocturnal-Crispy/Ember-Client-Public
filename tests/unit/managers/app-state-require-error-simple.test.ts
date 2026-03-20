/**
 * Simple test to reproduce the require error bug
 */

describe('App State require error', () => {
  it('should demonstrate require is not available in renderer context', () => {
    // Simulate the renderer environment where require is not defined
    const originalRequire = global.require;
    delete (global as any).require;
    
    expect(() => {
      // This simulates what happens in app-state.ts line 90
      const { SignalSessionManager } = require('./signal-session-manager');
    }).toThrow('require is not defined');
    
    // Restore require for other tests
    if (originalRequire) {
      global.require = originalRequire;
    }
  });
});
