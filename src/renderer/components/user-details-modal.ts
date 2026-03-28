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
  const App = window.App;
  const log = window.emberLog.createLogger('UserDetailsModal');

  // ─── Permission bit constants ─────────────────────────────────────────────

  const KICK_MEMBERS = 1n << 4n;
  const ADMINISTRATOR = 1n << 6n;

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

  function isSafeUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
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
      if (member?.avatar && isSafeUrl(member.avatar)) {
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

    // Kick button — show only if caller has KickMembers/Administrator permission,
    // target is not the ember owner, target is not the current user, and member is loaded.
    const canKick =
      (App.myPermissions & KICK_MEMBERS) !== 0n || (App.myPermissions & ADMINISTRATOR) !== 0n;
    const isOwner = member?.role === 'owner';
    const auth = window.getAuthSync?.();
    const isSelf = !!auth && userId === auth.userId;
    const inEmber = !!App.activeEmberId;
    const showKick = canKick && !!member && !isOwner && !isSelf && inEmber;
    setHidden('user-details-kick-btn', !showKick);
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
    getEl('kick-confirm-overlay')?.classList.add('hidden');
    document.getElementById('kick-confirm-error')?.remove();
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

    // Kick button → show confirmation overlay
    getEl('user-details-kick-btn')?.addEventListener('click', () => {
      const nameEl = getEl('kick-confirm-username');
      if (nameEl) nameEl.textContent = currentUsername ?? '';
      getEl('kick-confirm-overlay')?.classList.remove('hidden');
    });

    // Kick confirmation — cancel
    getEl('kick-confirm-cancel')?.addEventListener('click', () => {
      getEl('kick-confirm-overlay')?.classList.add('hidden');
    });

    // Kick confirmation — confirm
    getEl('kick-confirm-yes')?.addEventListener('click', () => {
      if (!currentUserId || !App.activeEmberId) return;
      const emberId = App.activeEmberId;
      const userId = currentUserId;
      kickMember(emberId, userId);
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
        const SAFE_HEX = /^#[0-9a-fA-F]{3,8}$/;
        for (const role of roles) {
          const badge = document.createElement('span');
          badge.textContent = role.name;
          const safeColor = SAFE_HEX.test(role.color ?? '') ? role.color : '#99aab5';
          badge.style.display = 'inline-block';
          badge.style.padding = '2px 8px';
          badge.style.margin = '2px 4px 2px 0';
          badge.style.borderRadius = '3px';
          badge.style.fontSize = '0.75rem';
          badge.style.fontWeight = '500';
          badge.style.background = `${safeColor}33`;
          badge.style.color = safeColor;
          badge.style.border = `1px solid ${safeColor}55`;
          container.appendChild(badge);
        }
      } catch {
        // Silently fail — legacy role text is already shown as fallback
      }
    })();
  }

  // ─── Kick member API call ───────────────────────────────────────────────────

  async function kickMember(emberId: string, userId: string): Promise<void> {
    const target = (window as any).getUserDetails?.(userId) as Member | null;
    if (target?.role === 'owner') {
      log.warn('Kick attempted on owner, blocked client-side', { userId });
      return;
    }

    const confirmBtn = getEl('kick-confirm-yes') as HTMLButtonElement | null;
    if (confirmBtn) confirmBtn.disabled = true;

    try {
      const auth = await window.getValidAuth?.();
      if (!auth?.token || !auth?.hostname) return;

      const resp = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/members/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      if (!resp.ok) {
        const errData = (await resp.json().catch(() => ({ error: 'Unknown error' }))) as {
          error?: string;
        };
        log.error('Kick failed', { status: resp.status, error: errData.error });
        showKickError(errData.error ?? 'Failed to kick member');
        return;
      }

      log.info('Member kicked', { ember_id: emberId, user_id: userId });
      closeUserDetailsModal();
    } catch (e) {
      log.error('Kick request failed', { error: String(e) });
      showKickError('Network error — could not reach server');
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
    }
  }

  function showKickError(message: string): void {
    const dialog = document.querySelector('.kick-confirm-dialog');
    if (!dialog) return;

    let errEl = document.getElementById('kick-confirm-error');
    if (!errEl) {
      errEl = document.createElement('p');
      errEl.id = 'kick-confirm-error';
      errEl.style.cssText = 'color:#ed4245;font-size:11px;margin-top:8px;font-family:inherit;';
      dialog.appendChild(errEl);
    }
    const capped = message.length > 120 ? `${message.slice(0, 120)}...` : message;
    errEl.textContent = `Error: ${capped}`;
  }

  // ─── Expose globals ─────────────────────────────────────────────────────────

  window.openUserDetailsModal = openUserDetailsModal;
  window.closeUserDetailsModal = closeUserDetailsModal;
})();
