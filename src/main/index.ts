import { app, BrowserWindow, ipcMain, safeStorage, net, shell } from "electron";
import * as path from "path";
import Store from "electron-store";
import { createLogger } from "./logger";
import { isNewerVersion } from "./version-utils";
import { isDev } from "./dev";
import { VoiceVideoSettings, ThemeSettings, StoreSchema } from "../shared/types";
const { IPC_CHANNELS } = require("../shared/constants");

const log = createLogger("Main");

const store = new Store<StoreSchema>();

const defaultVoiceVideoSettings: VoiceVideoSettings = {
  inputDevice: "default",
  outputDevice: "default",
  inputVolume: 100,
  outputVolume: 100,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  autoSensitivity: true,
  sensitivityThreshold: 50,
  pushToTalk: false,
  pttKey: "Backquote",
  cameraDevice: "default",
  alwaysPreviewVideo: false,
  sounds: {
    mute: true,
    unmute: true,
    deafen: true,
    undeafen: true,
    userJoin: true,
    userLeave: true,
    disconnect: true,
  },
};

let mainWindow: BrowserWindow | null = null;
let pendingInviteLink: string | null = null;

//To turn on dev tools, change devTools: false to devTools: true in the webPreferences object

function createWindow(isAuthenticated: boolean) {
  log.info("Creating browser window", { authenticated: isAuthenticated });
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#36393f",
    icon: path.join(__dirname, "../../assets/icons/ember_1024x1024.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "../preload/index.js"),
      devTools: true,
      webSecurity: true, // Always enable web security for safety
      allowRunningInsecureContent: false, // Disable insecure content
    },
    frame: false,
    titleBarStyle: "hidden",
  });

  // Force all window.open calls to open in external browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log.info("Window open request intercepted", { url });
    // Only allow HTTPS URLs to open externally
    if (url.startsWith("https://")) {
      shell.openExternal(url);
    } else {
      log.warn("Blocked non-HTTPS URL from opening", { url });
    }
    return { action: 'deny' }; // Prevent the window from opening in Electron
  });

  if (isAuthenticated) {
    log.debug("Loading main app window");
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  } else {
    log.debug("Loading login window");
    mainWindow.loadFile(path.join(__dirname, "../renderer/login.html"));
  }

  mainWindow.on("closed", () => {
    log.info("Main window closed");
    mainWindow = null;
  });
}

function checkAuthentication(): boolean {
  log.debug("Checking authentication state");
  const auth = store.get("auth");
  const isAuth = !!(auth && auth.token && auth.user_id && auth.device_id);
  log.debug("Authentication check complete", { authenticated: isAuth });
  return isAuth;
}

// ─── IPC: Renderer log bridge ─────────────────────────────────────────────────

ipcMain.on(
  "log-to-console",
  (
    _event,
    payload: {
      level: string;
      context: string;
      message: string;
      data: Record<string, unknown> | null;
    }
  ) => {
    if (!payload || typeof payload !== "object") return;
    const ctx = `Renderer:${String(payload.context || "Unknown")}`;
    const msg = String(payload.message || "");
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : undefined;
    const rendererLog = createLogger(ctx);
    switch (String(payload.level || "INFO").toLowerCase()) {
      case "debug":
        rendererLog.debug(msg, data);
        break;
      case "warn":
        rendererLog.warn(msg, data);
        break;
      case "error":
        rendererLog.error(msg, data);
        break;
      default:
        rendererLog.info(msg, data);
    }
  }
);

// ─── IPC: Window controls ─────────────────────────────────────────────────────

ipcMain.on("window-minimize", () => {
  log.debug("Window minimize requested");
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on("window-maximize", () => {
  log.debug("Window maximize/restore requested");
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on("window-close", () => {
  log.debug("Window close requested");
  if (mainWindow) {
    mainWindow.close();
  }
});

// ─── IPC: Auth ────────────────────────────────────────────────────────────────

ipcMain.on("auth-success", () => {
  log.info("Auth success signal received, loading main window");
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
});

ipcMain.on("auth-logout", () => {
  log.info("Logout signal received, clearing auth and loading login window");
  store.delete("auth");
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, "../renderer/login.html"));
  }
});

// ─── Crypto helpers ───────────────────────────────────────────────────────────

function encryptPrivateKey(plaintext: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    log.debug("Encrypting private key with OS safeStorage");
    return safeStorage.encryptString(plaintext).toString("base64");
  }
  // Fallback: no OS keyring available; store as-is (same security as previous plaintext store)
  log.warn(
    "safeStorage unavailable; private key stored without OS-level encryption"
  );
  console.warn(
    "[ember] safeStorage unavailable; private key stored without OS-level encryption"
  );
  return plaintext;
}

