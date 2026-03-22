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
    const gen = (window as unknown as { generateNotificationSound?: (t: string) => void })
      .generateNotificationSound;
    if (typeof gen === 'function') {
      gen(type);
    }
  }

  function initNotifSettings(): void {
    const settings = loadSettings();

    const messageToggle = document.getElementById('notif-message-sound') as HTMLInputElement | null;
    const previewBtn = document.getElementById('notif-message-preview');
    const saveBtn = document.getElementById('notif-save-btn');
    const saveStatus = document.getElementById('notif-save-status');

    if (messageToggle) messageToggle.checked = settings.messageSound;

    previewBtn?.addEventListener('click', () => {
      const gen = (window as unknown as { generateNotificationSound?: (t: string) => void })
        .generateNotificationSound;
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
  }

  window.playNotificationSound = playNotificationSound;
  window.initNotifSettings = initNotifSettings;
  window.getNotifSettings = loadSettings;
  window.saveNotifSettings = saveSettings;

  // Initialize settings page UI immediately (DOM already assembled by main-loader)
  initNotifSettings();
})();
