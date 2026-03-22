/**
 * user-service.ts — User data lookup service.
 *
 * Provides functions to look up user details from the in-memory member cache
 * (App.currentMembers) and voice channel presence (App.voiceChannelPresence).
 *
 * Load order: must appear in main-loader AFTER app-state.js.
 */
(function (): void {
  const App = window.App;
  const log = window.emberLog.createLogger('UserService');

  /**
   * Look up a member in the current ember's member list by user_id.
   * Returns the Member object or null if not found.
   */
  function getUserDetails(userId: string): Member | null {
    if (!App.currentMembers || App.currentMembers.length === 0) {
      return null;
    }
    const found = App.currentMembers.find(m => m.user_id === userId);
    return found ?? null;
  }

  /**
   * Look up a member by username (case-sensitive).
   * Returns the Member object or null if not found.
   */
  function getUserDetailsByUsername(username: string): Member | null {
    if (!App.currentMembers || App.currentMembers.length === 0) {
      return null;
    }
    const found = App.currentMembers.find(m => m.username === username);
    return found ?? null;
  }

  /**
   * Determine which voice channel (if any) a user is currently in.
   * Returns { channelId, channelName } or null.
   */
  function getUserVoiceChannel(userId: string): { channelId: string; channelName: string } | null {
    const presence = App.voiceChannelPresence;
    if (!presence || presence.size === 0) {
      return null;
    }

    for (const [channelId, participants] of presence.entries()) {
      if (participants.has(userId)) {
        // Use the channel name from App channel list if available
        const channels = (App as any).currentChannels as
          | Array<{ id: string; name: string }>
          | undefined;
        const channelName = channels?.find(ch => ch.id === channelId)?.name ?? channelId;
        log.debug('getUserVoiceChannel: user found in voice', { userId, channelId });
        return { channelId, channelName };
      }
    }

    return null;
  }

  // ─── Expose globals ─────────────────────────────────────────────────────────

  window.getUserDetails = getUserDetails;
  window.getUserDetailsByUsername = getUserDetailsByUsername;
  window.getUserVoiceChannel = getUserVoiceChannel;
})();
