/**
 * Invite manager — TypeScript conversion of public/invite-manager.js.
 * Handles invite creation, deep link processing, and the accept-invite modal.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('InviteManager');
  // Setup IPC listener immediately to avoid missing messages
  log.debug('Setting up IPC listener for handle-invite-link');
  ipcRenderer.on('handle-invite-link', () => {
    log.info('Received invite link notification from main process');
    // Get the pending invite data via invoke to work around context bridge issues
    handleInviteNotification();
  });
  log.debug('IPC listener setup complete');

  async function handleInviteNotification(): Promise<void> {
    try {
      log.debug('Getting pending invite data...');
      const invite = (await ipcRenderer.invoke('get-pending-invite')) as {
        code: string;
        hostname: string | null;
      } | null;
      if (!invite) {
        log.error('No pending invite data found!');
        return;
      }
      // Never log invite codes (they are effectively authentication tokens).
      log.debug('Retrieved pending invite:', {
        has_code: invite.code.length > 0,
        hostname: invite.hostname,
      });
      processInviteLink(invite.code, invite.hostname);
    } catch (error) {
      const err = error as Error;
      log.error('Error handling invite notification:', { error: err.message });
    }
  }

  // ─── Join Server Modal ─────────────────────────────────────────────────────

  function getJoinServerModal(): HTMLElement | null {
    return document.getElementById('join-server-modal');
  }

  function getJoinInviteInput(): HTMLInputElement | null {
    return document.getElementById('join-invite-input') as HTMLInputElement | null;
  }

  function getJoinServerBtn(): HTMLButtonElement | null {
    return document.getElementById('join-server-btn') as HTMLButtonElement | null;
  }

  function getJoinServerCancelBtn(): HTMLElement | null {
    return document.getElementById('join-server-cancel-btn');
  }

  function getJoinServerError(): HTMLElement | null {
    return document.getElementById('join-server-error');
  }

  function openJoinServerModal(): void {
    const joinServerModal = getJoinServerModal();
    const joinInviteInput = getJoinInviteInput();
    const joinServerError = getJoinServerError();
    const joinServerBtn = getJoinServerBtn();

    if (!joinServerModal) return;
    if (joinInviteInput) joinInviteInput.value = '';
    if (joinServerError) joinServerError.classList.add('hidden');
    if (joinServerBtn) {
      joinServerBtn.disabled = false;
      joinServerBtn.textContent = 'Join';
    }
    joinServerModal.classList.remove('hidden');
    joinInviteInput?.focus();
  }

  function closeJoinServerModal(): void {
    const joinServerModal = getJoinServerModal();
    joinServerModal?.classList.add('hidden');
  }

  function showJoinServerError(message: string): void {
    const joinServerError = getJoinServerError();
    if (joinServerError) {
      joinServerError.textContent = message;
      joinServerError.classList.remove('hidden');
    }
  }

  // Setup event listeners when DOM is ready
  function setupJoinServerEventListeners(): void {
    const joinServerCancelBtn = getJoinServerCancelBtn();
    const joinServerModal = getJoinServerModal();

    joinServerCancelBtn?.addEventListener('click', closeJoinServerModal);
    joinServerModal?.addEventListener('click', (e: Event) => {
      if (e.target === joinServerModal) closeJoinServerModal();
    });
  }

  interface ParsedInvite {
    code: string;
    hostname: string | null;
  }

  function parseInviteInput(input: string): ParsedInvite | null {
    const trimmed = input.trim();
    const urlMatch = trimmed.match(/\/invite\/([A-Za-z0-9]+)\/?$/);
    if (urlMatch) {
      try {
        const url = new URL(trimmed);
        return { code: urlMatch[1], hostname: url.origin };
      } catch {
        return { code: urlMatch[1], hostname: null };
      }
    }
    const codeMatch = trimmed.match(/^[A-Za-z0-9]+$/);
    if (codeMatch) return { code: trimmed, hostname: null };
    return null;
  }

  getJoinServerBtn()?.addEventListener('click', async () => {
    const joinInviteInput = getJoinInviteInput();
    const joinServerBtn = getJoinServerBtn();
    const value = joinInviteInput ? joinInviteInput.value : '';
    if (!value.trim()) {
      showJoinServerError('Please enter an invite link or code');
      return;
    }
    const parsed = parseInviteInput(value);
    if (!parsed) {
      showJoinServerError('Invalid invite link or code');
      return;
    }
    if (joinServerBtn) {
      joinServerBtn.disabled = true;
      joinServerBtn.textContent = 'Loading...';
    }
    closeJoinServerModal();
    await processInviteLink(parsed.code, parsed.hostname);
  });

  getJoinInviteInput()?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') getJoinServerBtn()?.click();
  });

  // ─── Server Header Dropdown ────────────────────────────────────────────────

  const serverHeader = document.getElementById('server-header');
  const serverHeaderMenu = document.getElementById('server-header-menu');
  const invitePeopleBtn = document.getElementById('invite-people-btn');

  if (serverHeader && serverHeaderMenu) {
    serverHeader.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      // Gate dropdown items by permission before showing
      const perms = window.App.myPermissions ?? 0n;
      const activeEmber = window.App.currentEmbers.find(
        (em: Ember) => em.id === window.App.activeEmberId
      );
      const isOwner = activeEmber?.isOwner === true;
      const canManageEmber = (perms & 4n) !== 0n; // ManageEmber (1<<2)
      const canCreateInvites = (perms & 8n) !== 0n; // CreateInvites (1<<3)
      const canManageRoles = (perms & 256n) !== 0n; // ManageRoles (1<<8)
      const inviteEl = document.getElementById('invite-people-btn');
      const editSettingsEl = document.getElementById('edit-ember-settings-btn');
      const editRolesEl = document.getElementById('edit-ember-roles-btn');
      const deleteEl = document.getElementById('delete-ember-btn');
      const sepEl = serverHeaderMenu.querySelector('.server-header-menu-separator');
      if (inviteEl) inviteEl.style.display = canCreateInvites ? '' : 'none';
      if (editSettingsEl) editSettingsEl.style.display = canManageEmber ? '' : 'none';
      if (editRolesEl) editRolesEl.style.display = canManageRoles ? '' : 'none';
      if (deleteEl) deleteEl.style.display = isOwner ? '' : 'none';
      if (sepEl) (sepEl as HTMLElement).style.display = isOwner ? '' : 'none';
      serverHeaderMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e: Event) => {
      if (
        !serverHeaderMenu.classList.contains('hidden') &&
        !serverHeaderMenu.contains(e.target as Node)
      ) {
        serverHeaderMenu.classList.add('hidden');
      }
    });
  }

  // ─── Create Invite Modal ───────────────────────────────────────────────────

  function getCreateInviteModal(): HTMLElement | null {
    return document.getElementById('create-invite-modal');
  }

  function getCreateInviteBtn(): HTMLButtonElement | null {
    return document.getElementById('create-invite-btn') as HTMLButtonElement | null;
  }

  function getCreateInviteCancelBtn(): HTMLElement | null {
    return document.getElementById('create-invite-cancel-btn');
  }

  function getInviteExpirationSelect(): HTMLSelectElement | null {
    return document.getElementById('invite-expiration') as HTMLSelectElement | null;
  }

  function getInviteMaxUsesSelect(): HTMLSelectElement | null {
    return document.getElementById('invite-max-uses') as HTMLSelectElement | null;
  }

  function getInviteLinkResult(): HTMLElement | null {
    return document.getElementById('invite-link-result');
  }

  function getInviteLinkInput(): HTMLInputElement | null {
    return document.getElementById('invite-link-input') as HTMLInputElement | null;
  }

  function getInviteCopyBtn(): HTMLButtonElement | null {
    return document.getElementById('invite-copy-btn') as HTMLButtonElement | null;
  }

  function getCreateInviteError(): HTMLElement | null {
    return document.getElementById('create-invite-error');
  }

  invitePeopleBtn?.addEventListener('click', () => {
    serverHeaderMenu?.classList.add('hidden');
    openCreateInviteModal();
  });

  function openCreateInviteModal(): void {
    const createInviteModal = getCreateInviteModal();
    if (!createInviteModal) return;
    resetCreateInviteForm();
    createInviteModal.classList.remove('hidden');
  }

  function closeCreateInviteModal(): void {
    const createInviteModal = getCreateInviteModal();
    createInviteModal?.classList.add('hidden');
    resetCreateInviteForm();
  }

  function resetCreateInviteForm(): void {
    const inviteExpirationSelect = getInviteExpirationSelect();
    const inviteMaxUsesSelect = getInviteMaxUsesSelect();
    const inviteLinkResult = getInviteLinkResult();
    const inviteLinkInput = getInviteLinkInput();
    const createInviteBtn = getCreateInviteBtn();

    if (inviteExpirationSelect) inviteExpirationSelect.value = '86400';
    if (inviteMaxUsesSelect) inviteMaxUsesSelect.value = '0';
    inviteLinkResult?.classList.add('hidden');
    if (inviteLinkInput) inviteLinkInput.value = '';
    if (createInviteBtn) {
      createInviteBtn.disabled = false;
      createInviteBtn.textContent = 'Generate Link';
    }
    hideCreateInviteError();
  }

  function showCreateInviteError(message: string): void {
    const createInviteError = getCreateInviteError();
    if (createInviteError) {
      createInviteError.textContent = message;
      createInviteError.classList.remove('hidden');
    }
  }

  function hideCreateInviteError(): void {
    const createInviteError = getCreateInviteError();
    createInviteError?.classList.add('hidden');
  }

  // Setup event listeners for create invite modal
  function setupCreateInviteEventListeners(): void {
    const createInviteCancelBtn = getCreateInviteCancelBtn();
    const createInviteModal = getCreateInviteModal();
    const createInviteBtn = getCreateInviteBtn();
    const inviteCopyBtn = getInviteCopyBtn();

    createInviteCancelBtn?.addEventListener('click', closeCreateInviteModal);
    createInviteModal?.addEventListener('click', (e: Event) => {
      if (e.target === createInviteModal) closeCreateInviteModal();
    });
    createInviteBtn?.addEventListener('click', async () => {
      await handleCreateInvite();
    });

    inviteCopyBtn?.addEventListener('click', () => {
      const inviteLinkInput = getInviteLinkInput();
      if (inviteLinkInput?.value) {
        navigator.clipboard.writeText(inviteLinkInput.value).then(() => {
          const inviteCopyBtn = getInviteCopyBtn();
          if (inviteCopyBtn) {
            inviteCopyBtn.textContent = 'Copied!';
            setTimeout(() => {
              const btn = getInviteCopyBtn();
              if (btn) btn.textContent = 'Copy';
            }, 2000);
          }
        });
      }
    });
  }

  async function handleCreateInvite(): Promise<void> {
    const emberId = App.activeEmberId;
    if (!emberId) {
      log.warn('Cannot create invite: no active ember');
      showCreateInviteError('No server selected');
      return;
    }
    log.info('Creating invite', { ember_id: emberId });
    try {
      const createInviteBtn = getCreateInviteBtn();
      if (createInviteBtn) {
        createInviteBtn.disabled = true;
        createInviteBtn.textContent = 'Generating...';
      }
      const auth = (await ipcRenderer.invoke('get-auth')) as {
        token?: string;
        hostname?: string;
      } | null;
      if (!auth || !auth.token || !auth.hostname) {
        showCreateInviteError('Not authenticated');
        return;
      }

      const inviteExpirationSelect = getInviteExpirationSelect();
      const inviteMaxUsesSelect = getInviteMaxUsesSelect();
      const expiresIn = parseInt(inviteExpirationSelect?.value ?? '0') || 0;
      const maxUses = parseInt(inviteMaxUsesSelect?.value ?? '0') || 0;
      const inviteCode = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const requestBody: Record<string, unknown> = {
        code: inviteCode,
      };
      if (expiresIn > 0) requestBody['expiresIn'] = expiresIn;
      if (maxUses > 0) requestBody['maxUses'] = maxUses;

      const response = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errorData.error ?? 'Failed to create invite');
      }
      const data = (await response.json()) as { inviteUrl?: string; inviteId?: string };
      const inviteLinkInput = getInviteLinkInput();
      const inviteLinkResult = getInviteLinkResult();
      if (inviteLinkInput) inviteLinkInput.value = data.inviteUrl ?? '';
      inviteLinkResult?.classList.remove('hidden');

      log.info('Invite created successfully', { ember_id: emberId });

      // Pre-compute CRK packages so joiner can decrypt history even when all members are offline.
      // Uses HKDF(inviteCode) as a symmetric key to encrypt each CRK epoch.
      preComputeCrkPackages(auth.hostname!, auth.token!, emberId, inviteCode, data.inviteId ?? '');
    } catch (error) {
      const err = error as Error;
      log.error('Failed to create invite', {
        ember_id: emberId,
        error: err.message,
      });
      showCreateInviteError(err.message || 'Failed to create invite');
    } finally {
      const createInviteBtn = getCreateInviteBtn();
      if (createInviteBtn) {
        createInviteBtn.disabled = false;
        createInviteBtn.textContent = 'Generate Link';
      }
    }
  }

  // ─── Accept Invite Modal ───────────────────────────────────────────────────

  function getAcceptInviteModal(): HTMLElement | null {
    return document.getElementById('accept-invite-modal');
  }

  function getAcceptInviteCancelBtn(): HTMLElement | null {
    return document.getElementById('accept-invite-cancel-btn');
  }

  function getAcceptInviteJoinBtn(): HTMLButtonElement | null {
    return document.getElementById('accept-invite-join-btn') as HTMLButtonElement | null;
  }

  function getAcceptInviteIcon(): HTMLElement | null {
    return document.getElementById('accept-invite-icon');
  }

  function getAcceptInviteName(): HTMLElement | null {
    return document.getElementById('accept-invite-name');
  }

  function getAcceptInviteMembers(): HTMLElement | null {
    return document.getElementById('accept-invite-members');
  }

  function getAcceptInviteError(): HTMLElement | null {
    return document.getElementById('accept-invite-error');
  }

  interface InviteInfo {
    emberName?: string;
    emberIcon?: string;
    memberCount?: number;
    encryptedEmberKey?: string;
    code: string;
    keySalt?: string;
    hostname?: string;
    protocolVersion?: number;
  }

  function openAcceptInviteModal(inviteInfo: Record<string, unknown>): void {
    log.debug('openAcceptInviteModal called');

    // Validate invite data shape before casting
    if (
      !inviteInfo ||
      typeof inviteInfo !== 'object' ||
      !('code' in inviteInfo) ||
      typeof inviteInfo['code'] !== 'string'
    ) {
      log.error('Invalid invite data: missing required fields', {
        hasCode: String('code' in (inviteInfo ?? {})),
      });
      return;
    }

    const acceptInviteModal = getAcceptInviteModal();
    log.debug('acceptInviteModal element found:', { found: !!acceptInviteModal });
    if (!acceptInviteModal) {
      log.error('acceptInviteModal element not found!');
      return;
    }
    App.pendingInvite = inviteInfo;
    const info = inviteInfo as unknown as InviteInfo;

    const acceptInviteIcon = getAcceptInviteIcon();
    const acceptInviteName = getAcceptInviteName();
    const acceptInviteMembers = getAcceptInviteMembers();
    const acceptInviteError = getAcceptInviteError();
    const acceptInviteJoinBtn = getAcceptInviteJoinBtn();

    log.debug('Populating modal with invite info...');
    if (acceptInviteIcon) {
      while (acceptInviteIcon.firstChild) acceptInviteIcon.removeChild(acceptInviteIcon.firstChild);
      if (info.emberIcon) {
        const img = document.createElement('img');
        img.src = info.emberIcon;
        img.alt = 'icon';
        Object.assign(img.style, {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          borderRadius: '50%',
        });
        acceptInviteIcon.appendChild(img);
      } else {
        acceptInviteIcon.textContent = (info.emberName ?? '?').charAt(0).toUpperCase();
      }
    }
    if (acceptInviteName) acceptInviteName.textContent = info.emberName ?? 'Unknown Server';
    if (acceptInviteMembers) acceptInviteMembers.textContent = `${info.memberCount ?? 0} members`;
    acceptInviteError?.classList.add('hidden');
    if (acceptInviteJoinBtn) {
      acceptInviteJoinBtn.disabled = false;
      acceptInviteJoinBtn.textContent = 'Join Server';
    }
    log.debug('Removing hidden class from modal...');
    acceptInviteModal.classList.remove('hidden');
    log.debug('Modal should now be visible');
  }

  function closeAcceptInviteModal(): void {
    const acceptInviteModal = getAcceptInviteModal();
    acceptInviteModal?.classList.add('hidden');
    App.pendingInvite = null;
  }

  function showAcceptInviteError(message: string): void {
    const acceptInviteError = getAcceptInviteError();
    if (acceptInviteError) {
      acceptInviteError.textContent = message;
      acceptInviteError.classList.remove('hidden');
    }
  }

  // Setup event listeners for accept invite modal
  function setupAcceptInviteEventListeners(): void {
    const acceptInviteCancelBtn = getAcceptInviteCancelBtn();
    const acceptInviteModal = getAcceptInviteModal();
    const acceptInviteJoinBtn = getAcceptInviteJoinBtn();

    acceptInviteCancelBtn?.addEventListener('click', closeAcceptInviteModal);
    acceptInviteModal?.addEventListener('click', (e: Event) => {
      if (e.target === acceptInviteModal) closeAcceptInviteModal();
    });
    acceptInviteJoinBtn?.addEventListener('click', async () => {
      await handleAcceptInvite();
    });
  }

  async function handleAcceptInvite(): Promise<void> {
    if (!App.pendingInvite) return;
    log.info('Accepting invite');
    try {
      const acceptInviteJoinBtn = getAcceptInviteJoinBtn();
      if (acceptInviteJoinBtn) {
        acceptInviteJoinBtn.disabled = true;
        acceptInviteJoinBtn.textContent = 'Joining...';
      }
      const auth = (await ipcRenderer.invoke('get-auth')) as {
        token?: string;
        hostname?: string;
      } | null;
      const device = (await ipcRenderer.invoke('get-device-identity')) as {
        public_key?: string;
        private_key?: string;
      } | null;
      if (!auth || !auth.token || !device) {
        showAcceptInviteError('Not authenticated');
        return;
      }

      const info = App.pendingInvite as unknown as InviteInfo;
      const hostname = info.hostname ?? auth.hostname;
      // Signal ember invites are membership-only; no ember key exchange needed.
      const acceptBody: Record<string, unknown> = {};

      const response = await fetch(`${hostname}/api/v1/invites/${info.code}/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify(acceptBody),
      });
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errorData.error ?? 'Failed to join server');
      }
      const data = (await response.json()) as {
        emberId?: string;
        emberName?: string;
        inviteId?: string;
      };
      if (data.emberId) {
        log.info('Joined server via invite', {
          ember_id: data.emberId,
          name: data.emberName ?? '',
        });
      }

      // Fetch pre-computed CRK packages and sender key distributions from the invite.
      if (data.emberId && data.inviteId && info.code) {
        await fetchPreComputedKeys(hostname!, auth.token!, data.emberId, info.code, data.inviteId);
      }

      closeAcceptInviteModal();
      window.hideWelcomeScreen();
      const embers = await window.fetchEmbers();
      window.renderServerList(embers);
      if (data.emberId) window.switchToServer(data.emberId, data.emberName ?? '');
    } catch (error) {
      const err = error as Error;
      log.error('Failed to accept invite', { error: err.message });
      showAcceptInviteError(err.message || 'Failed to join server');
    } finally {
      const acceptInviteJoinBtn = getAcceptInviteJoinBtn();
      if (acceptInviteJoinBtn) {
        acceptInviteJoinBtn.disabled = false;
        acceptInviteJoinBtn.textContent = 'Join Server';
      }
    }
  }

  async function processInviteLink(code: string, hostname: string | null): Promise<void> {
    log.info('Processing invite link', { hostname, has_code: code.length > 0 });
    try {
      log.debug('Getting auth data...');
      const auth = (await ipcRenderer.invoke('get-auth')) as {
        token?: string;
        hostname?: string;
      } | null;
      log.debug('Auth data retrieved:', { hasAuth: !!auth, hasToken: !!auth?.token });
      if (!auth || !auth.token) {
        log.error('Cannot process invite link: not authenticated');
        return;
      }
      const targetHostname = hostname ?? auth.hostname!;
      log.debug('Making request to:', { targetHostname, has_code: code.length > 0 });
      const response = await fetch(`${targetHostname}/api/v1/invites/${code}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      log.debug('Response received:', { status: response.status, ok: response.ok });
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        log.error('Failed to fetch invite info', { status: response.status });
        console.error('Failed to fetch invite info:', errorData.error ?? response.status);
        return;
      }
      const inviteInfo = (await response.json()) as Record<string, unknown>;
      inviteInfo['hostname'] = targetHostname;
      log.info('Invite info retrieved, opening accept modal', {
        ember_name: String(inviteInfo['emberName'] ?? ''),
      });
      log.debug('Calling openAcceptInviteModal...');
      openAcceptInviteModal(inviteInfo);
      log.debug('openAcceptInviteModal called');
    } catch (error) {
      const err = error as Error;
      log.error('Error processing invite link', { error: err.message });
    }
  }

  // ─── CRK Pre-computation for Invite ────────────────────────────────────────

  async function deriveInviteKey(
    inviteCode: string,
    usage: 'encrypt' | 'decrypt'
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(inviteCode),
      { name: 'HKDF' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode('ember-crk-invite'),
        info: encoder.encode('crk-precompute'),
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      [usage]
    );
  }

  function preComputeCrkPackages(
    hostname: string,
    token: string,
    emberId: string,
    inviteCode: string,
    inviteId: string
  ): void {
    if (!inviteId) return;
    const historyCrypto = (window as unknown as Record<string, unknown>).historyCryptoService as
      | { getCachedCrkEpochs(id: string): Array<{ epoch: number; crk: Uint8Array }> }
      | undefined;
    if (!historyCrypto) return;

    (async () => {
      try {
        const aesKey = await deriveInviteKey(inviteCode, 'encrypt');
        const epochs = historyCrypto.getCachedCrkEpochs(emberId);
        if (epochs.length === 0) return;

        const epochsResp = await fetch(`${hostname}/api/v1/embers/${emberId}/epochs`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!epochsResp.ok) return;
        const epochsData = (await epochsResp.json()) as {
          epochs?: Array<{ id: string; epochNumber: number }>;
        };
        const epochMap = new Map(
          (epochsData.epochs ?? []).map(e => [e.epochNumber, e.id] as const)
        );

        const keyPackages: Array<{ epochId: string; encryptedKeyPackage: string }> = [];
        for (const { epoch, crk } of epochs) {
          const epochId = epochMap.get(epoch);
          if (!epochId) continue;
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const crkBuffer = new Uint8Array(crk).buffer as ArrayBuffer;
          const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, crkBuffer);
          const envelope = JSON.stringify({
            iv: btoa(String.fromCharCode(...iv)),
            ct: btoa(String.fromCharCode(...new Uint8Array(ct))),
            epoch,
          });
          keyPackages.push({ epochId, encryptedKeyPackage: btoa(envelope) });
        }

        if (keyPackages.length === 0) return;

        await fetch(`${hostname}/api/v1/invites/${inviteId}/ephemeral-keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            inviteId,
            emberId,
            epochId: keyPackages[0].epochId,
            keyPackages: keyPackages.map(kp => ({
              encryptedKeyPackage: kp.encryptedKeyPackage,
            })),
          }),
        });
        log.info('CRK packages pre-computed for invite', {
          epochs: keyPackages.length,
        });
      } catch (e) {
        log.warn('CRK pre-computation for invite failed (non-fatal)', { error: String(e) });
      }
    })();
  }

  async function fetchPreComputedKeys(
    hostname: string,
    token: string,
    emberId: string,
    inviteCode: string,
    inviteId: string
  ): Promise<void> {
    if (!inviteId || !inviteCode) return;
    try {
      const ephResp = await fetch(`${hostname}/api/v1/invites/${inviteId}/ephemeral-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (ephResp.ok) {
        const ephData = (await ephResp.json()) as {
          ephemeralKeys?: Array<{ encryptedPackage: string }>;
        };
        const packages = ephData.ephemeralKeys ?? [];
        if (packages.length > 0) {
          const aesKey = await deriveInviteKey(inviteCode, 'decrypt');
          const historyCrypto = (window as unknown as Record<string, unknown>)
            .historyCryptoService as
            | { importCrk(id: string, epoch: number, crk: Uint8Array): void }
            | undefined;
          if (historyCrypto) {
            for (const pkg of packages) {
              try {
                const envelope = JSON.parse(atob(pkg.encryptedPackage)) as {
                  iv: string;
                  ct: string;
                  epoch: number;
                };
                const iv = Uint8Array.from(atob(envelope.iv), c => c.charCodeAt(0));
                const ct = Uint8Array.from(atob(envelope.ct), c => c.charCodeAt(0));
                const crkBytes = new Uint8Array(
                  await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct)
                );
                if (crkBytes.length === 32) {
                  historyCrypto.importCrk(emberId, envelope.epoch, crkBytes);
                  log.info('Imported pre-computed CRK', { epoch: envelope.epoch });
                }
              } catch {
                /* skip malformed package */
              }
            }
          }
        }
      }

      const skResp = await fetch(
        `${hostname}/api/v1/invites/${inviteId}/sender-key-distributions`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (skResp.ok) {
        const skData = (await skResp.json()) as {
          senderKeyDistributions?: Array<{
            senderUserId: string;
            senderDeviceId: string;
            distributionMessage: string;
          }>;
        };
        for (const dist of skData.senderKeyDistributions ?? []) {
          try {
            const senderAddress = `${dist.senderUserId}.${dist.senderDeviceId}`;
            await window.emberAPI.invoke('ProcessSenderKeyDistribution', {
              senderAddress,
              distributionMessage: dist.distributionMessage,
            });
          } catch {
            /* non-fatal */
          }
        }
      }
    } catch (e) {
      log.warn('Pre-computed key fetch failed (will rely on delayed re-wrap)', {
        error: String(e),
      });
    }
  }

  window.openJoinServerModal = openJoinServerModal;
  window.closeJoinServerModal = closeJoinServerModal;
  window.openCreateInviteModal = openCreateInviteModal;
  window.closeCreateInviteModal = closeCreateInviteModal;
  window.openAcceptInviteModal = openAcceptInviteModal;
  window.closeAcceptInviteModal = closeAcceptInviteModal;
  window.processInviteLink = processInviteLink;

  // Setup event listeners when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupJoinServerEventListeners();
      setupCreateInviteEventListeners();
      setupAcceptInviteEventListeners();
    });
  } else {
    // DOM is already ready
    setupJoinServerEventListeners();
    setupCreateInviteEventListeners();
    setupAcceptInviteEventListeners();
  }
})();
