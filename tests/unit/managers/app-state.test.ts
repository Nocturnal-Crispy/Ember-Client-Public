/**
 * Unit tests for src/renderer/managers/app-state.ts
 *
 * Verifies the initial shape of the global App state object.
 */

beforeAll(() => {
  require('../../../src/renderer/managers/app-state');
});

describe('App initial state', () => {
  it('has null activeChannelId and activeEmberId', () => {
    expect((window as any).App.activeChannelId).toBeNull();
    expect((window as any).App.activeEmberId).toBeNull();
  });

  it('has an empty emberKeyCache Map', () => {
    expect((window as any).App.emberKeyCache).toBeInstanceOf(Map);
    expect((window as any).App.emberKeyCache.size).toBe(0);
  });

  it('has null wsConnection and wsReconnectTimer', () => {
    expect((window as any).App.wsConnection).toBeNull();
    expect((window as any).App.wsReconnectTimer).toBeNull();
  });

  it('has empty currentEmbers and currentMembers arrays', () => {
    expect(Array.isArray((window as any).App.currentEmbers)).toBe(true);
    expect((window as any).App.currentEmbers.length).toBe(0);
    expect(Array.isArray((window as any).App.currentMembers)).toBe(true);
    expect((window as any).App.currentMembers.length).toBe(0);
  });

  it('has null voiceManager and activeVoiceChannelId', () => {
    expect((window as any).App.voiceManager).toBeNull();
    expect((window as any).App.activeVoiceChannelId).toBeNull();
  });

  it('has an empty voiceParticipants Map and videoParticipants Set', () => {
    expect((window as any).App.voiceParticipants).toBeInstanceOf(Map);
    expect((window as any).App.voiceParticipants.size).toBe(0);
    expect((window as any).App.videoParticipants).toBeInstanceOf(Set);
    expect((window as any).App.videoParticipants.size).toBe(0);
  });

  it('has camera/video flags set to false', () => {
    expect((window as any).App.localCameraOn).toBe(false);
    expect((window as any).App.videoGridVisible).toBe(false);
  });

  it('has null health-check and reconnection timers', () => {
    expect((window as any).App.healthcheckInterval).toBeNull();
    expect((window as any).App.reconnectionTimeout).toBeNull();
    expect((window as any).App.reconnectionStartTime).toBeNull();
    expect((window as any).App.reconnectionTimerInterval).toBeNull();
  });

  it('has null channel modal fields', () => {
    expect((window as any).App.channelModalMode).toBeNull();
    expect((window as any).App.channelModalTargetId).toBeNull();
    expect((window as any).App.channelModalCategoryId).toBeNull();
  });

  it('has null currentIconData and "upload" as currentIconSource', () => {
    expect((window as any).App.currentIconData).toBeNull();
    expect((window as any).App.currentIconSource).toBe('upload');
  });

  it('has null pendingInvite and null drag/context-menu state', () => {
    expect((window as any).App.pendingInvite).toBeNull();
    expect((window as any).App.dragItem).toBeNull();
    expect((window as any).App.contextMenuTarget).toBeNull();
  });

  it('has false _pttListening', () => {
    expect((window as any).App._pttListening).toBe(false);
  });

  it('has screen share flags set to correct defaults', () => {
    expect((window as any).App.localScreenShareOn).toBe(false);
    const participants = (window as any).App.screenShareParticipants;
    expect(participants).toBeInstanceOf(Set);
    expect(participants.size).toBe(0);
  });

  it('initialises videoPopoutOpen to false', () => {
    expect((window as any).App.videoPopoutOpen).toBe(false);
  });

  it('initialises focusedTileId to null', () => {
    expect((window as any).App.focusedTileId).toBeNull();
  });

  it('initialises lastScreenShareUserId to null', () => {
    expect((window as any).App.lastScreenShareUserId).toBeNull();
  });
});
