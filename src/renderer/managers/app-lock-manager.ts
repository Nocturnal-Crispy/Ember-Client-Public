/**
 * App Lock Manager
 *
 * Provides client-level application locking with:
 *   - AFK detection (idle timeout)
 *   - Focus-loss detection (window blur)
 *   - PIN-based unlock via Electron safeStorage
 *
 * Exports (via window):
 *   initAppLock()                    — initialize event listeners and timers
 *   lockApp()                        — lock the application
 *   unlockApp(pin): Promise<boolean> — attempt to unlock with PIN
 *   isAppLocked(): boolean           — current lock state
 *   updateAppLockSettings(settings)  — update settings and reset timers
 */
(function (): void {
  const log = window.emberLog.createLogger('AppLockManager');

  const MAX_FAILED_ATTEMPTS = 5;
  const LOCKOUT_DURATION_MS = 30_000;
  const IDLE_CHECK_INTERVAL_MS = 10_000;

  // ─── State ──────────────────────────────────────────────────────────────────

  let locked = false;
  let failedAttempts = 0;
  let lockedOutUntil: number | null = null;
  let lastActivityTime = Date.now();
  let idleIntervalId: ReturnType<typeof setInterval> | null = null;
  let focusLossTimerId: ReturnType<typeof setTimeout> | null = null;
  let currentSettings: AppLockSettings;

  // ─── DOM refs ────────────────────────────────────────────────────────────────

  const overlay = document.getElementById('app-lock-overlay');
  const pinInput = document.getElementById('app-lock-pin-input') as HTMLInputElement | null;
  const errorEl = document.getElementById('app-lock-error');
  const lockoutEl = document.getElementById('app-lock-lockout');
  const submitBtn = document.getElementById('app-lock-submit-btn');

  // ─── Settings ────────────────────────────────────────────────────────────────

  function loadSettings(): AppLockSettings {
    const plugin = window.getPluginSettings();
    return { ...plugin.appLock };
  }

  // ─── Lock / unlock ───────────────────────────────────────────────────────────

  function showOverlay(): void {
    if (!overlay) return;
    overlay.classList.remove('hidden');
    if (pinInput) {
      pinInput.value = '';
      pinInput.focus();
    }
    if (errorEl) errorEl.classList.add('hidden');
    if (lockoutEl) lockoutEl.classList.add('hidden');
  }

  function hideOverlay(): void {
    if (!overlay) return;
    overlay.classList.add('hidden');
    if (errorEl) errorEl.classList.add('hidden');
    if (lockoutEl) lockoutEl.classList.add('hidden');
  }

  async function lockApp(): Promise<void> {
    if (!currentSettings.enabled) return;
    if (locked) return;

    // Check if PIN is set before allowing lock
    try {
      const hasPin = (await window.electronAPI.ipc.invoke('has-pin')) as boolean;
      if (!hasPin) {
        // Show bold red alert for missing PIN
        alert(
          '🚨 SECURITY ALERT: No PIN set!\n\nApp Lock cannot be enabled without setting a PIN first.\n\nPlease set a PIN in Settings > Plugins > App Lock before enabling this feature.'
        );
        log.warn('App lock blocked - no PIN set');
        return;
      }
    } catch (err) {
      log.error('Failed to check PIN status', { error: String(err) });
      // Don't proceed if we can't verify PIN status
      return;
    }

    locked = true;
    failedAttempts = 0;
    lockedOutUntil = null;
    lastActivityTime = Date.now();
    showOverlay();
    log.info('Application locked');
  }

  async function unlockApp(pin: string): Promise<boolean> {
    if (!locked) return true;

    // Check lockout
    if (lockedOutUntil !== null) {
      if (Date.now() < lockedOutUntil) {
        log.warn('Unlock attempt blocked — lockout active');
        return false;
      }
      // Lockout expired
      lockedOutUntil = null;
      failedAttempts = 0;
      if (lockoutEl) lockoutEl.classList.add('hidden');
    }

    let verified = false;
    try {
      verified = (await window.electronAPI.ipc.invoke('verify-pin', pin)) as boolean;
    } catch (err) {
      log.error('PIN verification failed', { error: String(err) });
      return false;
    }

    if (verified) {
      locked = false;
      failedAttempts = 0;
      lockedOutUntil = null;
      lastActivityTime = Date.now();
      hideOverlay();
      log.info('Application unlocked');
      return true;
    }

    failedAttempts++;
    log.warn('Incorrect PIN entered', { attempt: String(failedAttempts) });

    if (errorEl) errorEl.classList.remove('hidden');

    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      lockedOutUntil = Date.now() + LOCKOUT_DURATION_MS;
      if (lockoutEl) lockoutEl.classList.remove('hidden');
      if (errorEl) errorEl.classList.add('hidden');
      log.warn('Too many failed attempts — lockout started');
    }

    return false;
  }

  function isAppLocked(): boolean {
    return locked;
  }

  // ─── Activity tracking ───────────────────────────────────────────────────────

  function resetActivity(): void {
    lastActivityTime = Date.now();
  }

  const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'mousedown'] as const;
  let activityListenersAttached = false;

  function detachActivityListeners(): void {
    if (!activityListenersAttached) return;
    for (const evt of ACTIVITY_EVENTS) {
      document.removeEventListener(evt, resetActivity);
    }
    activityListenersAttached = false;
  }

  function attachActivityListeners(): void {
    detachActivityListeners();
    for (const evt of ACTIVITY_EVENTS) {
      document.addEventListener(evt, resetActivity, { passive: true });
    }
    activityListenersAttached = true;
  }

  // ─── Idle timer ──────────────────────────────────────────────────────────────

  function startIdleTimer(): void {
    stopIdleTimer();
    if (!currentSettings.enabled) return;

    const timeoutMs = currentSettings.idleTimeoutMinutes * 60_000;
    idleIntervalId = setInterval(async () => {
      if (locked) return;
      if (Date.now() - lastActivityTime >= timeoutMs) {
        log.info('Idle timeout reached — locking application');
        await lockApp();
      }
    }, IDLE_CHECK_INTERVAL_MS);
  }

  function stopIdleTimer(): void {
    if (idleIntervalId !== null) {
      clearInterval(idleIntervalId);
      idleIntervalId = null;
    }
  }

  // ─── Focus loss ──────────────────────────────────────────────────────────────

  function handleBlur(): void {
    if (!currentSettings.enabled || !currentSettings.lockOnFocusLoss) return;
    if (locked) return;
    focusLossTimerId = setTimeout(async () => {
      await lockApp();
    }, currentSettings.focusLossDelaySeconds * 1_000);
  }

  function handleFocus(): void {
    if (focusLossTimerId !== null) {
      clearTimeout(focusLossTimerId);
      focusLossTimerId = null;
    }
  }

  // ─── Submit button ───────────────────────────────────────────────────────────

  function setupSubmitHandler(): void {
    if (!submitBtn || !pinInput) return;
    submitBtn.addEventListener('click', async () => {
      await unlockApp(pinInput.value);
    });
    pinInput.addEventListener('keydown', async (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        await unlockApp(pinInput.value);
      }
    });
  }

  // ─── updateAppLockSettings ───────────────────────────────────────────────────

  function updateAppLockSettings(settings: Partial<AppLockSettings>): void {
    currentSettings = { ...currentSettings, ...settings };
    log.info('App lock settings updated', {
      enabled: String(currentSettings.enabled),
      idleTimeoutMinutes: String(currentSettings.idleTimeoutMinutes),
    });

    if (!currentSettings.enabled) {
      stopIdleTimer();
      if (locked) {
        locked = false;
        hideOverlay();
      }
    } else {
      startIdleTimer();
    }
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  function initAppLock(): void {
    currentSettings = loadSettings();
    attachActivityListeners();
    startIdleTimer();
    // Use IPC events from main process for reliable OS-level focus detection
    window.electronAPI.ipc.on('window-blur', handleBlur);
    window.electronAPI.ipc.on('window-focus', handleFocus);
    setupSubmitHandler();
    log.info('AppLockManager initialized', {
      enabled: String(currentSettings.enabled),
      idleTimeoutMinutes: String(currentSettings.idleTimeoutMinutes),
    });
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────────

  /** Clean up all timers and listeners — call on logout to prevent leaks across sessions. */
  function cleanupAppLock(): void {
    stopIdleTimer();
    detachActivityListeners();
    if (focusLossTimerId !== null) {
      clearTimeout(focusLossTimerId);
      focusLossTimerId = null;
    }
    locked = false;
    hideOverlay();
    log.info('AppLockManager cleaned up');
  }

  window.initAppLock = initAppLock;
  window.lockApp = lockApp;
  window.unlockApp = unlockApp;
  window.isAppLocked = isAppLocked;
  window.updateAppLockSettings = updateAppLockSettings;
  window.cleanupAppLock = cleanupAppLock;
  window.cleanupAppLock = cleanupAppLock;

  initAppLock();
})();
