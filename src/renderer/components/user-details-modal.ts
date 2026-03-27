/**
 * user-details-modal.ts — Discord-style user profile popup.
 *
 * Provides openUserDetailsModal(userId, username) to display a modal with
 * comprehensive user info: display name, status, role, voice channel, and
 * a "Send DM" action.
 *
 * Load order: must appear in main-loader AFTER app-state.js and user-service.js.
 * The modal HTML fragment (modal-user-details.html) must be loaded into the DOM
 * before this script runs.
 */
(function (): void {
  const log = window.emberLog.createLogger('UserDetailsModal');

  // ─── State ──────────────────────────────────────────────────────────────────

  let currentUserId: string | null = null;
  let currentUsername: string | null = null;

  // ─── DOM helpers ────────────────────────────────────────────────────────────

  function getEl(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  function setText(id: string, text: string): void {
    const el = getEl(id);
    if (el) el.textContent = text;
  }

  function setHidden(id: string, hidden: boolean): void {
    const el = getEl(id);
    if (!el) return;
    if (hidden) {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  }

  // ─── Populate modal ─────────────────────────────────────────────────────────

  function populateModal(userId: string, username: string): void {
    // Look up member details from cache
    const member = (window as any).getUserDetails?.(userId) as Member | null;

    // Username
    setText('user-details-username', member?.username ?? username);

    // Avatar (image if available, otherwise first letter of username)
    const avatarEl = getEl('user-details-avatar');
    if (avatarEl) {
      avatarEl.replaceChildren();
      if (member?.avatar) {
        const img = document.createElement('img');
        img.src = member.avatar;
        img.alt = member.username ?? username;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
        avatarEl.appendChild(img);
      } else {
        avatarEl.textContent = (member?.username ?? username).charAt(0).toUpperCase();
      }
    }

    // Status
    const status = member?.status ?? 'offline';
    setText('user-details-status', status.charAt(0).toUpperCase() + status.slice(1));
    const statusEl = getEl('user-details-status');
    if (statusEl) {
      statusEl.dataset['status'] = status;
    }

    // Roles — fetch from permission system API
    const roleContainer = getEl('user-details-role');
    if (roleContainer) {
      roleContainer.replaceChildren();
      const emberId = window.App.activeEmberId;
      if (emberId) {
        fetchMemberRoles(emberId, userId, roleContainer);
      } else {
        // Fallback to legacy role string
        const role = member?.role ?? '';
        if (role) {
          roleContainer.textContent = role.charAt(0).toUpperCase() + role.slice(1);
          roleContainer.style.display = '';
        } else {
          roleContainer.style.display = 'none';
        }
      }
    }

    // Custom status
    const customStatus = member?.customStatus ?? '';
    if (customStatus) {
      const emoji = member?.statusEmoji ?? '';
      setText('user-details-custom-status', emoji ? `${emoji} ${customStatus}` : customStatus);
      setHidden('user-details-custom-status', false);
    } else {
      setHidden('user-details-custom-status', true);
    }

    // Voice channel
    const voiceInfo = (window as any).getUserVoiceChannel?.(userId) as {
      channelId: string;
      channelName: string;
    } | null;

    if (voiceInfo) {
      setText('user-details-voice', `In voice: ${voiceInfo.channelName}`);
      setHidden('user-details-voice', false);
    } else {
      setText('user-details-voice', '');
      setHidden('user-details-voice', true);
    }
  }

  // ─── Open / Close ───────────────────────────────────────────────────────────

  function openUserDetailsModal(userId: string, username: string): void {
    // If userId was not available at click-wiring time (e.g. chumhandles wired before
    // currentMembers loaded), resolve it now via username lookup.
    const resolvedId =
      userId ||
      ((window as any).getUserDetailsByUsername?.(username) as Member | null)?.userId ||
      '';
    log.debug('Opening user details modal', { userId: resolvedId, username });
    currentUserId = resolvedId;
    currentUsername = username;

    populateModal(resolvedId, username);

    const modal = getEl('user-details-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  function closeUserDetailsModal(): void {
    log.debug('Closing user details modal');
    const modal = getEl('user-details-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
    currentUserId = null;
    currentUsername = null;
  }

  // ─── Event wiring ───────────────────────────────────────────────────────────

  function wireEvents(): void {
    // Close button
    const closeBtn = getEl('user-details-close');
    closeBtn?.addEventListener('click', e => {
      e.stopPropagation();
      closeUserDetailsModal();
    });

    // Backdrop click (overlay but not inner container)
    const modal = getEl('user-details-modal');
    modal?.addEventListener('click', e => {
      if (e.target === modal) {
        closeUserDetailsModal();
      }
    });

    // ESC key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const m = getEl('user-details-modal');
        if (m && !m.classList.contains('hidden')) {
          closeUserDetailsModal();
        }
      }
    });

    // DM button — open DM screen and navigate to (or create) the conversation.
    // Capture userId/username before closeUserDetailsModal() clears them.
    const dmBtn = getEl('user-details-dm-btn');
    dmBtn?.addEventListener('click', () => {
      if (currentUserId && currentUsername) {
        const userId = currentUserId;
        const username = currentUsername;
        log.info('Opening DM from user details modal', { userId });
        closeUserDetailsModal();
        (window as any).openDMScreen?.();
        (window as any).openDmWithUser?.(userId, username);
      }
    });
  }

  wireEvents();

  // ─── Fetch member roles from API ──────────────────────────────────────────

  function fetchMemberRoles(emberId: string, userId: string, container: HTMLElement): void {
    (async () => {
      try {
        const auth = await window.getValidAuth?.();
        if (!auth?.token || !auth?.hostname) return;
        const resp = await fetch(
          `${auth.hostname}/api/v1/embers/${emberId}/members/${userId}/roles`,
          { headers: { Authorization: `Bearer ${auth.token}` } }
        );
        if (!resp.ok) return;
        const data = (await resp.json()) as {
          roles: Array<{ name: string; color: string; isEveryone: boolean }>;
        };
        const roles = (data.roles ?? []).filter(r => !r.isEveryone);
        container.replaceChildren();
        if (roles.length === 0) {
          container.style.display = 'none';
          return;
        }
        container.style.display = '';
        for (const role of roles) {
          const badge = document.createElement('span');
          badge.textContent = role.name;
          badge.style.cssText = `
            display: inline-block;
            padding: 2px 8px;
            margin: 2px 4px 2px 0;
            border-radius: 3px;
            font-size: 0.75rem;
            font-weight: 500;
            background: ${role.color || '#99aab5'}33;
            color: ${role.color || '#99aab5'};
            border: 1px solid ${role.color || '#99aab5'}55;
          `;
          container.appendChild(badge);
        }
      } catch {
        // Silently fail — legacy role text is already shown as fallback
      }
    })();
  }

  // ─── Expose globals ─────────────────────────────────────────────────────────

  window.openUserDetailsModal = openUserDetailsModal;
  window.closeUserDetailsModal = closeUserDetailsModal;
})();
