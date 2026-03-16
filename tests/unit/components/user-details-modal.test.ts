/**
 * Unit tests for src/renderer/components/user-details-modal.ts
 *
 * Tests modal show/hide, user info display, voice status,
 * and interaction buttons.
 */

// @jest-environment jsdom

let mockGetUserDetails: jest.Mock;
let mockGetUserVoiceChannel: jest.Mock;
let mockStartDmConversation: jest.Mock;

function buildModalDom(): void {
  const modal = document.createElement('div');
  modal.id = 'user-details-modal';
  modal.className = 'modal-overlay hidden';

  const container = document.createElement('div');
  container.id = 'user-details-container';
  container.className = 'user-details-container';

  const closeBtn = document.createElement('button');
  closeBtn.id = 'user-details-close';
  closeBtn.className = 'user-details-close';
  closeBtn.textContent = '✕';

  const avatarEl = document.createElement('div');
  avatarEl.id = 'user-details-avatar';
  avatarEl.className = 'user-details-avatar';

  const usernameEl = document.createElement('div');
  usernameEl.id = 'user-details-username';
  usernameEl.className = 'user-details-username';

  const statusEl = document.createElement('div');
  statusEl.id = 'user-details-status';
  statusEl.className = 'user-details-status';

  const roleEl = document.createElement('div');
  roleEl.id = 'user-details-role';
  roleEl.className = 'user-details-role';

  const voiceEl = document.createElement('div');
  voiceEl.id = 'user-details-voice';
  voiceEl.className = 'user-details-voice hidden';

  const customStatusEl = document.createElement('div');
  customStatusEl.id = 'user-details-custom-status';
  customStatusEl.className = 'user-details-custom-status';

  const actionsEl = document.createElement('div');
  actionsEl.className = 'user-details-actions';

  const dmBtn = document.createElement('button');
  dmBtn.id = 'user-details-dm-btn';
  dmBtn.className = 'user-details-dm-btn';
  dmBtn.textContent = 'Message';

  actionsEl.appendChild(dmBtn);
  container.appendChild(closeBtn);
  container.appendChild(avatarEl);
  container.appendChild(usernameEl);
  container.appendChild(statusEl);
  container.appendChild(roleEl);
  container.appendChild(voiceEl);
  container.appendChild(customStatusEl);
  container.appendChild(actionsEl);
  modal.appendChild(container);
  document.body.appendChild(modal);
}

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

  // 4. Mock user-service functions (dependencies)
  mockGetUserDetails = jest.fn().mockReturnValue(null);
  mockGetUserVoiceChannel = jest.fn().mockReturnValue(null);
  (window as any).getUserDetails = mockGetUserDetails;
  (window as any).getUserVoiceChannel = mockGetUserVoiceChannel;

  // 5. Mock DM navigation functions
  mockStartDmConversation = jest.fn().mockResolvedValue('conv-1');
  (window as any).openDMScreen = jest.fn();
  (window as any).openDmWithUser = mockStartDmConversation;

  // 6. Build the modal DOM (normally injected via HTML fragment)
  buildModalDom();

  // 7. Load the IIFE module
  require('../../../src/renderer/components/user-details-modal');
});

beforeEach(() => {
  mockGetUserDetails.mockClear();
  mockGetUserVoiceChannel.mockClear();
  mockStartDmConversation.mockClear();

  // Reset modal to hidden state
  const modal = document.getElementById('user-details-modal')!;
  modal.classList.add('hidden');

  // Clear displayed content
  document.getElementById('user-details-username')!.textContent = '';
  document.getElementById('user-details-status')!.textContent = '';
  document.getElementById('user-details-role')!.textContent = '';
  const voiceEl = document.getElementById('user-details-voice')!;
  voiceEl.textContent = '';
  voiceEl.classList.add('hidden');
});

