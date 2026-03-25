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

  let PRESETS: ThemePreset[] = [
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

  function isValidRgbStr(value: unknown): boolean {
    if (typeof value !== 'string' || value.trim() === '') return false;
    const parts = value.split(',');
    if (parts.length !== 3) return false;
    return parts.every(part => {
      const n = parseInt(part.trim(), 10);
      return !isNaN(n) && n >= 0 && n <= 255;
    });
  }

  function isValidThemeSettings(settings: unknown): settings is ThemeSettings {
    if (!settings || typeof settings !== 'object') return false;
    const s = settings as Record<string, unknown>;
    return (
      typeof s['themeId'] === 'string' && s['themeId'].length > 0 &&
      isValidRgbStr(s['accentRgb']) &&
      isValidRgbStr(s['backgroundRgb']) &&
      isValidRgbStr(s['surfaceRgb'])
    );
  }

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

      if (!isValidThemeSettings(saved)) {
        log.warn("Theme settings failed integrity check on startup; using defaults", {
          received: JSON.stringify(saved),
        });
        pendingSettings = { ...DEFAULT_SETTINGS };
      } else {
        pendingSettings = { ...saved };
      }

      applyThemeToDom(pendingSettings);

      // ─── Apply Custom UI Style Logic ───
      if ((window as any).initUIStyleState) {
          (window as any).initUIStyleState();
      }

      log.debug("Theme and UI Style applied on startup", { themeId: pendingSettings.themeId });
    } catch (e) {
      log.error("Failed to load theme on startup; using defaults", { error: String(e) });
      pendingSettings = { ...DEFAULT_SETTINGS };
      applyThemeToDom(pendingSettings);

      // Ensure it tries to load UI styles even if theme loading fails
      if ((window as any).initUIStyleState) {
          (window as any).initUIStyleState();
      }
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


// Only show delete button if it's a custom theme (IDs starting with 'custom-')
if (preset.id.startsWith("custom-")) {
    const deleteBtn = document.createElement("span");
    deleteBtn.className = "theme-preset-delete";
    deleteBtn.textContent = "✕"; // Multiplication X looks cleaner

    deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Prevents the card from being "selected" when you click delete
        deleteCustomPreset(preset.id);
    });

    card.appendChild(deleteBtn);
}

const swatchContainer = document.createElement("div");
swatchContainer.className = "theme-preset-swatch-container";
swatchContainer.style.backgroundColor = `rgb(${preset.backgroundRgb})`; // Set the Background color

const swatch = document.createElement("div");
swatch.className = "theme-preset-swatch";
swatch.style.backgroundColor = `rgb(${preset.accentRgb})`; // Set the Accent color


      const name = document.createElement("span");
      name.className = "theme-preset-name";
      name.textContent = preset.name;

      const check = document.createElement("span");
      check.className = "theme-preset-check";
      check.textContent = "✓";

swatchContainer.appendChild(swatch);
card.appendChild(swatchContainer); 
      card.appendChild(name);
      card.appendChild(check);

      card.addEventListener("click", () => selectPreset(preset));
      grid.appendChild(card);
    }
      // ─── Add custom theme ───
    const addBtn = document.createElement("div");
    addBtn.className = "theme-preset-card add-new-btn";
    addBtn.innerHTML = `<div class="theme-preset-swatch" style="background: #444; display: flex; align-items: center; justify-content: center; color: white;">+</div>
		      <span class="theme-preset-name">Add New</span>`;
  
    addBtn.addEventListener("click", () => createNewCustomPreset());
    grid.appendChild(addBtn);
    
  }

function createNewCustomPreset(): void {
    console.log("Add button clicked! Unhiding input...");
    
    const editor = document.getElementById("custom-theme-editor");
    const input = document.getElementById("custom-bg-picker") as HTMLInputElement;
    
    if (editor && input) {
        editor.style.display = "block"; 
        input.focus(); 
    } else {
        console.error("Missing elements:", { editor, input });
    }
}


  function selectPreset(preset: ThemePreset): void {
    pendingSettings = {
      themeId: preset.id,
      accentRgb: preset.accentRgb,
      backgroundRgb: preset.backgroundRgb,
      surfaceRgb: preset.surfaceRgb,
      chatColor: pendingSettings.chatColor ?? "",
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

    // --- STYLE INITIALIZATION ---
    if (typeof (window as any).initStylesSettings === "function") {
      (window as any).initStylesSettings();
    }
    // ------------------------------------------

    if (!eventsWired) {
      wireThemeEvents();
      eventsWired = true;
    }
  }


const bgPicker = document.getElementById("custom-bg-picker") as HTMLInputElement;
const bgValueDisplay = document.getElementById("custom-bg-value");

bgPicker?.addEventListener("input", (e) => {
    const hex = (e.target as HTMLInputElement).value;
    const rgb = hexToRgbStr(hex); 
    
    // Update the "live" state
    pendingSettings.backgroundRgb = rgb;
    
    // Update the UI swatches immediately
    if (bgValueDisplay) bgValueDisplay.textContent = `rgb(${rgb})`;
    updateSwatches(); 
    applyThemeToDom(pendingSettings); // Preview the change on the whole app!
});

function deleteCustomPreset(id: string): void {
    PRESETS = PRESETS.filter(p => p.id !== id);
    saveCustomPresetsToDisk();


    if (pendingSettings.themeId === id) {
        const defaultPreset = PRESETS.find(p => p.id === "ember") || PRESETS[0];
        selectPreset(defaultPreset);
    }

    // Refresh the UI
    renderPresetCards();
}

// Save and Load 
function saveCustomPresetsToDisk(): void {
    // We only want to save the themes starting with "custom-"
    const customOnly = PRESETS.filter(p => p.id.startsWith("custom-"));
    localStorage.setItem("ember_custom_themes", JSON.stringify(customOnly));
}


function loadCustomPresetsFromDisk(): void {
    const saved = localStorage.getItem("ember_custom_themes");
    if (saved) {
        const parsed: ThemePreset[] = JSON.parse(saved);
        // Add them to our live list
        PRESETS.push(...parsed);
    }
    if ((window as any).initUIStyleState) {
        (window as any).initUIStyleState();
    }
}

const saveBtn = document.getElementById("save-custom-btn");

saveBtn?.addEventListener("click", () => {
    const nameInput = document.getElementById("custom-name-input") as HTMLInputElement;
    const userName = nameInput.value.trim() || "Custom Theme";

    const newPreset: ThemePreset = {
      id: `custom-${Date.now()}`,
      name: userName,
      accentRgb: pendingSettings.accentRgb, 
      backgroundRgb: pendingSettings.backgroundRgb, // Already updated by the picker
      surfaceRgb: "30, 30, 35",
    };

    PRESETS.push(newPreset);
    saveCustomPresetsToDisk();
    renderPresetCards(); // Refresh the grid
    
    // Close editor
    const editor = document.getElementById("custom-theme-editor");
    if (editor) editor.style.display = "none";
});




  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  applyThemeOnStartup();
  loadCustomPresetsFromDisk();
        if ((window as any).initStylesSettings) {
      (window as any).initStylesSettings();
    }

  window.initThemeSettings = initThemeSettings;

})();