function decryptPrivateKey(stored: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      log.debug("Decrypting private key from OS safeStorage");
      return safeStorage.decryptString(Buffer.from(stored, "base64"));
    } catch {
      // Stored in plaintext fallback format (safeStorage was unavailable at save time)
      log.warn("safeStorage decryption failed, using plaintext fallback");
      return stored;
    }
  }
  return stored;
}

// ─── IPC: Device identity ─────────────────────────────────────────────────────

ipcMain.handle("get-device-identity", () => {
  log.debug("IPC: get-device-identity");
  const device = store.get("device") ?? null;
  if (!device) {
    log.debug("No device identity found in store");
    return null;
  }

  // Migration: old builds stored private_key directly in the device object
  if (device.private_key) {
    log.info("Migrating device private key to safeStorage");
    const plaintextKey: string = device.private_key;
    const { private_key, ...deviceWithoutKey } = device;
    store.set("devicePrivateKey", encryptPrivateKey(plaintextKey));
    store.set("device", deviceWithoutKey);
    log.info("Device private key migration complete");
    return { ...deviceWithoutKey, private_key: plaintextKey };
  }

  const storedKey = store.get("devicePrivateKey");
  if (!storedKey) {
    log.debug("Device identity retrieved (no encrypted key stored)");
    return device;
  }

  log.debug("Device identity retrieved with encrypted private key");
  return { ...device, private_key: decryptPrivateKey(storedKey) };
});

ipcMain.handle("save-device-identity", (_event, deviceIdentity) => {
  log.debug("IPC: save-device-identity", {
    device_id: deviceIdentity?.device_id,
  });
  const { private_key, ...deviceWithoutKey } = deviceIdentity;
  store.set("device", deviceWithoutKey);
  if (private_key !== undefined) {
    store.set(
      "devicePrivateKey",
      encryptPrivateKey(String(private_key))
    );
    log.debug("Device identity saved with encrypted private key");
  } else {
    log.debug("Device identity saved (no private key provided)");
  }
  return true;
});

// ─── IPC: Auth storage ────────────────────────────────────────────────────────

ipcMain.handle("get-auth", () => {
  // log.debug('IPC: get-auth');
  const auth = store.get("auth") ?? null;
  // log.debug('Auth data retrieved', { has_auth: !!auth, username: auth?.username });
  return auth;
});

ipcMain.handle("save-auth", (_event, authData) => {
  log.info("IPC: save-auth", {
    username: authData?.username,
    user_id: authData?.user_id,
  });
  store.set("auth", authData);
  if (authData.hostname) {
    const settings = store.get("settings") ?? { last_hostname: "" };
    settings.last_hostname = authData.hostname;
    store.set("settings", settings);
    log.debug("Last hostname updated");
  }
  return true;
});

ipcMain.handle("get-last-hostname", () => {
  log.debug("IPC: get-last-hostname");
  const settings = store.get("settings");
  const hostname = settings?.last_hostname || "https://ember-chat.com";
  log.debug("Last hostname retrieved");
  return hostname;
});

// ─── IPC: Voice/video settings ────────────────────────────────────────────────

ipcMain.handle("get-voice-video-settings", () => {
  log.debug("IPC: get-voice-video-settings");
  const saved = store.get("voiceVideoSettings") ?? {} as Partial<VoiceVideoSettings>;
  return {
    ...defaultVoiceVideoSettings,
    ...saved,
    sounds: { ...defaultVoiceVideoSettings.sounds, ...(saved.sounds || {}) },
  };
});

ipcMain.handle(
  "save-voice-video-settings",
  (_event, settings: VoiceVideoSettings) => {
    log.debug("IPC: save-voice-video-settings");
    store.set("voiceVideoSettings", settings);
    log.info("Voice/video settings saved");
    return true;
  }
);

// ─── IPC: Theme settings ──────────────────────────────────────────────────────

const defaultThemeSettings: ThemeSettings = {
  themeId: 'ember',
  accentRgb: '255, 120, 80',
  backgroundRgb: '20, 20, 25',
  surfaceRgb: '30, 30, 35',
  chatColor: '',
};

ipcMain.handle("get-theme-settings", () => {
  log.debug("IPC: get-theme-settings");
  const saved = store.get("themeSettings") ?? {} as Partial<ThemeSettings>;
  return { ...defaultThemeSettings, ...saved };
});

ipcMain.handle(
  "save-theme-settings",
  (_event, settings: ThemeSettings) => {
    log.debug("IPC: save-theme-settings");
    store.set("themeSettings", settings);
    log.info("Theme settings saved");
    return true;
  }
);

