/**
 * Plugin Settings Manager
 * Manages optional UI plugin toggles (stored in localStorage) and wires
 * up the Plugins settings page UI.
 */
(function (): void {
  const log = window.emberLog.createLogger("PluginSettings");

  const STORAGE_KEY = "ember_plugin_settings";

  const DEFAULT_APP_LOCK: AppLockSettings = {
    enabled: false,
    idleTimeoutMinutes: 5,
    lockOnFocusLoss: false,
    focusLossDelaySeconds: 5,
  };

  const DEFAULT_SETTINGS: PluginSettings = {
    readAllButton: false,
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
    const btn = document.getElementById("read-all-btn") as HTMLElement | null;
    if (btn) {
      btn.style.display = settings.readAllButton ? "" : "none";
    }
  }

  function initPluginSettings(): void {
    let settings = loadSettings();
    applySettings(settings);

    const readAllToggle = document.getElementById("plugin-read-all-btn") as HTMLInputElement | null;
    if (readAllToggle) {
      readAllToggle.checked = settings.readAllButton;
      readAllToggle.addEventListener("change", () => {
        settings = {
          ...settings,
          readAllButton: readAllToggle.checked,
        };
        saveSettings(settings);
        applySettings(settings);
        log.info("Plugin settings updated", { readAllButton: String(settings.readAllButton) });
      });
    }

    // ─── App Lock ──────────────────────────────────────────────────────────

    const appLockEnableToggle = document.getElementById("plugin-app-lock-enable") as HTMLInputElement | null;
    const appLockTimeoutInput = document.getElementById("plugin-app-lock-timeout") as HTMLInputElement | null;
    const appLockTimeoutDisplay = document.getElementById("plugin-app-lock-timeout-display") as HTMLElement | null;
    const appLockFocusLossToggle = document.getElementById("plugin-app-lock-focus-loss") as HTMLInputElement | null;
    const appLockFocusDelayInput = document.getElementById("plugin-app-lock-focus-delay") as HTMLInputElement | null;
    const appLockSetPinBtn = document.getElementById("plugin-app-lock-set-pin-btn") as HTMLButtonElement | null;
    const appLockClearPinBtn = document.getElementById("plugin-app-lock-clear-pin-btn") as HTMLButtonElement | null;
    const appLockPinSetup = document.getElementById("plugin-app-lock-pin-setup") as HTMLElement | null;
    const appLockNewPin = document.getElementById("plugin-app-lock-new-pin") as HTMLInputElement | null;
    const appLockConfirmPin = document.getElementById("plugin-app-lock-confirm-pin") as HTMLInputElement | null;
    const appLockSavePinBtn = document.getElementById("plugin-app-lock-save-pin-btn") as HTMLButtonElement | null;
    const appLockPinError = document.getElementById("plugin-app-lock-pin-error") as HTMLElement | null;
    const appLockHasPinText = document.getElementById("plugin-app-lock-has-pin-text") as HTMLElement | null;

    if (appLockEnableToggle) {
      appLockEnableToggle.checked = settings.appLock.enabled;
      appLockEnableToggle.addEventListener("change", () => {
        settings = {
          ...settings,
          appLock: { ...settings.appLock, enabled: appLockEnableToggle.checked },
        };
        saveSettings(settings);
        if (typeof window.updateAppLockSettings === "function") {
          window.updateAppLockSettings({ enabled: settings.appLock.enabled });
        }
        log.info("App lock enabled setting changed", { enabled: String(settings.appLock.enabled) });
      });
    }

    if (appLockTimeoutInput) {
      appLockTimeoutInput.value = String(settings.appLock.idleTimeoutMinutes);
      if (appLockTimeoutDisplay) {
        appLockTimeoutDisplay.textContent = `${settings.appLock.idleTimeoutMinutes} min`;
      }
      appLockTimeoutInput.addEventListener("input", () => {
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
        if (typeof window.updateAppLockSettings === "function") {
          window.updateAppLockSettings({ idleTimeoutMinutes: mins });
        }
      });
    }

    if (appLockFocusLossToggle) {
      appLockFocusLossToggle.checked = settings.appLock.lockOnFocusLoss;
      appLockFocusLossToggle.addEventListener("change", () => {
        settings = {
          ...settings,
          appLock: { ...settings.appLock, lockOnFocusLoss: appLockFocusLossToggle.checked },
        };
        saveSettings(settings);
        if (typeof window.updateAppLockSettings === "function") {
          window.updateAppLockSettings({ lockOnFocusLoss: settings.appLock.lockOnFocusLoss });
        }
      });
    }

    if (appLockFocusDelayInput) {
      appLockFocusDelayInput.value = String(settings.appLock.focusLossDelaySeconds);
      appLockFocusDelayInput.addEventListener("change", () => {
        const secs = parseInt(appLockFocusDelayInput.value, 10);
        if (isNaN(secs) || secs < 1) return;
        settings = {
          ...settings,
          appLock: { ...settings.appLock, focusLossDelaySeconds: secs },
        };
        saveSettings(settings);
        if (typeof window.updateAppLockSettings === "function") {
          window.updateAppLockSettings({ focusLossDelaySeconds: secs });
        }
      });
    }

    // PIN setup
    if (appLockSetPinBtn && appLockPinSetup) {
      appLockSetPinBtn.addEventListener("click", () => {
        appLockPinSetup.classList.remove("hidden");
        if (appLockNewPin) appLockNewPin.value = "";
        if (appLockConfirmPin) appLockConfirmPin.value = "";
        if (appLockPinError) appLockPinError.classList.add("hidden");
      });
    }

    if (appLockSavePinBtn && appLockNewPin && appLockConfirmPin) {
      appLockSavePinBtn.addEventListener("click", async () => {
        const pin = appLockNewPin.value.trim();
        const confirm = appLockConfirmPin.value.trim();

        if (pin.length < 4) {
          if (appLockPinError) {
            appLockPinError.textContent = "PIN must be at least 4 digits.";
            appLockPinError.classList.remove("hidden");
          }
          return;
        }

        if (pin !== confirm) {
          if (appLockPinError) {
            appLockPinError.textContent = "PINs do not match.";
            appLockPinError.classList.remove("hidden");
          }
          return;
        }

        try {
          await window.electronAPI.ipc.invoke("set-pin", pin);
          if (appLockPinSetup) appLockPinSetup.classList.add("hidden");
          if (appLockHasPinText) appLockHasPinText.textContent = "PIN is set.";
          log.info("App lock PIN saved");
        } catch (err) {
          if (appLockPinError) {
            appLockPinError.textContent = "Failed to save PIN.";
            appLockPinError.classList.remove("hidden");
          }
          log.error("Failed to save PIN", { error: String(err) });
        }
      });
    }

    if (appLockClearPinBtn) {
      appLockClearPinBtn.addEventListener("click", async () => {
        try {
          await window.electronAPI.ipc.invoke("clear-pin");
          if (appLockHasPinText) appLockHasPinText.textContent = "No PIN set.";
          log.info("App lock PIN cleared");
        } catch (err) {
          log.error("Failed to clear PIN", { error: String(err) });
        }
      });
    }

    // Show PIN status on open
    (async () => {
      try {
        const hasPin = (await window.electronAPI.ipc.invoke("has-pin")) as boolean;
        if (appLockHasPinText) {
          appLockHasPinText.textContent = hasPin ? "PIN is set." : "No PIN set.";
        }
      } catch {
        // non-fatal
      }
    })();
  }

  window.initPluginSettings = initPluginSettings;
  window.getPluginSettings = loadSettings;

  initPluginSettings();
})();
