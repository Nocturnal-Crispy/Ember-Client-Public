/**
 * Channel manager — TypeScript conversion of public/channel-manager.js.
 * Handles channel/category CRUD, rendering, context menu, and drag-and-drop.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('ChannelManager');

  const messagesContainer = document.getElementById('messages');

  // ─── Unread channel tracking ────────────────────────────────────────────────
  const unreadChannelIds = new Set<string>();

  function updateEmberBadge(emberId: string | null, count: number): void {
    if (!emberId) return;
    const iconEl = document.querySelector<HTMLElement>(`.server-icon[data-ember-id="${emberId}"]`);
    if (!iconEl) return;
    let badge = iconEl.querySelector<HTMLElement>('.ember-unread-badge');
    if (count <= 0) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'ember-unread-badge';
      iconEl.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : String(count);
  }

  // ─── Channel / category API fetches ────────────────────────────────────────

  async function fetchChannelsAndCategories(
    emberId: string
  ): Promise<{ channels: Channel[]; categories: Category[] }> {
    log.debug('Fetching channels and categories', { ember_id: emberId });
    try {
      const auth = await window.getValidAuth();
      if (!auth) {
        log.error('Cannot fetch channels: not authenticated');
        return { channels: [], categories: [] };
      }
      const result = await window.electronAPI.channelService.fetchChannels(auth, emberId);
      log.debug('Channels fetched', {
        ember_id: emberId,
        count: result.channels.length,
      });
      return result;
    } catch (error) {
      const err = error as Error;
      log.error('Error fetching channels', {
        ember_id: emberId,
        error: err.message,
      });
      console.error('Error fetching channels:', error);
      return { channels: [], categories: [] };
    }
  }

  async function fetchCategories(emberId: string): Promise<Category[]> {
    return (await fetchChannelsAndCategories(emberId)).categories;
  }

  async function fetchChannels(emberId: string): Promise<Channel[]> {
    return (await fetchChannelsAndCategories(emberId)).channels;
  }

  // ─── Channel / category rendering ──────────────────────────────────────────

  function renderChannels(channels: Channel[], categories: Category[] = []): void {
    const channelsContainerEl = document.querySelector('.channels');
    if (!channelsContainerEl) return;
    const channelsContainer = channelsContainerEl;

    channelsContainer.replaceChildren();
    unreadChannelIds.clear();
    updateEmberBadge(App.activeEmberId, 0);

    // Build fresh arrays each render to prevent duplicates on double-render
    const uncategorized = channels.filter(ch => !ch.categoryId);
    const channelsByCategory: Record<string, Channel[]> = channels
      .filter(ch => ch.categoryId)
      .reduce<Record<string, Channel[]>>((acc, ch) => {
        const catId = ch.categoryId as string;
        return { ...acc, [catId]: [...(acc[catId] ?? []), ch] };
      }, {});

    interface AutoSelectEntry {
      el: HTMLElement;
      channel: Channel;
    }
    let autoSelect: AutoSelectEntry | null = null;

    function appendChannel(channel: Channel): void {
      const channelEl = document.createElement('div');
      channelEl.className = 'channel';
      channelEl.dataset['channelId'] = channel.id;
      channelEl.dataset['itemType'] = 'channel';
      channelEl.dataset['catId'] = channel.categoryId ?? '';

      const iconEl = document.createElement('span');
      iconEl.className = 'channel-icon';
      iconEl.textContent = channel.type === 'voice' ? '🔊' : '#';
      const nameEl = document.createElement('span');
      nameEl.className = 'channel-name';
      nameEl.textContent = channel.name;
      channelEl.appendChild(iconEl);
      channelEl.appendChild(nameEl);

      channelEl.addEventListener('click', () => {
        document.querySelectorAll('.channel').forEach(el => el.classList.remove('active'));
        channelEl.classList.add('active');
        channelEl.classList.remove('has-unread');
        unreadChannelIds.delete(channel.id);
        updateEmberBadge(App.activeEmberId, unreadChannelIds.size);
        if (channel.type === 'voice') {
          window.updateChatHeader(channel.name, channel.description ?? '');
          window.showVoiceChannelView();
          if (App.activeVoiceChannelId !== channel.id) {
            window.joinVoiceChannel(channel.id, channel.name);
          }
        } else {
          window.showTextChannelView();
          window.updateChatHeader(channel.name, channel.description ?? '');
          if (App.activeChannelId !== channel.id) {
            window.loadChannelMessages(channel.id);
          }
        }
      });

      channelEl.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        showChannelContextMenu(e.clientX, e.clientY, {
          type: 'channel',
          id: channel.id,
          name: channel.name,
          channelType: channel.type,
          categoryId: channel.categoryId ?? null,
          description: channel.description ?? '',
        });
      });

      channelEl.setAttribute('draggable', 'true');
      channelEl.addEventListener('dragstart', (e: DragEvent) => {
        App.dragItem = { type: 'channel', id: channel.id };
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        channelEl.classList.add('dragging');
      });
      channelEl.addEventListener('dragend', () => {
        channelEl.classList.remove('dragging');
        clearDragHighlights();
      });
      channelEl.addEventListener('dragover', (e: DragEvent) => {
        if (!App.dragItem || App.dragItem.type !== 'channel') return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const rect = channelEl.getBoundingClientRect();
        const insertAfter = e.clientY > rect.top + rect.height / 2;
        clearDragHighlights();
        channelEl.classList.add(insertAfter ? 'drag-over-bottom' : 'drag-over-top');
      });
      channelEl.addEventListener('dragleave', () => {
        clearDragHighlights();
      });
      channelEl.addEventListener('drop', async (e: DragEvent) => {
        e.preventDefault();
        clearDragHighlights();
        if (!App.dragItem || App.dragItem.type !== 'channel' || App.dragItem.id === channel.id)
          return;
        const rect = channelEl.getBoundingClientRect();
        const insertAfter = e.clientY > rect.top + rect.height / 2;
        const dropped = App.dragItem;
        App.dragItem = null;
        await reorderChannels(dropped.id, channel.id, channel.categoryId ?? null, insertAfter);
      });

      if (!autoSelect && channel.type === 'text') autoSelect = { el: channelEl, channel };
      channelsContainer.appendChild(channelEl);

      if (channel.type === 'voice') {
        const participantList = document.createElement('div');
        participantList.className = 'voice-participant-list';
        participantList.dataset['voiceChannelId'] = channel.id;
        channelsContainer.appendChild(participantList);
      }
    }

    function appendCategory(cat: Category): void {
      const catEl = document.createElement('div');
      catEl.className = 'channel-category';
      catEl.dataset['categoryId'] = cat.id;
      catEl.dataset['itemType'] = 'category';

      const arrowEl = document.createElement('span');
      arrowEl.className = 'category-arrow';
      arrowEl.textContent = '▼';
      const catNameEl = document.createElement('span');
      catNameEl.className = 'category-name';
      catNameEl.textContent = cat.name.toUpperCase();
      catEl.appendChild(arrowEl);
      catEl.appendChild(catNameEl);

      catEl.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        showChannelContextMenu(e.clientX, e.clientY, {
          type: 'category',
          id: cat.id,
          name: cat.name,
          channelType: null,
          categoryId: cat.id,
        });
      });

      catEl.setAttribute('draggable', 'true');
      catEl.addEventListener('dragstart', (e: DragEvent) => {
        App.dragItem = { type: 'category', id: cat.id };
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        catEl.classList.add('dragging');
      });
      catEl.addEventListener('dragend', () => {
        catEl.classList.remove('dragging');
        clearDragHighlights();
      });
      catEl.addEventListener('dragover', (e: DragEvent) => {
        if (!App.dragItem) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const rect = catEl.getBoundingClientRect();
        const insertAfter = e.clientY > rect.top + rect.height / 2;
        clearDragHighlights();
        if (App.dragItem.type === 'channel') {
          catEl.classList.add('drag-over-top');
        } else {
          catEl.classList.add(insertAfter ? 'drag-over-bottom' : 'drag-over-top');
        }
      });
      catEl.addEventListener('dragleave', () => {
        clearDragHighlights();
      });
      catEl.addEventListener('drop', async (e: DragEvent) => {
        e.preventDefault();
        clearDragHighlights();
        if (!App.dragItem) return;
        const dropped = App.dragItem;
        App.dragItem = null;
        if (dropped.type === 'channel') {
          await reorderChannels(dropped.id, null, cat.id);
        } else if (dropped.type === 'category' && dropped.id !== cat.id) {
          const rect = catEl.getBoundingClientRect();
          const insertAfter = e.clientY > rect.top + rect.height / 2;
          await reorderCategories(dropped.id, cat.id, insertAfter);
        }
      });
      channelsContainer.appendChild(catEl);
    }

    uncategorized.forEach(appendChannel);
    categories.forEach(cat => {
      appendCategory(cat);
      (channelsByCategory[cat.id] ?? []).forEach(appendChannel);
    });

    // TypeScript doesn't track writes to `autoSelect` inside the appendChannel closure,
    // so re-assert the declared type before narrowing.
    const autoSelectEntry = autoSelect as AutoSelectEntry | null;
    if (autoSelectEntry) {
      autoSelectEntry.el.classList.add('active');
      window.updateChatHeader(
        autoSelectEntry.channel.name,
        autoSelectEntry.channel.description ?? ''
      );
      window.loadChannelMessages(autoSelectEntry.channel.id);
    }

    // Repopulate voice participant lists from existing presence data.
    // renderChannels rebuilds the DOM, so the .voice-participant-list elements are new and empty.
    if (App.voiceChannelPresence.size > 0) {
      App.voiceChannelPresence.forEach((_, channelId) => {
        window.renderVoiceParticipants(channelId);
      });
    }
  }

  function clearDragHighlights(): void {
    document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  }

  async function reorderChannels(
    draggedId: string,
    relativeToChannelId: string | null,
    newCategoryId: string | null,
    insertAfter = false
  ): Promise<void> {
    log.debug('Reordering channels', { dragged_id: draggedId });
    const auth = (await ipcRenderer.invoke('get-auth')) as {
      token?: string;
      hostname?: string;
    } | null;
    if (!auth || !auth.token || !auth.hostname || !App.activeEmberId) return;

    const allChannelEls = Array.from(document.querySelectorAll<HTMLElement>('.channel'));
    const updates: ChannelReorderUpdate[] = [];
    let position = 0;
    let inserted = false;

    for (const el of allChannelEls) {
      const id = el.dataset['channelId'];
      const catId = el.dataset['catId'] ?? null;
      if (!id) continue;
      if (id === draggedId) continue;
      if (!insertAfter && relativeToChannelId && id === relativeToChannelId) {
        updates.push({
          id: draggedId,
          position: position++,
          categoryId: newCategoryId ?? null,
        });
        inserted = true;
      }
      updates.push({
        id,
        position: position++,
        categoryId: catId === '' ? null : catId,
      });
      if (insertAfter && relativeToChannelId && id === relativeToChannelId) {
        updates.push({
          id: draggedId,
          position: position++,
          categoryId: newCategoryId ?? null,
        });
        inserted = true;
      }
    }
    if (!inserted)
      updates.push({
        id: draggedId,
        position,
        categoryId: newCategoryId ?? null,
      });

    try {
      await fetch(`${auth.hostname}/api/v1/embers/${App.activeEmberId}/channels/reorder`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ channels: updates }),
      });
      const { channels, categories: cats } = await fetchChannelsAndCategories(App.activeEmberId);
      renderChannels(channels, cats);
    } catch (e) {
      log.error('Failed to reorder channels', { error: String(e) });
    }
  }

  async function reorderCategories(
    draggedId: string,
    relativeToCategoryId: string,
    insertAfter = false
  ): Promise<void> {
    const auth = (await ipcRenderer.invoke('get-auth')) as {
      token?: string;
      hostname?: string;
    } | null;
    if (!auth || !auth.token || !auth.hostname || !App.activeEmberId) return;

    const allCatEls = Array.from(document.querySelectorAll<HTMLElement>('.channel-category'));
    const updates: CategoryReorderUpdate[] = [];
    let position = 0;
    let inserted = false;

    for (const el of allCatEls) {
      const id = el.dataset['categoryId'];
      if (!id) continue;
      if (id === draggedId) continue;
      if (!insertAfter && id === relativeToCategoryId) {
        updates.push({ id: draggedId, position: position++ });
        inserted = true;
      }
      updates.push({ id, position: position++ });
      if (insertAfter && id === relativeToCategoryId) {
        updates.push({ id: draggedId, position: position++ });
        inserted = true;
      }
    }
    if (!inserted) updates.push({ id: draggedId, position });

    try {
      await fetch(`${auth.hostname}/api/v1/embers/${App.activeEmberId}/categories/reorder`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ categories: updates }),
      });
      const { channels, categories: cats } = await fetchChannelsAndCategories(App.activeEmberId);
      renderChannels(channels, cats);
    } catch (e) {
      log.error('Failed to reorder categories', { error: String(e) });
    }
  }

  // ─── Channel Context Menu ───────────────────────────────────────────────────

  const channelContextMenu = document.getElementById('channel-context-menu');

  function showChannelContextMenu(x: number, y: number, target: ContextMenuTarget): void {
    if (!channelContextMenu) return;
    App.contextMenuTarget = target;

    const editLabel = document.getElementById('ctx-edit-label');
    if (editLabel)
      editLabel.textContent = target.type === 'category' ? 'Edit Category' : 'Edit Channel';
    const deleteLabel = document.getElementById('ctx-delete-label');
    if (deleteLabel)
      deleteLabel.textContent = target.type === 'category' ? 'Delete Category' : 'Delete Channel';

    // Show edit/delete only if user has ManageChannels (1<<1) or ManageCategories (1<<7)
    const canManage = (App.myPermissions & 2n) !== 0n || (App.myPermissions & 128n) !== 0n;
    const showEditDelete = target.type !== 'empty' && canManage;
    const editSep = document.getElementById('ctx-edit-separator');
    const editItem = document.getElementById('ctx-edit-item');
    const deleteSep = document.getElementById('ctx-delete-separator');
    const deleteItem = document.getElementById('ctx-delete-item');
    if (editSep) editSep.style.display = showEditDelete ? '' : 'none';
    if (editItem) editItem.style.display = showEditDelete ? '' : 'none';
    if (deleteSep) deleteSep.style.display = showEditDelete ? '' : 'none';
    if (deleteItem) deleteItem.style.display = showEditDelete ? '' : 'none';

    channelContextMenu.classList.remove('hidden');
    const menuRect = channelContextMenu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - menuRect.width - 5);
    const top = Math.min(y, window.innerHeight - menuRect.height - 5);
    channelContextMenu.style.left = `${left}px`;
    channelContextMenu.style.top = `${top}px`;
  }

  function hideChannelContextMenu(): void {
    if (channelContextMenu) channelContextMenu.classList.add('hidden');
    App.contextMenuTarget = null;
  }

  document.addEventListener('click', () => hideChannelContextMenu());

  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.channel') && !target.closest('.channel-category')) {
      hideChannelContextMenu();
      if (target.closest('.channels') && App.activeEmberId) {
        e.preventDefault();
        showChannelContextMenu(e.clientX, e.clientY, {
          type: 'empty',
          id: null,
          name: null,
          channelType: null,
          categoryId: null,
        });
      }
    }
  });

  document.getElementById('ctx-new-text-channel')?.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    const categoryId = App.contextMenuTarget?.categoryId ?? null;
    hideChannelContextMenu();
    openChannelNameModal('create-text', categoryId, null, '');
  });

  document.getElementById('ctx-new-voice-channel')?.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    const categoryId = App.contextMenuTarget?.categoryId ?? null;
    hideChannelContextMenu();
    openChannelNameModal('create-voice', categoryId, null, '');
  });

  document.getElementById('ctx-edit-item')?.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    if (!App.contextMenuTarget) return;
    const mode = App.contextMenuTarget.type === 'category' ? 'edit-category' : 'edit-channel';
    const { id, name, description } = App.contextMenuTarget;
    hideChannelContextMenu();
    openChannelNameModal(mode, null, id, name ?? '', description ?? '');
  });

  document.getElementById('ctx-new-category')?.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    hideChannelContextMenu();
    openChannelNameModal('create-category', null, null, '');
  });

  document.getElementById('ctx-delete-item')?.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    if (!App.contextMenuTarget || App.contextMenuTarget.type === 'empty') return;
    const isCategory = App.contextMenuTarget.type === 'category';
    const titleEl = document.getElementById('delete-modal-title');
    const msgEl = document.getElementById('delete-modal-message');
    if (titleEl) titleEl.textContent = isCategory ? 'Delete Category' : 'Delete Channel';
    if (msgEl) {
      msgEl.textContent = isCategory
        ? `Are you sure you want to delete "${App.contextMenuTarget.name}"? Channels inside will become uncategorized.`
        : `Are you sure you want to delete "${App.contextMenuTarget.name}"? All messages will be permanently lost.`;
    }
    channelContextMenu?.classList.add('hidden');
    document.getElementById('delete-confirm-modal')?.classList.remove('hidden');
  });

  document.getElementById('delete-modal-cancel-btn')?.addEventListener('click', () => {
    document.getElementById('delete-confirm-modal')?.classList.add('hidden');
    App.contextMenuTarget = null;
    window.pendingMessageDelete = null;
  });

  document.getElementById('delete-modal-confirm-btn')?.addEventListener('click', async () => {
    // Handle message deletion (set by createActionToolbar delete button)
    const pendingMsgDelete = window.pendingMessageDelete;
    if (pendingMsgDelete) {
      window.pendingMessageDelete = null;
      const msgDeleteBtn = document.getElementById(
        'delete-modal-confirm-btn'
      ) as HTMLButtonElement | null;
      if (msgDeleteBtn) msgDeleteBtn.disabled = true;
      try {
        const auth = (await ipcRenderer.invoke('get-auth')) as {
          token?: string;
          hostname?: string;
        } | null;
        if (!auth || !auth.token || !auth.hostname) return;
        const res = await fetch(
          `${auth.hostname}/api/v1/channels/${pendingMsgDelete.channelId}/messages/${pendingMsgDelete.messageId}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${auth.token}` },
          }
        );
        if (res.ok) {
          log.info('Message deleted', { message_id: pendingMsgDelete.messageId });
          const msgEl = document.querySelector(`[data-message-id="${pendingMsgDelete.messageId}"]`);
          msgEl?.remove();
          App.ownedMessageIds.delete(pendingMsgDelete.messageId);
          document.getElementById('delete-confirm-modal')?.classList.add('hidden');
        } else {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          log.error('Message delete failed', {
            message_id: pendingMsgDelete.messageId,
            error: err.error ?? '',
          });
        }
      } catch (err) {
        log.error('Message delete error', { error: String(err) });
      } finally {
        if (msgDeleteBtn) msgDeleteBtn.disabled = false;
      }
      return;
    }

    if (!App.contextMenuTarget) return;
    const ctxTarget = App.contextMenuTarget;
    const btn = document.getElementById('delete-modal-confirm-btn') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      const auth = (await ipcRenderer.invoke('get-auth')) as {
        token?: string;
        hostname?: string;
      } | null;
      if (!auth || !auth.token || !auth.hostname) return;
      let res: Response;
      if (ctxTarget.type === 'category') {
        res = await fetch(
          `${auth.hostname}/api/v1/embers/${App.activeEmberId}/categories/${ctxTarget.id}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${auth.token}` },
          }
        );
      } else {
        res = await fetch(`${auth.hostname}/api/v1/channels/${ctxTarget.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${auth.token}` },
        });
      }
      if (res.ok) {
        log.info('Channel/category deleted', {
          type: ctxTarget.type,
          id: ctxTarget.id ?? '',
          name: ctxTarget.name ?? '',
        });
        if (ctxTarget.type === 'channel' && ctxTarget.id === App.activeChannelId) {
          App.activeChannelId = null;
          window.updateChatHeader('', '');
          if (messagesContainer)
            while (messagesContainer.firstChild)
              messagesContainer.removeChild(messagesContainer.firstChild);
        }
        document.getElementById('delete-confirm-modal')?.classList.add('hidden');
        if (!App.activeEmberId) {
          log.warn('No active ember after delete');
          return;
        }
        const { channels, categories: cats } = await fetchChannelsAndCategories(App.activeEmberId);
        renderChannels(channels, cats);
      } else {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        log.error('Delete failed', {
          type: ctxTarget.type,
          id: ctxTarget.id ?? '',
          error: err.error ?? '',
        });
        console.error('Delete failed:', err.error);
      }
    } catch (err) {
      log.error('Delete error', { error: String(err) });
    } finally {
      if (btn) btn.disabled = false;
      App.contextMenuTarget = null;
    }
  });

  // ─── Channel / Category Name Modal ─────────────────────────────────────────

  const channelNameModal = document.getElementById('channel-name-modal');
  const channelModalTitle = document.getElementById('channel-modal-title');
  const channelNameInput = document.getElementById('channel-name-input') as HTMLInputElement | null;
  const channelModalConfirmBtn = document.getElementById(
    'channel-modal-confirm-btn'
  ) as HTMLButtonElement | null;
  const channelModalCancelBtn = document.getElementById('channel-modal-cancel-btn');
  const channelModalError = document.getElementById('channel-modal-error');

  const CHANNEL_MODAL_CONFIG: Record<string, { title: string; label: string; confirm: string }> = {
    'create-text': {
      title: 'Create Text Channel',
      label: 'CHANNEL NAME',
      confirm: 'Create',
    },
    'create-voice': {
      title: 'Create Voice Channel',
      label: 'CHANNEL NAME',
      confirm: 'Create',
    },
    'edit-channel': {
      title: 'Edit Channel',
      label: 'CHANNEL NAME',
      confirm: 'Save',
    },
    'create-category': {
      title: 'Create Category',
      label: 'CATEGORY NAME',
      confirm: 'Create',
    },
    'edit-category': {
      title: 'Edit Category',
      label: 'CATEGORY NAME',
      confirm: 'Save',
    },
  };

  function openChannelNameModal(
    mode: string,
    categoryId: string | null,
    targetId: string | null,
    currentName: string,
    currentDescription = ''
  ): void {
    App.channelModalMode = mode;
    App.channelModalTargetId = targetId ?? null;
    App.channelModalCategoryId = categoryId ?? null;

    const cfg = CHANNEL_MODAL_CONFIG[mode] ?? {};
    if (channelModalTitle) channelModalTitle.textContent = cfg.title ?? 'Name';
    const labelEl = document.getElementById('channel-name-label');
    if (labelEl) labelEl.textContent = cfg.label ?? 'NAME';
    if (channelModalConfirmBtn) channelModalConfirmBtn.textContent = cfg.confirm ?? 'Confirm';
    if (channelNameInput) channelNameInput.value = currentName;
    if (channelModalError) channelModalError.classList.add('hidden');
    if (channelModalConfirmBtn) channelModalConfirmBtn.disabled = false;

    const descGroup = document.getElementById('channel-desc-group');
    const descInput = document.getElementById('channel-desc-input') as HTMLInputElement | null;
    const showDesc = mode === 'edit-channel';
    if (descGroup) descGroup.style.display = showDesc ? '' : 'none';
    if (descInput) descInput.value = showDesc ? currentDescription : '';

    if (channelNameModal) channelNameModal.classList.remove('hidden');
    setTimeout(() => channelNameInput?.focus(), 50);
  }

  function closeChannelNameModal(): void {
    if (channelNameModal) channelNameModal.classList.add('hidden');
    App.channelModalMode = null;
    App.channelModalTargetId = null;
    App.channelModalCategoryId = null;
  }

  function showChannelModalError(msg: string): void {
    if (channelModalError) {
      channelModalError.textContent = msg;
      channelModalError.classList.remove('hidden');
    }
  }

  channelModalCancelBtn?.addEventListener('click', closeChannelNameModal);
  channelNameModal?.addEventListener('click', (e: Event) => {
    if (e.target === channelNameModal) closeChannelNameModal();
  });
  channelNameInput?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') channelModalConfirmBtn?.click();
  });

  channelModalConfirmBtn?.addEventListener('click', async () => {
    const name = channelNameInput?.value.trim();
    if (!name) {
      showChannelModalError('Name is required');
      return;
    }
    if (channelModalConfirmBtn) channelModalConfirmBtn.disabled = true;
    try {
      const auth = (await ipcRenderer.invoke('get-auth')) as {
        token?: string;
        hostname?: string;
      } | null;
      if (!auth || !auth.token || !auth.hostname) {
        showChannelModalError('Not authenticated');
        return;
      }

      if (App.channelModalMode === 'create-text' || App.channelModalMode === 'create-voice') {
        const type = App.channelModalMode === 'create-text' ? 'text' : 'voice';
        const body: Record<string, unknown> = { name, type };
        if (App.channelModalCategoryId) body['category_id'] = App.channelModalCategoryId;
        const res = await fetch(`${auth.hostname}/api/v1/embers/${App.activeEmberId}/channels`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? 'Failed to create channel');
        }
      } else if (App.channelModalMode === 'edit-channel') {
        const descInput = document.getElementById('channel-desc-input') as HTMLInputElement | null;
        const description = descInput ? descInput.value.trim() : '';
        const res = await fetch(`${auth.hostname}/api/v1/channels/${App.channelModalTargetId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ name, description }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? 'Failed to update channel');
        }
      } else if (App.channelModalMode === 'create-category') {
        const res = await fetch(`${auth.hostname}/api/v1/embers/${App.activeEmberId}/categories`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? 'Failed to create category');
        }
      } else if (App.channelModalMode === 'edit-category') {
        const res = await fetch(
          `${auth.hostname}/api/v1/embers/${App.activeEmberId}/categories/${App.channelModalTargetId}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${auth.token}`,
            },
            body: JSON.stringify({ name }),
          }
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? 'Failed to update category');
        }
      }

      log.info('Channel/category operation completed', {
        mode: App.channelModalMode ?? '',
        name,
      });
      closeChannelNameModal();
      if (!App.activeEmberId) {
        log.warn('No active ember after channel/category operation');
        return;
      }
      const [channels, cats] = await Promise.all([
        fetchChannels(App.activeEmberId),
        fetchCategories(App.activeEmberId),
      ]);
      renderChannels(channels, cats);
    } catch (error) {
      const err = error as Error;
      log.error('Channel/category operation failed', {
        mode: App.channelModalMode ?? '',
        error: err.message,
      });
      showChannelModalError(err.message || 'Something went wrong');
    } finally {
      if (channelModalConfirmBtn) channelModalConfirmBtn.disabled = false;
    }
  });

  function markChannelUnread(channelId: string): void {
    const el = document.querySelector<HTMLElement>(`.channel[data-channel-id="${channelId}"]`);
    const wasAlreadyUnread = unreadChannelIds.has(channelId);
    unreadChannelIds.add(channelId);
    updateEmberBadge(App.activeEmberId, unreadChannelIds.size);
    if (!wasAlreadyUnread && typeof window.playNotificationSound === 'function') {
      window.playNotificationSound('channelMessage');
    }
    if (!el) return;
    el.classList.add('has-unread');
  }

  function clearAllChannelUnread(): void {
    unreadChannelIds.clear();
    document.querySelectorAll<HTMLElement>('.channel.has-unread').forEach(el => {
      el.classList.remove('has-unread');
    });
    document.querySelectorAll<HTMLElement>('.ember-unread-badge').forEach(el => {
      el.remove();
    });
  }

  window.fetchChannels = fetchChannels;
  window.fetchCategories = fetchCategories;
  window.renderChannels = renderChannels;
  window.openChannelNameModal = openChannelNameModal;
  window.closeChannelNameModal = closeChannelNameModal;
  window.showChannelContextMenu = showChannelContextMenu;
  window.hideChannelContextMenu = hideChannelContextMenu;
  window.markChannelUnread = markChannelUnread;
  window.clearAllChannelUnread = clearAllChannelUnread;
})();