// ─── IPC: Update check ────────────────────────────────────────────────────────

interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  error?: string;
}

ipcMain.handle("check-for-update", async (): Promise<UpdateInfo> => {
  const currentVersion = app.getVersion();
  try {
    const response = await net.fetch(
      "https://api.github.com/repos/Nocturnal-Crispy/Ember-Client-Public/releases/latest",
      { headers: { "User-Agent": "ember-client" } }
    );
    if (!response.ok) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        error: `HTTP ${response.status}`,
      };
    }
    const data = (await response.json()) as { tag_name?: string };
    const tag = data?.tag_name;
    if (
      typeof tag !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(tag.replace(/^v/, ""))
    ) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        error: "Invalid tag format",
      };
    }
    const latestVersion = tag.replace(/^v/, "");
    const updateAvailable = isNewerVersion(currentVersion, latestVersion);
    log.debug("Update check complete", {
      currentVersion,
      latestVersion,
      updateAvailable,
    });
    return { updateAvailable, currentVersion, latestVersion };
  } catch (err) {
    log.debug("Update check failed (network or parse error)");
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: null,
      error: String(err),
    };
  }
});

ipcMain.handle("open-external-url", (_event, url: unknown) => {
  if (typeof url !== "string" || !url.startsWith("https://")) return;
  shell.openExternal(url);
});

// ─── Invite protocol ──────────────────────────────────────────────────────────

function parseInviteUrl(
  url: string
): { code: string; hostname: string } | null {
  // ember://invite/<code>/<scheme>/<host>/<port>
  // e.g. ember://invite/abc123/http/localhost/8080
  const match = url.match(
    /^ember:\/\/invite\/([^/]+)\/([^/]+)\/([^/]+)(?:\/([^/]+))?/
  );
  if (!match) {
    log.warn("Failed to parse invite URL: pattern mismatch");
    return null;
  }
  const code = match[1];
  const scheme = match[2];
  const host = match[3];
  const port = match[4];

  // Only allow http/https schemes to prevent javascript: or file: injection
  if (scheme !== "http" && scheme !== "https") {
    log.warn("Rejected invite URL: invalid scheme", { scheme });
    return null;
  }

  // Validate host: must be a hostname or IP, no special characters
  if (!/^[a-zA-Z0-9.\-]+$/.test(host)) {
    log.warn("Rejected invite URL: invalid host");
    return null;
  }

  // Validate port if present: must be numeric
  if (port !== undefined && !/^\d{1,5}$/.test(port)) {
    log.warn("Rejected invite URL: invalid port");
    return null;
  }

  const hostname = port ? `${scheme}://${host}:${port}` : `${scheme}://${host}`;
  log.debug("Invite URL parsed successfully");
  return { code, hostname };
}

function handleInviteLink(url: string): void {
  log.debug("Handling invite link");
  const invite = parseInviteUrl(url);
  if (!invite) {
    log.warn("Invite link handling aborted: invalid URL");
    return;
  }
  if (mainWindow && mainWindow.webContents) {
    log.info("Sending invite link to renderer");
    log.debug("Invite data to send:", { invite });
    mainWindow.webContents.send("handle-invite-link", invite);
    log.debug("Invite data sent successfully");
  } else {
    log.info("No window available, storing invite as pending");
    pendingInviteLink = url;
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

// Set app name for Linux WM_CLASS to match desktop file Icon=ember-client
app.name = "ember-client";

log.info("Application starting...");

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.warn("Another instance is already running; quitting");
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    log.info("Second instance launched, focusing existing window");
    const url = commandLine.find((arg) => arg.startsWith("ember://"));
    if (url) {
      log.debug("Second instance passed an ember:// URL");
      handleInviteLink(url);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("open-url", (event, url) => {
    log.info("open-url event received");
    event.preventDefault();
    handleInviteLink(url);
  });

  app.setAsDefaultProtocolClient("ember");
  log.debug("Registered ember:// protocol handler");

  app.whenReady().then(() => {
    log.info("App ready");
    const isAuthenticated = checkAuthentication();
    createWindow(isAuthenticated);

    if (pendingInviteLink) {
      log.info("Processing pending invite link after window ready");
      setTimeout(() => {
        if (pendingInviteLink) {
          handleInviteLink(pendingInviteLink);
          pendingInviteLink = null;
        }
      }, 1500);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        log.info("App activated with no windows; creating new window");
        const isAuth = checkAuthentication();
        createWindow(isAuth);
      }
    });
  });
}

app.on("window-all-closed", () => {
  log.info("All windows closed");
  if (process.platform !== "darwin") {
    log.info("Quitting application");
    app.quit();
  }
});
