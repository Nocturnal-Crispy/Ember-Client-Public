"use strict";
/**
 * Invite manager — TypeScript conversion of public/invite-manager.js.
 * Handles invite creation, deep link processing, and the accept-invite modal.
 */
(function () {
    const App = window.App;
    const ipcRenderer = window.electronAPI.ipc;
    const log = window.emberLog.createLogger('InviteManager');
    const emberCrypto = window.electronAPI.crypto;
    const naclUtil = window.electronAPI.naclUtil;
    // ─── Join Server Modal ─────────────────────────────────────────────────────
    const joinServerModal = document.getElementById('join-server-modal');
    const joinInviteInput = document.getElementById('join-invite-input');
    const joinServerBtn = document.getElementById('join-server-btn');
    const joinServerCancelBtn = document.getElementById('join-server-cancel-btn');
    const joinServerError = document.getElementById('join-server-error');
    function openJoinServerModal() {
        if (!joinServerModal)
            return;
        if (joinInviteInput)
            joinInviteInput.value = '';
        if (joinServerError)
            joinServerError.classList.add('hidden');
        if (joinServerBtn) {
            joinServerBtn.disabled = false;
            joinServerBtn.textContent = 'Join';
        }
        joinServerModal.classList.remove('hidden');
        joinInviteInput?.focus();
    }
    function closeJoinServerModal() {
        joinServerModal?.classList.add('hidden');
    }
    function showJoinServerError(message) {
        if (joinServerError) {
            joinServerError.textContent = message;
            joinServerError.classList.remove('hidden');
        }
    }
    joinServerCancelBtn?.addEventListener('click', closeJoinServerModal);
    joinServerModal?.addEventListener('click', (e) => { if (e.target === joinServerModal)
        closeJoinServerModal(); });
    function parseInviteInput(input) {
        const trimmed = input.trim();
        const urlMatch = trimmed.match(/\/invite\/([A-Za-z0-9]+)\/?$/);
        if (urlMatch) {
            try {
                const url = new URL(trimmed);
                return { code: urlMatch[1], hostname: url.origin };
            }
            catch (_) {
                return { code: urlMatch[1], hostname: null };
            }
        }
        const codeMatch = trimmed.match(/^[A-Za-z0-9]+$/);
        if (codeMatch)
            return { code: trimmed, hostname: null };
        return null;
    }
    joinServerBtn?.addEventListener('click', async () => {
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
    joinInviteInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            joinServerBtn?.click();
    });
    // ─── Server Header Dropdown ────────────────────────────────────────────────
    const serverHeader = document.getElementById('server-header');
    const serverHeaderMenu = document.getElementById('server-header-menu');
    const invitePeopleBtn = document.getElementById('invite-people-btn');
    if (serverHeader && serverHeaderMenu) {
        serverHeader.addEventListener('click', (e) => {
            e.stopPropagation();
            serverHeaderMenu.classList.toggle('hidden');
        });
        document.addEventListener('click', (e) => {
            if (!serverHeaderMenu.classList.contains('hidden') && !serverHeaderMenu.contains(e.target)) {
                serverHeaderMenu.classList.add('hidden');
            }
        });
    }
    // ─── Create Invite Modal ───────────────────────────────────────────────────
    const createInviteModal = document.getElementById('create-invite-modal');
    const createInviteBtn = document.getElementById('create-invite-btn');
    const createInviteCancelBtn = document.getElementById('create-invite-cancel-btn');
    const inviteExpirationSelect = document.getElementById('invite-expiration');
    const inviteMaxUsesSelect = document.getElementById('invite-max-uses');
    const inviteLinkResult = document.getElementById('invite-link-result');
    const inviteLinkInput = document.getElementById('invite-link-input');
    const inviteCopyBtn = document.getElementById('invite-copy-btn');
    const createInviteError = document.getElementById('create-invite-error');
    invitePeopleBtn?.addEventListener('click', () => {
        serverHeaderMenu?.classList.add('hidden');
        openCreateInviteModal();
    });
    function openCreateInviteModal() {
        if (!createInviteModal)
            return;
        resetCreateInviteForm();
        createInviteModal.classList.remove('hidden');
    }
    function closeCreateInviteModal() {
        createInviteModal?.classList.add('hidden');
        resetCreateInviteForm();
    }
    function resetCreateInviteForm() {
        if (inviteExpirationSelect)
            inviteExpirationSelect.value = '86400';
        if (inviteMaxUsesSelect)
            inviteMaxUsesSelect.value = '0';
        inviteLinkResult?.classList.add('hidden');
        if (inviteLinkInput)
            inviteLinkInput.value = '';
        if (createInviteBtn) {
            createInviteBtn.disabled = false;
            createInviteBtn.textContent = 'Generate Link';
        }
        hideCreateInviteError();
    }
    function showCreateInviteError(message) {
        if (createInviteError) {
            createInviteError.textContent = message;
            createInviteError.classList.remove('hidden');
        }
    }
    function hideCreateInviteError() {
        createInviteError?.classList.add('hidden');
    }
    createInviteCancelBtn?.addEventListener('click', closeCreateInviteModal);
    createInviteModal?.addEventListener('click', (e) => { if (e.target === createInviteModal)
        closeCreateInviteModal(); });
    createInviteBtn?.addEventListener('click', async () => { await handleCreateInvite(); });
    inviteCopyBtn?.addEventListener('click', () => {
        if (inviteLinkInput?.value) {
            navigator.clipboard.writeText(inviteLinkInput.value).then(() => {
                if (inviteCopyBtn) {
                    inviteCopyBtn.textContent = 'Copied!';
                    setTimeout(() => { if (inviteCopyBtn)
                        inviteCopyBtn.textContent = 'Copy'; }, 2000);
                }
            });
        }
    });
    async function handleCreateInvite() {
        if (!App.activeEmberId) {
            log.warn('Cannot create invite: no active ember');
            showCreateInviteError('No server selected');
            return;
        }
        const emberKey = App.emberKeyCache.get(App.activeEmberId);
        if (!emberKey) {
            log.error('Cannot create invite: ember key not in cache', { ember_id: App.activeEmberId });
            showCreateInviteError('Ember key not available');
            return;
        }
        log.info('Creating invite', { ember_id: App.activeEmberId });
        try {
            if (createInviteBtn) {
                createInviteBtn.disabled = true;
                createInviteBtn.textContent = 'Generating...';
            }
            const auth = await ipcRenderer.invoke('get-auth');
            if (!auth || !auth.token || !auth.hostname) {
                showCreateInviteError('Not authenticated');
                return;
            }
            const expiresIn = parseInt(inviteExpirationSelect?.value ?? '0') || 0;
            const maxUses = parseInt(inviteMaxUsesSelect?.value ?? '0') || 0;
            const inviteCode = Array.from(crypto.getRandomValues(new Uint8Array(4)))
                .map(b => b.toString(16).padStart(2, '0')).join('');
            const inviteKeyData = await emberCrypto.encryptEmberKeyForInvite(emberKey, inviteCode);
            const requestBody = {
                code: inviteCode,
                encrypted_ember_key: inviteKeyData.encrypted,
                key_salt: inviteKeyData.salt
            };
            if (expiresIn > 0)
                requestBody['expires_in'] = expiresIn;
            if (maxUses > 0)
                requestBody['max_uses'] = maxUses;
            const response = await fetch(`${auth.hostname}/api/v1/embers/${App.activeEmberId}/invites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
                body: JSON.stringify(requestBody)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error ?? 'Failed to create invite');
            }
            const data = await response.json();
            if (inviteLinkInput)
                inviteLinkInput.value = data.invite_url ?? '';
            inviteLinkResult?.classList.remove('hidden');
            log.info('Invite created successfully', { ember_id: App.activeEmberId });
        }
        catch (error) {
            const err = error;
            log.error('Failed to create invite', { ember_id: App.activeEmberId ?? '', error: err.message });
            showCreateInviteError(err.message || 'Failed to create invite');
        }
        finally {
            if (createInviteBtn) {
                createInviteBtn.disabled = false;
                createInviteBtn.textContent = 'Generate Link';
            }
        }
    }
    // ─── Accept Invite Modal ───────────────────────────────────────────────────
    const acceptInviteModal = document.getElementById('accept-invite-modal');
    const acceptInviteCancelBtn = document.getElementById('accept-invite-cancel-btn');
    const acceptInviteJoinBtn = document.getElementById('accept-invite-join-btn');
    const acceptInviteIcon = document.getElementById('accept-invite-icon');
    const acceptInviteName = document.getElementById('accept-invite-name');
    const acceptInviteMembers = document.getElementById('accept-invite-members');
    const acceptInviteError = document.getElementById('accept-invite-error');
    function openAcceptInviteModal(inviteInfo) {
        if (!acceptInviteModal)
            return;
        App.pendingInvite = inviteInfo;
        const info = inviteInfo;
        if (acceptInviteIcon) {
            while (acceptInviteIcon.firstChild)
                acceptInviteIcon.removeChild(acceptInviteIcon.firstChild);
            if (info.ember_icon) {
                const img = document.createElement('img');
                img.src = info.ember_icon;
                img.alt = 'icon';
                Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' });
                acceptInviteIcon.appendChild(img);
            }
            else {
                acceptInviteIcon.textContent = (info.ember_name ?? '?').charAt(0).toUpperCase();
            }
        }
        if (acceptInviteName)
            acceptInviteName.textContent = info.ember_name ?? 'Unknown Server';
        if (acceptInviteMembers)
            acceptInviteMembers.textContent = `${info.member_count ?? 0} members`;
        acceptInviteError?.classList.add('hidden');
        if (acceptInviteJoinBtn) {
            acceptInviteJoinBtn.disabled = false;
            acceptInviteJoinBtn.textContent = 'Join Server';
        }
        acceptInviteModal.classList.remove('hidden');
    }
    function closeAcceptInviteModal() {
        acceptInviteModal?.classList.add('hidden');
        App.pendingInvite = null;
    }
    function showAcceptInviteError(message) {
        if (acceptInviteError) {
            acceptInviteError.textContent = message;
            acceptInviteError.classList.remove('hidden');
        }
    }
    acceptInviteCancelBtn?.addEventListener('click', closeAcceptInviteModal);
    acceptInviteModal?.addEventListener('click', (e) => { if (e.target === acceptInviteModal)
        closeAcceptInviteModal(); });
    acceptInviteJoinBtn?.addEventListener('click', async () => { await handleAcceptInvite(); });
    async function handleAcceptInvite() {
        if (!App.pendingInvite)
            return;
        log.info('Accepting invite');
        try {
            if (acceptInviteJoinBtn) {
                acceptInviteJoinBtn.disabled = true;
                acceptInviteJoinBtn.textContent = 'Joining...';
            }
            const auth = await ipcRenderer.invoke('get-auth');
            const device = await ipcRenderer.invoke('get-device-identity');
            if (!auth || !auth.token || !device) {
                showAcceptInviteError('Not authenticated');
                return;
            }
            const info = App.pendingInvite;
            const hostname = info.hostname ?? auth.hostname;
            const emberKey = await emberCrypto.decryptEmberKeyFromInvite(info.encrypted_ember_key, info.code, info.key_salt);
            if (!emberKey) {
                log.error('Failed to decrypt ember key from invite');
                showAcceptInviteError('Failed to decrypt ember key from invite');
                return;
            }
            log.debug('Ember key decrypted from invite successfully');
            const publicKeyBytes = naclUtil.decodeBase64(device.public_key);
            const privateKeyBytes = naclUtil.decodeBase64(device.private_key);
            const encryptedEmberKey = emberCrypto.encryptEmberKeyForUser(emberKey, publicKeyBytes, privateKeyBytes);
            const response = await fetch(`${hostname}/api/v1/invites/${info.code}/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
                body: JSON.stringify({ encrypted_ember_key: encryptedEmberKey })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error ?? 'Failed to join server');
            }
            const data = await response.json();
            if (data.ember_id) {
                App.emberKeyCache.set(data.ember_id, emberKey);
                log.info('Joined server via invite', { ember_id: data.ember_id, name: data.ember_name ?? '' });
            }
            closeAcceptInviteModal();
            window.hideWelcomeScreen();
            const embers = await window.fetchEmbers();
            window.renderServerList(embers);
            if (data.ember_id)
                window.switchToServer(data.ember_id, data.ember_name ?? '');
        }
        catch (error) {
            const err = error;
            log.error('Failed to accept invite', { error: err.message });
            showAcceptInviteError(err.message || 'Failed to join server');
        }
        finally {
            if (acceptInviteJoinBtn) {
                acceptInviteJoinBtn.disabled = false;
                acceptInviteJoinBtn.textContent = 'Join Server';
            }
        }
    }
    async function processInviteLink(code, hostname) {
        log.info('Processing invite link');
        try {
            const auth = await ipcRenderer.invoke('get-auth');
            if (!auth || !auth.token) {
                log.error('Cannot process invite link: not authenticated');
                return;
            }
            const targetHostname = hostname ?? auth.hostname;
            const response = await fetch(`${targetHostname}/api/v1/invites/${code}`, {
                method: 'GET', headers: { 'Authorization': `Bearer ${auth.token}` }
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                log.error('Failed to fetch invite info', { status: response.status });
                console.error('Failed to fetch invite info:', errorData.error ?? response.status);
                return;
            }
            const inviteInfo = await response.json();
            inviteInfo['hostname'] = targetHostname;
            log.info('Invite info retrieved, opening accept modal', { ember_name: String(inviteInfo['ember_name'] ?? '') });
            openAcceptInviteModal(inviteInfo);
        }
        catch (error) {
            const err = error;
            log.error('Error processing invite link', { error: err.message });
        }
    }
    ipcRenderer.on('handle-invite-link', (_event, ...args) => {
        log.info('Received invite link from main process');
        const invite = args[0];
        processInviteLink(invite.code, invite.hostname);
    });
    window.openJoinServerModal = openJoinServerModal;
    window.closeJoinServerModal = closeJoinServerModal;
    window.openCreateInviteModal = openCreateInviteModal;
    window.closeCreateInviteModal = closeCreateInviteModal;
    window.openAcceptInviteModal = openAcceptInviteModal;
    window.closeAcceptInviteModal = closeAcceptInviteModal;
    window.processInviteLink = processInviteLink;
})();
