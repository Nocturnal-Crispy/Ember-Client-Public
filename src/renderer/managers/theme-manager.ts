/**
 * theme-manager.ts
 *
 * Manages theme selection, persistence, and application.
 * Applies the saved theme on startup by updating :root CSS variables.
 * Exposes window.initThemeSettings() for the settings modal.
 *
 * IIFE pattern: avoids global scope pollution.
 */
(function (): void {
  const log = window.emberLog.createLogger("ThemeManager");
  const ipcRenderer = window.electronAPI.ipc;

  // ─── Preset definitions ────────────────────────────────────────────────────

  const PRESETS: ThemePreset[] = [
    {
      id: "ember",
      name: "Ember",
      accentRgb: "255, 120, 80",
      backgroundRgb: "20, 20, 25",
      surfaceRgb: "30, 30, 35",
    },
    {
      id: "sapphire",
      name: "Sapphire",
      accentRgb: "88, 101, 242",
      backgroundRgb: "20, 20, 25",
      surfaceRgb: "30, 30, 35",
    },
    {
      id: "jade",
      name: "Jade",
      accentRgb: "67, 181, 129",
      backgroundRgb: "18, 22, 20",
      surfaceRgb: "26, 32, 28",
    },
    {
      id: "ruby",
      name: "Ruby",
      accentRgb: "220, 60, 60",
      backgroundRgb: "22, 18, 18",
      surfaceRgb: "32, 26, 26",
    },
    {
      id: "violet",
      name: "Violet",
      accentRgb: "156, 89, 209",
      backgroundRgb: "20, 18, 26",
      surfaceRgb: "28, 26, 36",
    },
    {
      id: "arctic",
      name: "Arctic",
      accentRgb: "0, 185, 210",
      backgroundRgb: "16, 20, 24",
      surfaceRgb: "24, 30, 34",
    },
    {
      id: "matrix",
      name: "Matrix",
      accentRgb: "0, 209, 0",
      backgroundRgb: "0, 0, 0",
      surfaceRgb: "10, 10, 10",
    },
  ];

  const DEFAULT_SETTINGS: ThemeSettings = {
    themeId: "ember",
    accentRgb: "255, 120, 80",
    backgroundRgb: "20, 20, 25",
    surfaceRgb: "30, 30, 35",
    chatColor: "",
  };

  // ─── State ─────────────────────────────────────────────────────────────────

  let pendingSettings: ThemeSettings = { ...DEFAULT_SETTINGS };
  let eventsWired = false;

  // ─── Utilities ─────────────────────────────────────────────────────────────

  function hexToRgbStr(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
  }

  function rgbStrToHex(rgb: string): string {
    const parts = rgb.split(",").map((s) => parseInt(s.trim(), 10));
    return "#" + parts.map((n) => n.toString(16).padStart(2, "0")).join("");
  }

  function computeSurfaceHover(surfaceRgb: string): string {
    const parts = surfaceRgb.split(",").map((s) => parseInt(s.trim(), 10));
    const bumped = parts.map((n) => Math.min(255, n + 10));
    return bumped.join(", ");
  }

  // ─── Apply theme to DOM ────────────────────────────────────────────────────

  function applyThemeToDom(settings: ThemeSettings): void {
    const root = document.documentElement;
    root.style.setProperty("--rgb-highlight", settings.accentRgb);
    root.style.setProperty("--rgb-background", settings.backgroundRgb);
    root.style.setProperty("--rgb-surface", settings.surfaceRgb);
    root.style.setProperty(
      "--rgb-surface-hover",
      computeSurfaceHover(settings.surfaceRgb)
    );
    if (settings.chatColor) {
      root.style.setProperty("--chat-color", settings.chatColor);
    } else {
      root.style.removeProperty("--chat-color");
    }
  }

  // ─── Startup application ───────────────────────────────────────────────────

  async function applyThemeOnStartup(): Promise<void> {
    try {
      const saved = (await ipcRenderer.invoke(
        "get-theme-settings"
      )) as ThemeSettings;
      pendingSettings = { ...saved };
      applyThemeToDom(pendingSettings);
      log.debug("Theme applied on startup", { themeId: pendingSettings.themeId });
    } catch (e) {
      log.error("Failed to load theme on startup", { error: String(e) });
    }
  }

  // ─── Settings page UI ──────────────────────────────────────────────────────

  function renderPresetCards(): void {
    const grid = document.getElementById("theme-presets-grid");
    if (!grid) return;

    grid.replaceChildren();

    for (const preset of PRESETS) {
      const card = document.createElement("div");
      card.className = "theme-preset-card";
      card.dataset["themeId"] = preset.id;
      if (preset.id === pendingSettings.themeId) {
        card.classList.add("active");
      }

      const swatch = document.createElement("div");
      swatch.className = "theme-preset-swatch";
      swatch.style.backgroundColor = `rgb(${preset.accentRgb})`;

      const name = document.createElement("span");
      name.className = "theme-preset-name";
      name.textContent = preset.name;

      const check = document.createElement("span");
      check.className = "theme-preset-check";
      check.textContent = "✓";

      card.appendChild(swatch);
      card.appendChild(name);
      card.appendChild(check);

      card.addEventListener("click", () => selectPreset(preset));
      grid.appendChild(card);
    }
  }

  function selectPreset(preset: ThemePreset): void {
    pendingSettings = {
      themeId: preset.id,
      accentRgb: preset.accentRgb,
      backgroundRgb: preset.backgroundRgb,
      surfaceRgb: preset.surfaceRgb,
    };
    applyThemeToDom(pendingSettings);
    updateActiveCard();
    syncColorPicker();
    updateSwatches();
  }

  function updateActiveCard(): void {
    document.querySelectorAll<HTMLElement>(".theme-preset-card").forEach((card) => {
      card.classList.toggle(
        "active",
        card.dataset["themeId"] === pendingSettings.themeId
      );
    });
  }

  function syncColorPicker(): void {
    const picker = document.getElementById(
      "theme-accent-picker"
    ) as HTMLInputElement | null;
    const valueEl = document.getElementById("theme-accent-value");

    if (picker) {
      picker.value = rgbStrToHex(pendingSettings.accentRgb);
    }
    if (valueEl) {
      valueEl.textContent = `rgb(${pendingSettings.accentRgb})`;
    }
  }

  function syncChatColorPicker(): void {
    const picker = document.getElementById(
      "theme-chat-color-picker"
    ) as HTMLInputElement | null;
    if (picker) {
      picker.value = pendingSettings.chatColor
        ? pendingSettings.chatColor
        : rgbStrToHex(pendingSettings.accentRgb);
    }
  }

  function updateSwatches(): void {
    const accentSwatch = document.getElementById("theme-swatch-accent") as HTMLElement | null;
    const bgSwatch = document.getElementById("theme-swatch-bg") as HTMLElement | null;
    const surfaceSwatch = document.getElementById("theme-swatch-surface") as HTMLElement | null;

    if (accentSwatch) {
      accentSwatch.style.backgroundColor = `rgb(${pendingSettings.accentRgb})`;
    }
    if (bgSwatch) {
      bgSwatch.style.backgroundColor = `rgb(${pendingSettings.backgroundRgb})`;
    }
    if (surfaceSwatch) {
      surfaceSwatch.style.backgroundColor = `rgb(${pendingSettings.surfaceRgb})`;
    }
  }

  function wireThemeEvents(): void {
    const picker = document.getElementById(
      "theme-accent-picker"
    ) as HTMLInputElement | null;
    const chatColorPicker = document.getElementById(
      "theme-chat-color-picker"
    ) as HTMLInputElement | null;
    const chatColorReset = document.getElementById("theme-chat-color-reset");
    const saveBtn = document.getElementById("theme-save-btn");

    if (picker) {
      picker.addEventListener("input", () => {
        const accentRgb = hexToRgbStr(picker.value);
        pendingSettings = { ...pendingSettings, themeId: "custom", accentRgb };
        applyThemeToDom(pendingSettings);
        updateActiveCard();
        updateSwatches();
        const valueEl = document.getElementById("theme-accent-value");
        if (valueEl) valueEl.textContent = `rgb(${accentRgb})`;
        // If no custom chat color is set, update picker to track accent
        if (!pendingSettings.chatColor) {
          syncChatColorPicker();
        }
      });
    }

    if (chatColorPicker) {
      chatColorPicker.addEventListener("input", () => {
        pendingSettings = { ...pendingSettings, chatColor: chatColorPicker.value };
        applyThemeToDom(pendingSettings);
      });
    }

    if (chatColorReset) {
      chatColorReset.addEventListener("click", () => {
        pendingSettings = { ...pendingSettings, chatColor: "" };
        applyThemeToDom(pendingSettings);
        syncChatColorPicker();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", saveTheme);
    }
  }

  async function pushChatColorToServer(chatColor: string): Promise<void> {
    try {
      const auth = (await ipcRenderer.invoke("get-auth")) as { token?: string; hostname?: string } | null;
      if (!auth?.token || !auth?.hostname) return;
      await fetch(`${auth.hostname}/api/v1/chat-color`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ chat_color: chatColor }),
      });
    } catch (e) {
      log.warn("Failed to push chat color to server", { error: String(e) });
    }
  }

  async function saveTheme(): Promise<void> {
    const saveStatus = document.getElementById("theme-save-status");
    try {
      await ipcRenderer.invoke("save-theme-settings", pendingSettings);
      await pushChatColorToServer(pendingSettings.chatColor ?? "");
      log.info("Theme saved", { themeId: pendingSettings.themeId });
      if (saveStatus) {
        saveStatus.textContent = "Saved!";
        setTimeout(() => {
          saveStatus.textContent = "";
        }, 2500);
      }
    } catch (e) {
      log.error("Failed to save theme", { error: String(e) });
      if (saveStatus) {
        saveStatus.textContent = "Failed to save.";
        saveStatus.style.color = "rgba(240, 71, 71, 0.9)";
        setTimeout(() => {
          saveStatus.textContent = "";
          saveStatus.style.color = "";
        }, 3000);
      }
    }
  }

  // ─── Public: called by switchSettingsPage('themes') ───────────────────────

  async function initThemeSettings(): Promise<void> {
    try {
      const saved = (await ipcRenderer.invoke(
        "get-theme-settings"
      )) as ThemeSettings;
      pendingSettings = { ...saved };
    } catch (e) {
      log.error("Failed to load theme settings", { error: String(e) });
    }

    renderPresetCards();
    syncColorPicker();
    syncChatColorPicker();
    updateSwatches();

    if (!eventsWired) {
      wireThemeEvents();
      eventsWired = true;
    }
  }

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  applyThemeOnStartup();

  window.initThemeSettings = initThemeSettings;
})();
