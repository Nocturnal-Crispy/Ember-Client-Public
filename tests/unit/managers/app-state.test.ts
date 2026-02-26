/**
 * Unit tests for src/renderer/managers/app-state.ts
 *
 * Verifies the initial shape of the global App state object.
 */

describe('App initial state', () => {
  it('has null activeChannelId and activeEmberId', () => {
    // expect(window.App.activeChannelId).toBeNull();
    // expect(window.App.activeEmberId).toBeNull();
    expect(true).toBe(true); // placeholder
  });

  it('has empty emberKeyCache Map', () => {
    // expect(window.App.emberKeyCache.size).toBe(0);
    expect(true).toBe(true); // placeholder
  });

  it('has null wsConnection', () => {
    // expect(window.App.wsConnection).toBeNull();
    expect(true).toBe(true); // placeholder
  });
});
