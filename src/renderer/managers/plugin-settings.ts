/**
 * Plugin Settings Manager
 * Manages optional UI plugin toggles (stored in localStorage) and wires
 * up the Plugins settings page UI.
 */
(function (): void {
  const log = window.emberLog.createLogger('PluginSettings');

  const STORAGE_KEY = 'ember_plugin_settings';

  const DEFAULT_APP_LOCK: AppLockSettings = {
    enabled: false,
    idleTimeoutMinutes: 5,
    lockOnFocusLoss: false,
    focusLossDelaySeconds: 5,
  };

  const DEFAULT_SETTINGS: PluginSettings = {
    readAllButton: false,
    memberListToggle: false,
    appLock: DEFAULT_APP_LOCK,
  };

  function loadSettings(): PluginSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PluginSettings>;
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          appLock: Object.assign({}, DEFAULT_APP_LOCK, parsed.appLock ?? {}),
        };
      }
    } catch {
      // ignore parse errors
    }
    return { ...DEFAULT_SETTINGS, appLock: { ...DEFAULT_APP_LOCK } };
  }

  function saveSettings(settings: PluginSettings): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function applySettings(settings: PluginSettings): void {
    const btn = document.getElementById('read-all-btn') as HTMLElement | null;
    if (btn) {
      btn.style.display = settings.readAllButton ? '' : 'none';
    }
    applyMemberListToggle(settings.memberListToggle);
  }

  const MEMBER_LIST_COLLAPSED_KEY = 'ember_member_list_collapsed';

  function isMemberListCollapsed(): boolean {
    return localStorage.getItem(MEMBER_LIST_COLLAPSED_KEY) === 'true';
  }

  function setMemberListCollapsed(collapsed: boolean): void {
    localStorage.setItem(MEMBER_LIST_COLLAPSED_KEY, String(collapsed));
  }

  function updateVersionDisplay(collapsed: boolean): void {
    const versionDisplay = document.getElementById('version-display');
    if (versionDisplay) {
      versionDisplay.style.display = collapsed ? 'none' : '';
    }
  }

  function applyMemberListToggle(enabled: boolean): void {
    const header = document.getElementById('member-list-header');
    const memberList = document.getElementById('member-list');
    const expandTab = document.getElementById('member-list-expand-tab');

    if (!enabled) {
      // Plugin disabled — hide header and expand tab, show member list normally
      if (header) header.classList.remove('visible');
      if (memberList) memberList.classList.remove('collapsed');
      if (expandTab) expandTab.style.display = 'none';
      updateVersionDisplay(false);
      return;
    }

    // Plugin enabled — show header
    if (header) header.classList.add('visible');

    // Restore collapsed state
    const collapsed = isMemberListCollapsed();
    if (collapsed) {
      if (memberList) memberList.classList.add('collapsed');
      if (expandTab) expandTab.style.display = '';
    } else {
      if (memberList) memberList.classList.remove('collapsed');
      if (expandTab) expandTab.style.display = 'none';
    }
    updateVersionDisplay(collapsed);
  }

  function toggleMemberList(): void {
    const settings = loadSettings();
    if (!settings.memberListToggle) return;

    const collapsed = !isMemberListCollapsed();
    setMemberListCollapsed(collapsed);

    const memberList = document.getElementById('member-list');
    const expandTab = document.getElementById('member-list-expand-tab');

    if (collapsed) {
      if (memberList) memberList.classList.add('collapsed');
      if (expandTab) expandTab.style.display = '';
    } else {
      if (memberList) memberList.classList.remove('collapsed');
      if (expandTab) expandTab.style.display = 'none';
    }
    updateVersionDisplay(collapsed);
  }

  function initPluginSettings(): void {
    let settings = loadSettings();
    applySettings(settings);

    const readAllToggle = document.getElementById('plugin-read-all-btn') as HTMLInputElement | null;
    if (readAllToggle) {
      readAllToggle.checked = settings.readAllButton;
      readAllToggle.addEventListener('change', () => {
        settings = {
          ...settings,
          readAllButton: readAllToggle.checked,
        };
        saveSettings(settings);
        applySettings(settings);
        log.info('Plugin settings updated', { readAllButton: String(settings.readAllButton) });
      });
    }

    // ─── Member List Toggle ─────────────────────────────────────────────────

    const memberListToggle = document.getElementById(
      'plugin-member-list-toggle'
    ) as HTMLInputElement | null;
    if (memberListToggle) {
      memberListToggle.checked = settings.memberListToggle;
      memberListToggle.addEventListener('change', () => {
        settings = {
          ...settings,
          memberListToggle: memberListToggle.checked,
        };
        saveSettings(settings);
        applySettings(settings);
        log.info('Member list toggle updated', {
          memberListToggle: String(settings.memberListToggle),
        });
      });
    }

    // Wire collapse/expand buttons
    const collapseBtn = document.getElementById('member-list-collapse-btn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        toggleMemberList();
      });
    }

    const expandBtn = document.getElementById('member-list-expand-btn');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        toggleMemberList();
      });
    }

    // ─── App Lock ──────────────────────────────────────────────────────────

    const appLockEnableToggle = document.getElementById(
      'plugin-app-lock-enable'
    ) as HTMLInputElement | null;
    const appLockTimeoutInput = document.getElementById(
      'plugin-app-lock-timeout'
    ) as HTMLInputElement | null;
    const appLockTimeoutDisplay = document.getElementById(
      'plugin-app-lock-timeout-display'
    ) as HTMLElement | null;
    const appLockFocusLossToggle = document.getElementById(
      'plugin-app-lock-focus-loss'
    ) as HTMLInputElement | null;
    const appLockFocusDelayInput = document.getElementById(
      'plugin-app-lock-focus-delay'
    ) as HTMLInputElement | null;
    const appLockSetPinBtn = document.getElementById(
      'plugin-app-lock-set-pin-btn'
    ) as HTMLButtonElement | null;
    const appLockClearPinBtn = document.getElementById(
      'plugin-app-lock-clear-pin-btn'
    ) as HTMLButtonElement | null;
    const appLockPinSetup = document.getElementById(
      'plugin-app-lock-pin-setup'
    ) as HTMLElement | null;
    const appLockNewPin = document.getElementById(
      'plugin-app-lock-new-pin'
    ) as HTMLInputElement | null;
    const appLockConfirmPin = document.getElementById(
      'plugin-app-lock-confirm-pin'
    ) as HTMLInputElement | null;
    const appLockSavePinBtn = document.getElementById(
      'plugin-app-lock-save-pin-btn'
    ) as HTMLButtonElement | null;
    const appLockPinError = document.getElementById(
      'plugin-app-lock-pin-error'
    ) as HTMLElement | null;
    const appLockHasPinText = document.getElementById(
      'plugin-app-lock-has-pin-text'
    ) as HTMLElement | null;
    const appLockPinWarning = document.getElementById(
      'plugin-app-lock-pin-warning'
    ) as HTMLElement | null;

    function updateAppLockDependentVisibility(): void {
      const isEnabled = appLockEnableToggle?.checked ?? false;
      const dependentElements = document.querySelectorAll('.app-lock-dependent');

      dependentElements.forEach(element => {
        if (isEnabled) {
          element.classList.remove('hidden');
        } else {
          element.classList.add('hidden');
        }
      });
    }

    if (appLockEnableToggle) {
      appLockEnableToggle.checked = settings.appLock.enabled;
      appLockEnableToggle.addEventListener('change', async () => {
        settings = {
          ...settings,
          appLock: { ...settings.appLock, enabled: appLockEnableToggle.checked },
        };
        saveSettings(settings);
        if (typeof window.updateAppLockSettings === 'function') {
          window.updateAppLockSettings({ enabled: settings.appLock.enabled });
        }
        updateAppLockDependentVisibility();
        log.info('App lock enabled setting changed', { enabled: String(settings.appLock.enabled) });
      });
    }

    if (appLockTimeoutInput) {
      appLockTimeoutInput.value = String(settings.appLock.idleTimeoutMinutes);
      if (appLockTimeoutDisplay) {
        appLockTimeoutDisplay.textContent = `${settings.appLock.idleTimeoutMinutes} min`;
      }
      appLockTimeoutInput.addEventListener('input', () => {
        const mins = parseInt(appLockTimeoutInput.value, 10);
        if (isNaN(mins) || mins < 1) return;
        if (appLockTimeoutDisplay) {
          appLockTimeoutDisplay.textContent = `${mins} min`;
        }
        settings = {
          ...settings,
          appLock: { ...settings.appLock, idleTimeoutMinutes: mins },
        };
        saveSettings(settings);
        if (typeof window.updateAppLockSettings === 'function') {
          window.updateAppLockSettings({ idleTimeoutMinutes: mins });
        }
      });
    }

    if (appLockFocusLossToggle) {
      appLockFocusLossToggle.checked = settings.appLock.lockOnFocusLoss;
      appLockFocusLossToggle.addEventListener('change', () => {
        settings = {
          ...settings,
          appLock: { ...settings.appLock, lockOnFocusLoss: appLockFocusLossToggle.checked },
        };
        saveSettings(settings);
        if (typeof window.updateAppLockSettings === 'function') {
          window.updateAppLockSettings({ lockOnFocusLoss: settings.appLock.lockOnFocusLoss });
        }
      });
    }

    if (appLockFocusDelayInput) {
      appLockFocusDelayInput.value = String(settings.appLock.focusLossDelaySeconds);
      appLockFocusDelayInput.addEventListener('change', () => {
        const secs = parseInt(appLockFocusDelayInput.value, 10);
        if (isNaN(secs) || secs < 1) return;
        settings = {
          ...settings,
          appLock: { ...settings.appLock, focusLossDelaySeconds: secs },
        };
        saveSettings(settings);
        if (typeof window.updateAppLockSettings === 'function') {
          window.updateAppLockSettings({ focusLossDelaySeconds: secs });
        }
      });
    }

    // PIN setup
    if (appLockSetPinBtn && appLockPinSetup) {
      appLockSetPinBtn.addEventListener('click', () => {
        appLockPinSetup.classList.remove('hidden');
        if (appLockNewPin) appLockNewPin.value = '';
        if (appLockConfirmPin) appLockConfirmPin.value = '';
        if (appLockPinError) appLockPinError.classList.add('hidden');
      });
    }

    if (appLockSavePinBtn && appLockNewPin && appLockConfirmPin) {
      appLockSavePinBtn.addEventListener('click', async () => {
        const pin = appLockNewPin.value.trim();
        const confirm = appLockConfirmPin.value.trim();

        if (pin.length < 4) {
          if (appLockPinError) {
            appLockPinError.textContent = 'PIN must be at least 4 digits.';
            appLockPinError.classList.remove('hidden');
          }
          return;
        }

        if (pin !== confirm) {
          if (appLockPinError) {
            appLockPinError.textContent = 'PINs do not match.';
            appLockPinError.classList.remove('hidden');
          }
          return;
        }

        try {
          await window.electronAPI.ipc.invoke('set-pin', pin);
          if (appLockPinSetup) appLockPinSetup.classList.add('hidden');
          if (appLockHasPinText) appLockHasPinText.textContent = 'PIN is set.';
          if (appLockPinWarning) appLockPinWarning.classList.add('hidden');
          log.info('App lock PIN saved');
        } catch (err) {
          if (appLockPinError) {
            appLockPinError.textContent = 'Failed to save PIN.';
            appLockPinError.classList.remove('hidden');
          }
          log.error('Failed to save PIN', { error: String(err) });
        }
      });
    }

    if (appLockClearPinBtn) {
      appLockClearPinBtn.addEventListener('click', async () => {
        try {
          await window.electronAPI.ipc.invoke('clear-pin');
          if (appLockHasPinText) appLockHasPinText.textContent = 'No PIN set.';
          if (appLockPinWarning) appLockPinWarning.classList.remove('hidden');
          log.info('App lock PIN cleared');
        } catch (err) {
          log.error('Failed to clear PIN', { error: String(err) });
        }
      });
    }

    // Show PIN status on open
    (async () => {
      try {
        const hasPin = (await window.electronAPI.ipc.invoke('has-pin')) as boolean;
        if (appLockHasPinText) {
          appLockHasPinText.textContent = hasPin ? 'PIN is set.' : 'No PIN set.';
        }
        if (appLockPinWarning) {
          if (hasPin) {
            appLockPinWarning.classList.add('hidden');
          } else {
            appLockPinWarning.classList.remove('hidden');
          }
        }
      } catch {
        // non-fatal
      }
    })();

    // Initialize visibility state
    updateAppLockDependentVisibility();
  }

  window.initPluginSettings = initPluginSettings;
  window.getPluginSettings = loadSettings;
  window.toggleMemberList = toggleMemberList;
  window.isMemberListCollapsed = isMemberListCollapsed;

  initPluginSettings();
})();
