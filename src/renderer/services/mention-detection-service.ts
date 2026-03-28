/**
 * Mention Detection Service
 * Detects whether the current user is mentioned in decrypted message content.
 * Works client-side only — no server involvement — preserving zero-knowledge architecture.
 */
(function (): void {
  interface MentionResult {
    isMentioned: boolean;
    mentionType: 'user' | 'role' | 'everyone' | null;
  }

  function detectMentions(
    decryptedText: string,
    currentUserId: string,
    currentRoleIds: string[]
  ): MentionResult {
    if (!decryptedText || !currentUserId) {
      return { isMentioned: false, mentionType: null };
    }

    // Check @everyone
    if (decryptedText.includes('@everyone')) {
      return { isMentioned: true, mentionType: 'everyone' };
    }

    // Check direct user mention: <@userId>
    if (decryptedText.includes(`<@${currentUserId}>`)) {
      return { isMentioned: true, mentionType: 'user' };
    }

    // Check role mentions: <@&roleId>
    for (const roleId of currentRoleIds) {
      if (decryptedText.includes(`<@&${roleId}>`)) {
        return { isMentioned: true, mentionType: 'role' };
      }
    }

    return { isMentioned: false, mentionType: null };
  }

  window.detectMentions = detectMentions;
})();
