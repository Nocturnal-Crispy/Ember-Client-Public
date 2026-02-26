"use strict";
/**
 * Ember manager — TypeScript conversion of public/ember-manager.js.
 * Handles ember fetch, server list rendering, server creation, and ember key management.
 */
(function () {
    const App = window.App;
    const ipcRenderer = window.electronAPI.ipc;
    const log = window.emberLog.createLogger('EmberManager');
    const emberCrypto = window.electronAPI.crypto;
    const naclUtil = window.electronAPI.naclUtil;
    // ─── Ember fetch, render, switch ──────────────────────────────────────────
    async function fetchEmbers() {
        log.debug('Fetching embers list');
        try {
            const auth = await ipcRenderer.invoke('get-auth');
            if (!auth || !auth.token || !auth.hostname) {
                log.error('Cannot fetch embers: not authenticated');
                return [];
            }
            const response = await fetch(`${auth.hostname}/api/v1/embers`, {
                method: 'GET', headers: { 'Authorization': `Bearer ${auth.token}` }
            });
            if (!response.ok) {
                log.error('Failed to fetch embers', { status: response.status });
                return [];
            }
            const data = await response.json();
            const embers = data.embers ?? [];
            log.info('Embers fetched', { count: embers.length });
            return embers;
        }
        catch (error) {
            const err = error;
            log.error('Error fetching embers', { error: err.message });
            return [];
        }
    }
    function renderServerList(embers) {
        const serverList = document.querySelector('.server-list');
        if (!serverList)
            return;
        const addServerBtn = serverList.querySelector('.add-server');
        const separator = serverList.querySelector('.server-separator');
        serverList.querySelectorAll('.server-icon:not(.add-server)').forEach(el => el.remove());
        embers.forEach((ember, index) => {
            const serverIcon = document.createElement('div');
            serverIcon.className = 'server-icon';
            serverIcon.dataset['emberId'] = ember.id;
            if (index === 0 && !App.activeEmberId) {
                serverIcon.classList.add('active');
                App.activeEmberId = ember.id;
                loadServerContent(ember.id, ember.name);
            }
            else if (ember.id === App.activeEmberId) {
                serverIcon.classList.add('active');
            }
            if (ember.icon_data) {
                const img = document.createElement('img');
                img.src = ember.icon_data;
                img.alt = ember.name;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                serverIcon.appendChild(img);
            }
            else {
                const initial = document.createElement('span');
                initial.textContent = ember.name.charAt(0).toUpperCase();
                serverIcon.appendChild(initial);
            }
            serverIcon.addEventListener('click', () => switchToServer(ember.id, ember.name));
            if (separator) {
                serverList.insertBefore(serverIcon, separator);
            }
            else {
                serverList.insertBefore(serverIcon, addServerBtn);
            }
        });
        App.currentEmbers = embers;
    }
    function switchToServer(emberId, emberName) {
        log.info('Switching to server', { ember_id: emberId, name: emberName });
        document.querySelectorAll('.server-icon').forEach(icon => {
            if (icon.dataset['emberId'] === emberId) {
                icon.classList.add('active');
            }
            else {
                icon.classList.remove('active');
            }
        });
        App.activeEmberId = emberId;
        loadServerContent(emberId, emberName);
    }
    async function fetchEmberKey(emberId) {
        if (App.emberKeyCache.has(emberId)) {
            log.debug('Ember key cache hit', { ember_id: emberId });
            return App.emberKeyCache.get(emberId) ?? null;
        }
        log.debug('Fetching ember key from server', { ember_id: emberId });
        try {
            const auth = await ipcRenderer.invoke('get-auth');
            const device = await ipcRenderer.invoke('get-device-identity');
            if (!auth || !auth.token || !auth.hostname || !device) {
                log.error('Cannot fetch ember key: missing auth or device identity');
                return null;
            }
            const response = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/key`, {
                method: 'GET', headers: { 'Authorization': `Bearer ${auth.token}` }
            });
            if (!response.ok) {
                log.error('Failed to fetch ember key', { status: response.status, ember_id: emberId });
                return null;
            }
            const data = await response.json();
            const privateKey = naclUtil.decodeBase64(device.private_key);
            const publicKey = naclUtil.decodeBase64(device.public_key);
            const emberKey = emberCrypto.decryptEmberKeyForUser(data.encrypted_key, publicKey, privateKey);
            if (emberKey) {
                App.emberKeyCache.set(emberId, emberKey);
                log.info('Ember key fetched and cached', { ember_id: emberId });
            }
            else {
                log.error('Ember key decryption failed', { ember_id: emberId });
            }
            return emberKey;
        }
        catch (error) {
            const err = error;
            log.error('Error fetching ember key', { ember_id: emberId, error: err.message });
            return null;
        }
    }
    async function loadServerContent(emberId, emberName) {
        const serverHeader = document.querySelector('.server-header h3');
        if (serverHeader)
            serverHeader.textContent = emberName;
        await fetchEmberKey(emberId);
        const [channels, categories] = await Promise.all([
            window.fetchChannels(emberId),
            window.fetchCategories(emberId)
        ]);
        window.renderChannels(channels, categories);
        const members = await window.fetchMembers(emberId);
        window.renderMemberList(members);
        window.wsSubscribeToEmber(emberId);
    }
    // ─── Create Server Modal ───────────────────────────────────────────────────
    const createServerModal = document.getElementById('create-server-modal');
    const createServerBtn = document.getElementById('create-server-btn');
    const createServerCancelBtn = document.getElementById('create-server-cancel-btn');
    const serverNameInput = document.getElementById('server-name-input');
    const serverIconUpload = document.getElementById('server-icon-upload');
    const uploadIconBtn = document.getElementById('upload-icon-btn');
    const serverIconUrl = document.getElementById('server-icon-url');
    const loadUrlBtn = document.getElementById('load-url-btn');
    const iconPreview = document.getElementById('icon-preview');
    const removeIconBtn = document.getElementById('remove-icon-btn');
    const createServerError = document.getElementById('create-server-error');
    const uploadSection = document.getElementById('upload-section');
    const urlSection = document.getElementById('url-section');
    const iconToggleBtns = document.querySelectorAll('.icon-toggle-btn');
    const addServerBtn = document.querySelector('.add-server');
    const addServerModal = document.getElementById('add-server-modal');
    const addServerCreateBtn = document.getElementById('add-server-create-btn');
    const addServerJoinBtn = document.getElementById('add-server-join-btn');
    const addServerCancelBtn = document.getElementById('add-server-cancel-btn');
    addServerBtn?.addEventListener('click', () => { addServerModal?.classList.remove('hidden'); });
    addServerCancelBtn?.addEventListener('click', () => { addServerModal?.classList.add('hidden'); });
    addServerModal?.addEventListener('click', (e) => { if (e.target === addServerModal)
        addServerModal?.classList.add('hidden'); });
    addServerCreateBtn?.addEventListener('click', () => { addServerModal?.classList.add('hidden'); openCreateServerModal(); });
    addServerJoinBtn?.addEventListener('click', () => { addServerModal?.classList.add('hidden'); window.openJoinServerModal(); });
    function openCreateServerModal() {
        if (createServerModal) {
            createServerModal.classList.remove('hidden');
            resetCreateServerForm();
        }
    }
    function closeCreateServerModal() {
        if (createServerModal) {
            createServerModal.classList.add('hidden');
            resetCreateServerForm();
        }
    }
    function resetCreateServerForm() {
        if (serverNameInput)
            serverNameInput.value = '';
        if (serverIconUrl)
            serverIconUrl.value = '';
        if (serverIconUpload)
            serverIconUpload.value = '';
        App.currentIconData = null;
        updateIconPreview(null);
        hideCreateServerError();
        App.currentIconSource = 'upload';
        updateIconSourceUI();
    }
    function updateIconSourceUI() {
        iconToggleBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset['source'] === App.currentIconSource);
        });
        if (App.currentIconSource === 'upload') {
            uploadSection?.classList.remove('hidden');
            urlSection?.classList.add('hidden');
        }
        else {
            uploadSection?.classList.add('hidden');
            urlSection?.classList.remove('hidden');
        }
    }
    iconToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            App.currentIconSource = (btn.dataset['source'] ?? 'upload');
            updateIconSourceUI();
            App.currentIconData = null;
            updateIconPreview(null);
        });
    });
    uploadIconBtn?.addEventListener('click', () => serverIconUpload?.click());
    serverIconUpload?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const resizedBase64 = await resizeImage(file, 512, 512);
                App.currentIconData = resizedBase64;
                updateIconPreview(resizedBase64);
            }
            catch (error) {
                showCreateServerError('Failed to process image');
                console.error('Image processing error:', error);
            }
        }
    });
    loadUrlBtn?.addEventListener('click', async () => {
        const url = serverIconUrl?.value.trim();
        if (!url) {
            showCreateServerError('Please enter an image URL');
            return;
        }
        if (!isValidUrl(url)) {
            showCreateServerError('Please enter a valid URL');
            return;
        }
        try {
            App.currentIconData = url;
            updateIconPreview(url);
        }
        catch (error) {
            showCreateServerError('Failed to load image from URL');
        }
    });
    removeIconBtn?.addEventListener('click', () => {
        App.currentIconData = null;
        updateIconPreview(null);
        if (serverIconUpload)
            serverIconUpload.value = '';
        if (serverIconUrl)
            serverIconUrl.value = '';
    });
    function updateIconPreview(data) {
        if (!iconPreview)
            return;
        while (iconPreview.firstChild)
            iconPreview.removeChild(iconPreview.firstChild);
        if (data) {
            const img = document.createElement('img');
            img.src = data;
            img.onerror = () => {
                while (iconPreview.firstChild)
                    iconPreview.removeChild(iconPreview.firstChild);
                const span = document.createElement('span');
                span.className = 'preview-placeholder';
                span.textContent = 'Failed to load image';
                iconPreview.appendChild(span);
                removeIconBtn?.classList.add('hidden');
            };
            img.onload = () => removeIconBtn?.classList.remove('hidden');
            iconPreview.appendChild(img);
        }
        else {
            const span = document.createElement('span');
            span.className = 'preview-placeholder';
            span.textContent = 'No icon selected';
            iconPreview.appendChild(span);
            removeIconBtn?.classList.add('hidden');
        }
    }
    function isValidUrl(string) {
        try {
            const url = new URL(string);
            return url.protocol === 'http:' || url.protocol === 'https:';
        }
        catch (_) {
            return false;
        }
    }
    async function resizeImage(file, maxWidth, maxHeight) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width, height = img.height;
                    if (width > maxWidth || height > maxHeight) {
                        const ratio = width / height;
                        if (width > height) {
                            width = maxWidth;
                            height = width / ratio;
                        }
                        else {
                            height = maxHeight;
                            width = height * ratio;
                        }
                    }
                    canvas.width = maxWidth;
                    canvas.height = maxHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#2f3136';
                    ctx.fillRect(0, 0, maxWidth, maxHeight);
                    ctx.drawImage(img, (maxWidth - width) / 2, (maxHeight - height) / 2, width, height);
                    resolve(canvas.toDataURL(file.type || 'image/png'));
                };
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }
    createServerCancelBtn?.addEventListener('click', closeCreateServerModal);
    createServerModal?.addEventListener('click', (e) => { if (e.target === createServerModal)
        closeCreateServerModal(); });
    createServerBtn?.addEventListener('click', async () => { await handleCreateServer(); });
    async function handleCreateServer() {
        const serverName = serverNameInput?.value.trim();
        if (!serverName) {
            log.warn('Create server validation failed: name required');
            showCreateServerError('Server name is required');
            return;
        }
        if (serverName.length > 100) {
            log.warn('Create server validation failed: name too long');
            showCreateServerError('Server name must be 100 characters or less');
            return;
        }
        log.info('Creating new server', { name: serverName });
        try {
            if (createServerBtn) {
                createServerBtn.disabled = true;
                createServerBtn.textContent = 'Creating...';
            }
            const auth = await ipcRenderer.invoke('get-auth');
            if (!auth || !auth.token || !auth.hostname) {
                showCreateServerError('Not authenticated');
                return;
            }
            const device = await ipcRenderer.invoke('get-device-identity');
            if (!device) {
                showCreateServerError('Device identity not found');
                return;
            }
            const emberKey = emberCrypto.generateEmberKey();
            const publicKeyBytes = naclUtil.decodeBase64(device.public_key);
            const privateKeyBytes = naclUtil.decodeBase64(device.private_key);
            const encryptedEmberKey = emberCrypto.encryptEmberKeyForUser(emberKey, publicKeyBytes, privateKeyBytes);
            const requestBody = { name: serverName, encrypted_ember_key: encryptedEmberKey };
            if (App.currentIconData)
                requestBody['icon_data'] = App.currentIconData;
            const response = await fetch(`${auth.hostname}/api/v1/embers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
                body: JSON.stringify(requestBody)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error ?? 'Failed to create server');
            }
            const newEmber = await response.json();
            if (newEmber.id)
                App.emberKeyCache.set(newEmber.id, emberKey);
            closeCreateServerModal();
            log.info('Server created successfully', { ember_id: newEmber.id ?? '', name: newEmber.name ?? '' });
            window.hideWelcomeScreen();
            const embers = await fetchEmbers();
            renderServerList(embers);
            if (newEmber.id)
                switchToServer(newEmber.id, newEmber.name ?? '');
        }
        catch (error) {
            const err = error;
            log.error('Failed to create server', { error: err.message });
            showCreateServerError(err.message || 'Failed to create server');
        }
        finally {
            if (createServerBtn) {
                createServerBtn.disabled = false;
                createServerBtn.textContent = 'Create Server';
            }
        }
    }
    function showCreateServerError(message) {
        if (createServerError) {
            createServerError.textContent = message;
            createServerError.classList.remove('hidden');
        }
    }
    function hideCreateServerError() {
        createServerError?.classList.add('hidden');
    }
    window.fetchEmbers = fetchEmbers;
    window.renderServerList = renderServerList;
    window.switchToServer = switchToServer;
    window.fetchEmberKey = fetchEmberKey;
    window.loadServerContent = loadServerContent;
    window.openCreateServerModal = openCreateServerModal;
    window.closeCreateServerModal = closeCreateServerModal;
})();