describe('openUserDetailsModal', () => {
  it('removes the hidden class from the modal', () => {
    mockGetUserDetails.mockReturnValue({
      user_id: 'u1',
      username: 'Alice',
      status: 'online',
      role: 'member',
    });
    mockGetUserVoiceChannel.mockReturnValue(null);

    window.openUserDetailsModal('u1', 'Alice');

    const modal = document.getElementById('user-details-modal')!;
    expect(modal.classList.contains('hidden')).toBe(false);
  });

  it('displays the username in the modal', () => {
    mockGetUserDetails.mockReturnValue({
      user_id: 'u1',
      username: 'Alice',
      status: 'online',
      role: 'member',
    });
    mockGetUserVoiceChannel.mockReturnValue(null);

    window.openUserDetailsModal('u1', 'Alice');

    const usernameEl = document.getElementById('user-details-username')!;
    expect(usernameEl.textContent).toBe('Alice');
  });

  it('falls back to username parameter when getUserDetails returns null', () => {
    mockGetUserDetails.mockReturnValue(null);
    mockGetUserVoiceChannel.mockReturnValue(null);

    window.openUserDetailsModal('u-unknown', 'FallbackUser');

    const usernameEl = document.getElementById('user-details-username')!;
    expect(usernameEl.textContent).toBe('FallbackUser');
  });

  it('displays the user status', () => {
    mockGetUserDetails.mockReturnValue({
      user_id: 'u1',
      username: 'Alice',
      status: 'away',
      role: 'member',
    });
    mockGetUserVoiceChannel.mockReturnValue(null);

    window.openUserDetailsModal('u1', 'Alice');

    const statusEl = document.getElementById('user-details-status')!;
    expect(statusEl.textContent?.toLowerCase()).toContain('away');
  });

  it('displays the user role', () => {
    mockGetUserDetails.mockReturnValue({
      user_id: 'u2',
      username: 'Bob',
      status: 'online',
      role: 'owner',
    });
    mockGetUserVoiceChannel.mockReturnValue(null);

    window.openUserDetailsModal('u2', 'Bob');

    const roleEl = document.getElementById('user-details-role')!;
    expect(roleEl.textContent?.toLowerCase()).toContain('owner');
  });

  it('shows voice channel info when user is in voice', () => {
    mockGetUserDetails.mockReturnValue({
      user_id: 'u1',
      username: 'Alice',
      status: 'online',
      role: 'member',
    });
    mockGetUserVoiceChannel.mockReturnValue({ channelId: 'ch-lobby', channelName: 'Lobby' });

    window.openUserDetailsModal('u1', 'Alice');

    const voiceEl = document.getElementById('user-details-voice')!;
    expect(voiceEl.classList.contains('hidden')).toBe(false);
    expect(voiceEl.textContent).toContain('Lobby');
  });

  it('hides voice info when user is not in voice', () => {
    mockGetUserDetails.mockReturnValue({
      user_id: 'u1',
      username: 'Alice',
      status: 'online',
      role: 'member',
    });
    mockGetUserVoiceChannel.mockReturnValue(null);

    window.openUserDetailsModal('u1', 'Alice');

    const voiceEl = document.getElementById('user-details-voice')!;
    expect(voiceEl.classList.contains('hidden')).toBe(true);
  });

  it('calls getUserDetails with the provided userId', () => {
    mockGetUserDetails.mockReturnValue(null);
    mockGetUserVoiceChannel.mockReturnValue(null);

    window.openUserDetailsModal('u-specific', 'TestUser');

    expect(mockGetUserDetails).toHaveBeenCalledWith('u-specific');
  });

  it('resolves userId via getUserDetailsByUsername when userId is empty string', () => {
    const resolvedMember = {
      user_id: 'u-resolved',
      username: 'Alice',
      status: 'online',
      role: 'member',
    };
    const mockGetByUsername = jest.fn().mockReturnValue(resolvedMember);
    (window as any).getUserDetailsByUsername = mockGetByUsername;
    // getUserDetails should be called with the resolved id (not '')
    mockGetUserDetails.mockImplementation((id: string) =>
      id === 'u-resolved' ? resolvedMember : null
    );
    mockGetUserVoiceChannel.mockReturnValue(null);

    window.openUserDetailsModal('', 'Alice');

    expect(mockGetByUsername).toHaveBeenCalledWith('Alice');
    expect(mockGetUserDetails).toHaveBeenCalledWith('u-resolved');

    const usernameEl = document.getElementById('user-details-username')!;
    expect(usernameEl.textContent).toBe('Alice');

    // Status should reflect the resolved member's live status, not 'offline'
    const statusEl = document.getElementById('user-details-status')!;
    expect(statusEl.textContent?.toLowerCase()).toContain('online');
  });
});

describe('closeUserDetailsModal', () => {
  it('adds the hidden class to the modal', () => {
    // Open first
    mockGetUserDetails.mockReturnValue(null);
    mockGetUserVoiceChannel.mockReturnValue(null);
    window.openUserDetailsModal('u1', 'Alice');

    // Then close
    window.closeUserDetailsModal();

    const modal = document.getElementById('user-details-modal')!;
    expect(modal.classList.contains('hidden')).toBe(true);
  });
});

describe('modal close interactions', () => {
  beforeEach(() => {
    mockGetUserDetails.mockReturnValue({
      user_id: 'u1',
      username: 'Alice',
      status: 'online',
      role: 'member',
    });
    mockGetUserVoiceChannel.mockReturnValue(null);
    window.openUserDetailsModal('u1', 'Alice');
  });

  it('closes when the close button is clicked', () => {
    const closeBtn = document.getElementById('user-details-close')!;
    closeBtn.click();

    const modal = document.getElementById('user-details-modal')!;
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('closes when clicking the modal overlay backdrop', () => {
    const modal = document.getElementById('user-details-modal')!;
    // Simulate click directly on overlay (not container)
    const clickEvent = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(clickEvent, 'target', { value: modal });
    modal.dispatchEvent(clickEvent);

    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('closes when ESC key is pressed', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    const modal = document.getElementById('user-details-modal')!;
    expect(modal.classList.contains('hidden')).toBe(true);
  });
});

describe('DM button', () => {
  it('opens the DM screen and navigates to the conversation when clicked', () => {
    const mockOpenDMScreen = (window as any).openDMScreen as jest.Mock;
    mockGetUserDetails.mockReturnValue({
      user_id: 'u1',
      username: 'Alice',
      status: 'online',
      role: 'member',
    });
    mockGetUserVoiceChannel.mockReturnValue(null);
    mockOpenDMScreen.mockClear();
    mockStartDmConversation.mockClear();

    window.openUserDetailsModal('u1', 'Alice');

    const dmBtn = document.getElementById('user-details-dm-btn')!;
    dmBtn.click();

    expect(mockOpenDMScreen).toHaveBeenCalledTimes(1);
    expect(mockStartDmConversation).toHaveBeenCalledWith('u1', 'Alice');
  });

  it('closes the modal before navigating', () => {
    mockGetUserDetails.mockReturnValue(null);
    mockGetUserVoiceChannel.mockReturnValue(null);

    window.openUserDetailsModal('u1', 'Alice');
    const modal = document.getElementById('user-details-modal')!;
    expect(modal.classList.contains('hidden')).toBe(false);

    document.getElementById('user-details-dm-btn')!.click();

    expect(modal.classList.contains('hidden')).toBe(true);
  });
});
