/**
 * Plugin Settings Manager
 * Manages optional UI plugin toggles (stored in localStorage) and wires
 * up the Plugins settings page UI.
 */
(function (): void {
  const log = window.emberLog.createLogger("PluginSettings");

  const STORAGE_KEY = "ember_plugin_settings";

  const DEFAULT_SETTINGS: PluginSettings = {
    readAllButton: false,
  };

  function loadSettings(): PluginSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw) as Partial<PluginSettings>);
      }
    } catch {
      // ignore parse errors
    }
    return Object.assign({}, DEFAULT_SETTINGS);
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
    const settings = loadSettings();
    applySettings(settings);

    const readAllToggle = document.getElementById("plugin-read-all-btn") as HTMLInputElement | null;
    if (readAllToggle) {
      readAllToggle.checked = settings.readAllButton;
      readAllToggle.addEventListener("change", () => {
        const updated: PluginSettings = {
          ...settings,
          readAllButton: readAllToggle.checked,
        };
        saveSettings(updated);
        applySettings(updated);
        log.info("Plugin settings updated", { readAllButton: String(updated.readAllButton) });
      });
    }
  }

  window.initPluginSettings = initPluginSettings;
  window.getPluginSettings = loadSettings;

  initPluginSettings();
})();
