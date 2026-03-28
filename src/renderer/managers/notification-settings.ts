/**
 * Notification Settings Manager
 * Manages notification sound preferences (stored in localStorage) and wires
 * up the Notifications settings page UI.
 */
(function (): void {
  const log = window.emberLog.createLogger('NotificationSettings');

  const STORAGE_KEY = 'ember_notif_settings';

  const DEFAULT_SETTINGS: NotifSettings = {
    messageSound: true,
  };

  function loadSettings(): NotifSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw) as Partial<NotifSettings>);
      }
    } catch {
      // ignore parse errors
    }
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  function saveSettings(settings: NotifSettings): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function playNotificationSound(type: string): void {
    const settings = loadSettings();
    if (!settings.messageSound) return;
    const gen = window.generateNotificationSound;
    if (typeof gen === 'function') {
      gen(type);
    }
  }

  function initNotifSettings(): void {
    const settings = loadSettings();

    const messageToggle = document.getElementById('notif-message-sound') as HTMLInputElement | null;
    const linkPreviewToggle = document.getElementById(
      'notif-link-preview'
    ) as HTMLInputElement | null;
    const previewBtn = document.getElementById('notif-message-preview');
    const saveBtn = document.getElementById('notif-save-btn');
    const saveStatus = document.getElementById('notif-save-status');

    if (messageToggle) messageToggle.checked = settings.messageSound;

    if (linkPreviewToggle) {
      linkPreviewToggle.checked = window.isLinkPreviewEnabled?.() ?? true;
      linkPreviewToggle.addEventListener('change', () => {
        window.setLinkPreviewEnabled?.(linkPreviewToggle.checked);
      });
    }

    previewBtn?.addEventListener('click', () => {
      const gen = window.generateNotificationSound;
      if (typeof gen === 'function') gen('dmMessage');
    });

    saveBtn?.addEventListener('click', () => {
      const newSettings: NotifSettings = {
        messageSound: messageToggle?.checked ?? true,
      };
      saveSettings(newSettings);
      log.info('Notification settings saved', {
        messageSound: String(newSettings.messageSound),
      });
      if (saveStatus) {
        saveStatus.textContent = 'Saved!';
        setTimeout(() => {
          saveStatus.textContent = '';
        }, 2000);
      }
    });

    // Privacy level select
    const privacySelect = document.getElementById(
      'notif-privacy-level'
    ) as HTMLSelectElement | null;
    if (privacySelect) {
      // Use the first ember's privacy level as default display
      const embers = window.App?.currentEmbers ?? [];
      if (embers.length > 0) {
        const first = getEmberMentionSettings(embers[0].id);
        privacySelect.value = first.privacyLevel;
      }
      privacySelect.addEventListener('change', () => {
        const embers2 = window.App?.currentEmbers ?? [];
        for (const ember of embers2) {
          const cur = getEmberMentionSettings(ember.id);
          setEmberMentionSettings(ember.id, {
            ...cur,
            privacyLevel: privacySelect.value as NotifPrivacy,
          });
        }
      });
    }

    // Per-ember notification list
    renderPerEmberSettings();
  }

  function renderPerEmberSettings(): void {
    const container = document.getElementById('notif-per-ember-list');
    if (!container) return;
    container.innerHTML = '';

    const embers = window.App?.currentEmbers ?? [];
    for (const ember of embers) {
      const settings = getEmberMentionSettings(ember.id);
      const row = document.createElement('div');
      row.className = 'sound-row';

      const label = document.createElement('span');
      label.className = 'sound-label';
      label.textContent = ember.name;
      row.appendChild(label);

      const select = document.createElement('select');
      select.className = 'settings-select';
      const options: { value: MentionMode; label: string }[] = [
        { value: 'all', label: 'All Messages' },
        { value: 'mentions_only', label: 'Mentions Only' },
        { value: 'nothing', label: 'Muted' },
      ];
      for (const opt of options) {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.label;
        if (opt.value === settings.mentionMode) el.selected = true;
        select.appendChild(el);
      }
      select.addEventListener('change', () => {
        const cur = getEmberMentionSettings(ember.id);
        setEmberMentionSettings(ember.id, {
          ...cur,
          mentionMode: select.value as MentionMode,
        });
      });
      row.appendChild(select);
      container.appendChild(row);
    }
  }

  // ─── Per-Ember Mention Settings ──────────────────────────────────────────

  const MENTION_STORAGE_KEY = 'ember_mention_settings';

  const DEFAULT_MENTION_SETTINGS: EmberMentionSettings = {
    mentionMode: 'mentions_only',
    privacyLevel: 'full',
  };

  function loadAllEmberMentionSettings(): Record<string, EmberMentionSettings> {
    try {
      const raw = localStorage.getItem(MENTION_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Record<string, EmberMentionSettings>;
    } catch {
      // ignore
    }
    return {};
  }

  function getEmberMentionSettings(emberId: string): EmberMentionSettings {
    const all = loadAllEmberMentionSettings();
    return { ...DEFAULT_MENTION_SETTINGS, ...all[emberId] };
  }

  function setEmberMentionSettings(emberId: string, settings: EmberMentionSettings): void {
    const all = loadAllEmberMentionSettings();
    all[emberId] = settings;
    localStorage.setItem(MENTION_STORAGE_KEY, JSON.stringify(all));
    log.info('Ember mention settings saved', { emberId, mode: settings.mentionMode });
  }

  // ─── Show Mention Notification ─────────────────────────────────────────────

  function showMentionNotification(payload: {
    emberId: string;
    channelId: string;
    channelName: string;
    senderUsername: string;
    mentionType: 'user' | 'role' | 'everyone';
    messagePreview: string;
  }): void {
    const settings = getEmberMentionSettings(payload.emberId);

    // Check mention mode
    if (settings.mentionMode === 'nothing') return;
    if (settings.mentionMode === 'mentions_only' && !payload.mentionType) return;

    // Format based on privacy level
    let title: string;
    let body: string;

    switch (settings.privacyLevel) {
      case 'full':
        title = `${payload.senderUsername} in #${payload.channelName}`;
        body = payload.messagePreview.slice(0, 100);
        break;
      case 'name-only':
        title = `New mention from ${payload.senderUsername}`;
        body = `in #${payload.channelName}`;
        break;
      case 'minimal':
        title = 'Ember';
        body = 'You have a new mention';
        break;
    }

    // Play mention sound
    playNotificationSound('mention');

    // Send desktop notification via IPC
    const ipc = window.electronAPI?.ipc;
    if (typeof ipc?.invoke === 'function') {
      ipc.invoke('show-desktop-notification', {
        title,
        body,
        emberId: payload.emberId,
        channelId: payload.channelId,
      });
    }
  }

  // ─── Expose globals ───────────────────────────────────────────────────────

  window.playNotificationSound = playNotificationSound;
  window.initNotifSettings = initNotifSettings;
  window.getNotifSettings = loadSettings;
  window.saveNotifSettings = saveSettings;
  window.getEmberMentionSettings = getEmberMentionSettings;
  window.setEmberMentionSettings = setEmberMentionSettings;
  window.showMentionNotification = showMentionNotification;

  // Initialize settings page UI immediately (DOM already assembled by main-loader)
  initNotifSettings();
})();
