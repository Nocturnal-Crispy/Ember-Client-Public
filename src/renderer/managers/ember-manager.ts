/**
 * Ember manager — TypeScript conversion of public/ember-manager.js.
 * Handles ember fetch, server list rendering, server creation, and ember key management.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('EmberManager');
  const emberCrypto = window.electronAPI.crypto;
  const naclUtil = window.electronAPI.naclUtil;

  // ─── Ember order (localStorage) ───────────────────────────────────────────

  const EMBER_ORDER_KEY = 'ember_order';

  function saveEmberOrder(): void {
    const icons = document.querySelectorAll<HTMLElement>('.server-icon:not(.add-server)');
    const order = Array.from(icons).map(el => el.dataset['emberId']);
    localStorage.setItem(EMBER_ORDER_KEY, JSON.stringify(order));
  }

  function sortEmbersByOrder(embers: Ember[]): Ember[] {
    try {
      const order = JSON.parse(localStorage.getItem(EMBER_ORDER_KEY) || '[]') as string[];
      if (!order.length) return embers;
      return [...embers].sort((a, b) => {
        const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    } catch { return embers; }
  }

  function clearEmberDragHighlights(): void {
    document.querySelectorAll<HTMLElement>('.server-icon.drag-over-ember')
      .forEach(el => el.classList.remove('drag-over-ember'));
  }

  // ─── Ember fetch, render, switch ──────────────────────────────────────────

  async function fetchEmbers(): Promise<Ember[]> {
    log.debug('Fetching embers list');
    try {
      const auth = await ipcRenderer.invoke('get-auth') as AuthData | null;
      if (!auth || !auth.token || !auth.hostname) {
        log.error('Cannot fetch embers: not authenticated');
        return [];
      }
      const embers = await window.electronAPI.emberService.fetchEmbers(auth);
      log.info('Embers fetched', { count: embers.length });
      return embers;
    } catch (error) {
      const err = error as Error;
      log.error('Error fetching embers', { error: err.message });
      return [];
    }
  }

  function renderServerList(embers: Ember[]): void {
    embers = sortEmbersByOrder(embers);
    const serverList = document.querySelector('.server-list');
    if (!serverList) return;

    const addServerBtn = serverList.querySelector('.add-server');
    const separator = serverList.querySelector('.server-separator');

    serverList.querySelectorAll<HTMLElement>('.server-icon:not(.add-server)').forEach(el => el.remove());

    embers.forEach((ember, index) => {
      const serverIcon = document.createElement('div');
      serverIcon.className = 'server-icon';
      serverIcon.dataset['emberId'] = ember.id;

      if (index === 0 && !App.activeEmberId) {
        serverIcon.classList.add('active');
        App.activeEmberId = ember.id;
        loadServerContent(ember.id, ember.name);
      } else if (ember.id === App.activeEmberId) {
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
      } else {
        const initial = document.createElement('span');
        initial.textContent = ember.name.charAt(0).toUpperCase();
        serverIcon.appendChild(initial);
      }

      serverIcon.addEventListener('click', () => switchToServer(ember.id, ember.name));

      // Drag-and-drop (client-side reorder only)
      serverIcon.setAttribute('draggable', 'true');
      serverIcon.addEventListener('dragstart', (e: DragEvent) => {
        App.dragItem = { type: 'ember', id: ember.id };
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        serverIcon.classList.add('dragging');
      });
      serverIcon.addEventListener('dragend', () => {
        serverIcon.classList.remove('dragging');
        clearEmberDragHighlights();
        saveEmberOrder();
      });
      serverIcon.addEventListener('dragover', (e: DragEvent) => {
        if (!App.dragItem || App.dragItem.type !== 'ember') return;
        e.preventDefault();
        clearEmberDragHighlights();
        serverIcon.classList.add('drag-over-ember');
      });
      serverIcon.addEventListener('dragleave', () => serverIcon.classList.remove('drag-over-ember'));
      serverIcon.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
        clearEmberDragHighlights();
        if (!App.dragItem || App.dragItem.type !== 'ember' || App.dragItem.id === ember.id) return;
        const draggedId = App.dragItem.id;
        App.dragItem = null;
        const list = document.querySelector('.server-list');
        const draggedEl = list?.querySelector<HTMLElement>(`.server-icon[data-ember-id="${draggedId}"]`);
        if (draggedEl) list!.insertBefore(draggedEl, serverIcon);
        saveEmberOrder();
      });

      // Right-click context menu (owners only)
      serverIcon.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        if (ember.is_owner) showEmberContextMenu(e.clientX, e.clientY, ember);
      });

      if (separator) {
        serverList.insertBefore(serverIcon, separator);
      } else {
        serverList.insertBefore(serverIcon, addServerBtn);
      }
    });

    App.currentEmbers = embers;
  }

  function switchToServer(emberId: string, emberName: string): void {
    log.info('Switching to server', { ember_id: emberId, name: emberName });
    document.querySelectorAll<HTMLElement>('.server-icon').forEach(icon => {
      if (icon.dataset['emberId'] === emberId) {
        icon.classList.add('active');
      } else {
        icon.classList.remove('active');
      }
    });
    App.activeEmberId = emberId;
    loadServerContent(emberId, emberName);
  }

  async function fetchEmberKey(emberId: string): Promise<Uint8Array | null> {
    if (App.emberKeyCache.has(emberId)) {
      log.debug('Ember key cache hit', { ember_id: emberId });
      return App.emberKeyCache.get(emberId) ?? null;
    }
    log.debug('Fetching ember key from server', { ember_id: emberId });
    try {
      const auth = await ipcRenderer.invoke('get-auth') as { token?: string; hostname?: string } | null;
      const device = await ipcRenderer.invoke('get-device-identity') as { private_key?: string; public_key?: string } | null;
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
      const data = await response.json() as { encrypted_key: string };
      const privateKey = naclUtil.decodeBase64(device.private_key!);
      const publicKey  = naclUtil.decodeBase64(device.public_key!);
      const emberKey = emberCrypto.decryptEmberKeyForUser(data.encrypted_key, publicKey, privateKey);
      if (emberKey) {
        App.emberKeyCache.set(emberId, emberKey);
        log.info('Ember key fetched and cached', { ember_id: emberId });
      } else {
        log.error('Ember key decryption failed', { ember_id: emberId });
      }
      return emberKey;
    } catch (error) {
      const err = error as Error;
      log.error('Error fetching ember key', { ember_id: emberId, error: err.message });
      return null;
    }
  }

  async function loadServerContent(emberId: string, emberName: string): Promise<void> {
    const serverHeader = document.querySelector('.server-header h3');
    if (serverHeader) serverHeader.textContent = emberName;

    await fetchEmberKey(emberId);
    const auth = await ipcRenderer.invoke('get-auth') as AuthData | null;
    let channels: Channel[] = [];
    let categories: Category[] = [];
    if (auth && auth.token && auth.hostname) {
      const result = await window.electronAPI.channelService.fetchChannels(auth, emberId);
      channels = result.channels;
      categories = result.categories;
    }
    window.renderChannels(channels, categories);
    const members = await window.fetchMembers(emberId);
    window.renderMemberList(members);
    window.wsSubscribeToEmber(emberId);
  }

  // ─── Create Server Modal ───────────────────────────────────────────────────

  const createServerModal    = document.getElementById('create-server-modal');
  const createServerBtn      = document.getElementById('create-server-btn') as HTMLButtonElement | null;
  const createServerCancelBtn = document.getElementById('create-server-cancel-btn');
  const serverNameInput      = document.getElementById('server-name-input') as HTMLInputElement | null;
  const serverIconUpload     = document.getElementById('server-icon-upload') as HTMLInputElement | null;
  const uploadIconBtn        = document.getElementById('upload-icon-btn');
  const serverIconUrl        = document.getElementById('server-icon-url') as HTMLInputElement | null;
  const loadUrlBtn           = document.getElementById('load-url-btn');
  const iconPreview          = document.getElementById('icon-preview');
  const removeIconBtn        = document.getElementById('remove-icon-btn');
  const createServerError    = document.getElementById('create-server-error');
  const uploadSection        = document.getElementById('upload-section');
  const urlSection           = document.getElementById('url-section');
  const iconToggleBtns       = document.querySelectorAll<HTMLElement>('.icon-toggle-btn');
  const addServerBtn         = document.querySelector<HTMLElement>('.add-server');

  const addServerModal       = document.getElementById('add-server-modal');
  const addServerCreateBtn   = document.getElementById('add-server-create-btn');
  const addServerJoinBtn     = document.getElementById('add-server-join-btn');
  const addServerCancelBtn   = document.getElementById('add-server-cancel-btn');

  addServerBtn?.addEventListener('click', () => { addServerModal?.classList.remove('hidden'); });
  addServerCancelBtn?.addEventListener('click', () => { addServerModal?.classList.add('hidden'); });
  addServerModal?.addEventListener('click', (e: Event) => { if (e.target === addServerModal) addServerModal?.classList.add('hidden'); });
  addServerCreateBtn?.addEventListener('click', () => { addServerModal?.classList.add('hidden'); openCreateServerModal(); });
  addServerJoinBtn?.addEventListener('click', () => { addServerModal?.classList.add('hidden'); window.openJoinServerModal(); });

  function openCreateServerModal(): void {
    if (createServerModal) { createServerModal.classList.remove('hidden'); resetCreateServerForm(); }
  }

  function closeCreateServerModal(): void {
    if (createServerModal) { createServerModal.classList.add('hidden'); resetCreateServerForm(); }
  }

  function resetCreateServerForm(): void {
    if (serverNameInput) serverNameInput.value = '';
    if (serverIconUrl) serverIconUrl.value = '';
    if (serverIconUpload) serverIconUpload.value = '';
    App.currentIconData = null;
    updateIconPreview(null);
    hideCreateServerError();
    App.currentIconSource = 'upload';
    updateIconSourceUI();
  }

  function updateIconSourceUI(): void {
    iconToggleBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset['source'] === App.currentIconSource);
    });
    if (App.currentIconSource === 'upload') {
      uploadSection?.classList.remove('hidden');
      urlSection?.classList.add('hidden');
    } else {
      uploadSection?.classList.add('hidden');
      urlSection?.classList.remove('hidden');
    }
  }

  iconToggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      App.currentIconSource = (btn.dataset['source'] ?? 'upload') as 'upload' | 'url';
      updateIconSourceUI();
      App.currentIconData = null;
      updateIconPreview(null);
    });
  });

  uploadIconBtn?.addEventListener('click', () => serverIconUpload?.click());

  serverIconUpload?.addEventListener('change', async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      try {
        const resizedBase64 = await resizeImage(file, 512, 512);
        App.currentIconData = resizedBase64;
        updateIconPreview(resizedBase64);
      } catch (error) {
        showCreateServerError('Failed to process image');
        console.error('Image processing error:', error);
      }
    }
  });

  loadUrlBtn?.addEventListener('click', async () => {
    const url = serverIconUrl?.value.trim();
    if (!url) { showCreateServerError('Please enter an image URL'); return; }
    if (!isValidUrl(url)) { showCreateServerError('Please enter a valid URL'); return; }
    try {
      App.currentIconData = url;
      updateIconPreview(url);
    } catch (error) {
      showCreateServerError('Failed to load image from URL');
    }
  });

  removeIconBtn?.addEventListener('click', () => {
    App.currentIconData = null;
    updateIconPreview(null);
    if (serverIconUpload) serverIconUpload.value = '';
    if (serverIconUrl) serverIconUrl.value = '';
  });

  function updateIconPreview(data: string | null): void {
    if (!iconPreview) return;
    while (iconPreview.firstChild) iconPreview.removeChild(iconPreview.firstChild);
    if (data) {
      const img = document.createElement('img');
      img.src = data;
      img.onerror = () => {
        while (iconPreview.firstChild) iconPreview.removeChild(iconPreview.firstChild);
        const span = document.createElement('span');
        span.className = 'preview-placeholder';
        span.textContent = 'Failed to load image';
        iconPreview.appendChild(span);
        removeIconBtn?.classList.add('hidden');
      };
      img.onload = () => removeIconBtn?.classList.remove('hidden');
      iconPreview.appendChild(img);
    } else {
      const span = document.createElement('span');
      span.className = 'preview-placeholder';
      span.textContent = 'No icon selected';
      iconPreview.appendChild(span);
      removeIconBtn?.classList.add('hidden');
    }
  }

  function isValidUrl(string: string): boolean {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  async function resizeImage(file: File, maxWidth: number, maxHeight: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width, height = img.height;
          if (width > maxWidth || height > maxHeight) {
            const ratio = width / height;
            if (width > height) { width = maxWidth; height = width / ratio; }
            else { height = maxHeight; width = height * ratio; }
          }
          canvas.width = maxWidth;
          canvas.height = maxHeight;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#2f3136';
          ctx.fillRect(0, 0, maxWidth, maxHeight);
          ctx.drawImage(img, (maxWidth - width) / 2, (maxHeight - height) / 2, width, height);
          resolve(canvas.toDataURL(file.type || 'image/png'));
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = (e.target as FileReader).result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  createServerCancelBtn?.addEventListener('click', closeCreateServerModal);
  createServerModal?.addEventListener('click', (e: Event) => { if (e.target === createServerModal) closeCreateServerModal(); });
  createServerBtn?.addEventListener('click', async () => { await handleCreateServer(); });

  async function handleCreateServer(): Promise<void> {
    const serverName = serverNameInput?.value.trim();
    if (!serverName) { log.warn('Create server validation failed: name required'); showCreateServerError('Server name is required'); return; }
    if (serverName.length > 100) { log.warn('Create server validation failed: name too long'); showCreateServerError('Server name must be 100 characters or less'); return; }

    log.info('Creating new server', { name: serverName });
    try {
      if (createServerBtn) { createServerBtn.disabled = true; createServerBtn.textContent = 'Creating...'; }
      const auth = await ipcRenderer.invoke('get-auth') as { token?: string; hostname?: string } | null;
      if (!auth || !auth.token || !auth.hostname) { showCreateServerError('Not authenticated'); return; }
      const device = await ipcRenderer.invoke('get-device-identity') as { public_key?: string; private_key?: string } | null;
      if (!device) { showCreateServerError('Device identity not found'); return; }

      const emberKey = emberCrypto.generateEmberKey();
      const publicKeyBytes  = naclUtil.decodeBase64(device.public_key!);
      const privateKeyBytes = naclUtil.decodeBase64(device.private_key!);
      const encryptedEmberKey = emberCrypto.encryptEmberKeyForUser(emberKey, publicKeyBytes, privateKeyBytes);

      const requestBody: Record<string, unknown> = { name: serverName, encrypted_ember_key: encryptedEmberKey };
      if (App.currentIconData) requestBody['icon_data'] = App.currentIconData;

      const response = await fetch(`${auth.hostname}/api/v1/embers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(errorData.error ?? 'Failed to create server');
      }
      const newEmber = await response.json() as { id?: string; name?: string };
      if (newEmber.id) App.emberKeyCache.set(newEmber.id, emberKey);

      closeCreateServerModal();
      log.info('Server created successfully', { ember_id: newEmber.id ?? '', name: newEmber.name ?? '' });
      window.hideWelcomeScreen();
      const embers = await fetchEmbers();
      renderServerList(embers);
      if (newEmber.id) switchToServer(newEmber.id, newEmber.name ?? '');
    } catch (error) {
      const err = error as Error;
      log.error('Failed to create server', { error: err.message });
      showCreateServerError(err.message || 'Failed to create server');
    } finally {
      if (createServerBtn) { createServerBtn.disabled = false; createServerBtn.textContent = 'Create Server'; }
    }
  }

  function showCreateServerError(message: string): void {
    if (createServerError) { createServerError.textContent = message; createServerError.classList.remove('hidden'); }
  }

  function hideCreateServerError(): void {
    createServerError?.classList.add('hidden');
  }

  // ─── Ember context menu ────────────────────────────────────────────────────

  const emberContextMenu = document.getElementById('ember-context-menu');
  let contextMenuEmber: Ember | null = null;

  function showEmberContextMenu(x: number, y: number, ember: Ember): void {
    if (!emberContextMenu) return;
    contextMenuEmber = ember;
    emberContextMenu.classList.remove('hidden');
    // Position off-screen first so getBoundingClientRect returns real dimensions
    emberContextMenu.style.left = '0px';
    emberContextMenu.style.top = '0px';
    const rect = emberContextMenu.getBoundingClientRect();
    emberContextMenu.style.left = `${Math.min(x, window.innerWidth - rect.width - 5)}px`;
    emberContextMenu.style.top  = `${Math.min(y, window.innerHeight - rect.height - 5)}px`;
  }

  document.addEventListener('click', () => {
    emberContextMenu?.classList.add('hidden');
  });

  const deleteEmberBtn = document.getElementById('ctx-ember-delete');
  if (deleteEmberBtn) {
    deleteEmberBtn.addEventListener('click', async () => {
      if (!contextMenuEmber) return;
      emberContextMenu?.classList.add('hidden');
      if (!confirm(`Delete "${contextMenuEmber.name}"? This cannot be undone.`)) return;
      const auth = await ipcRenderer.invoke('get-auth') as { token?: string; hostname?: string } | null;
      if (!auth?.token || !auth?.hostname) return;
      const res = await fetch(`${auth.hostname}/api/v1/embers/${contextMenuEmber.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${auth.token}` }
      });
      if (res.ok) {
        if (App.activeEmberId === contextMenuEmber.id) App.activeEmberId = null;
        const embers = await fetchEmbers();
        if (embers.length === 0) {
          renderServerList(embers);
          window.showWelcomeScreen();
        } else {
          renderServerList(embers);
        }
      } else {
        alert('Failed to delete ember.');
      }
      contextMenuEmber = null;
    });
  }

  window.fetchEmbers            = fetchEmbers;
  window.renderServerList       = renderServerList;
  window.switchToServer         = switchToServer;
  window.fetchEmberKey          = fetchEmberKey;
  window.loadServerContent      = loadServerContent;
  window.openCreateServerModal  = openCreateServerModal;
  window.closeCreateServerModal = closeCreateServerModal;
})();
