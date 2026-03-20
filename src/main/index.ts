import { app, BrowserWindow, ipcMain, safeStorage, net, shell, screen, desktopCapturer, dialog } from "electron";
import * as path from "path";
import * as nodeCrypto from "crypto";
import Store from "electron-store";
import { createLogger, writeToFile } from "./logger";
import { registerAudioCaptureHandlers, cleanOrphanedAudioModules, registerBeforeQuitCleanup } from "./audio-capture";
import { isNewerVersion } from "./version-utils";
import { isSteamUrl, toSteamProtocolUrl } from "./steam-utils";
import {
  selectAssetForPlatform,
  downloadAsset,
  cancelActiveDownload,
  launchInstaller,
  scheduleInstallOnExit,
  getInstallOnExitPath,
  findChecksumAsset,
  downloadChecksumText,
  verifyAssetChecksum,
} from "./update-downloader";
import { isDev } from "./dev";
import { KLIPPY_API_KEY } from "./api-key";
import { VoiceVideoSettings, ThemeSettings, StoreSchema, GifFavorite } from "../shared/types";
import { openSignalDatabase } from "./signal-db";
import type { SignalDatabase } from "./signal-db";
import { registerEmberIpcHandlers } from "./ipc/ember-ipc";
import { initializeAuthWithElectronSafeStorage, migrateDevicePrivateKeyToSafeStorage, electronSafeStorageFunctions } from "./auth-safe-storage";
import { migrateDeviceIdentity, generateRecoveryCode, encryptPrivateKeyWithRecoveryCode } from "ember-shared";
import { uploadSignedPreKey, uploadOneTimePreKeys } from "ember-shared";
import { PrivateKey } from "@signalapp/libsignal-client";
const { IPC_CHANNELS } = require("../shared/constants");

const log = createLogger("Main");

// ─── Theme defaults and validation ────────────────────────────────────────────

const defaultThemeSettings: ThemeSettings = {
  themeId: 'ember',
  accentRgb: '255, 120, 80',
  backgroundRgb: '20, 20, 25',
  surfaceRgb: '30, 30, 35',
  chatColor: '',
};

function isValidRgbString(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const parts = value.split(',');
  if (parts.length !== 3) return false;
  return parts.every(part => {
    const n = parseInt(part.trim(), 10);
    return !isNaN(n) && n >= 0 && n <= 255;
  });
}

function sanitizeThemeSettings(saved: Partial<ThemeSettings>): ThemeSettings {
  const result: ThemeSettings = { ...defaultThemeSettings };
  let repairedFields: string[] = [];

  if (typeof saved.themeId === 'string' && saved.themeId.length > 0) {
    result.themeId = saved.themeId;
  } else if (saved.themeId !== undefined) {
    repairedFields.push('themeId');
  }

  if (isValidRgbString(saved.accentRgb)) {
    result.accentRgb = saved.accentRgb!;
  } else if (saved.accentRgb !== undefined) {
    repairedFields.push('accentRgb');
  }

  if (isValidRgbString(saved.backgroundRgb)) {
    result.backgroundRgb = saved.backgroundRgb!;
  } else if (saved.backgroundRgb !== undefined) {
    repairedFields.push('backgroundRgb');
  }

  if (isValidRgbString(saved.surfaceRgb)) {
    result.surfaceRgb = saved.surfaceRgb!;
  } else if (saved.surfaceRgb !== undefined) {
    repairedFields.push('surfaceRgb');
  }

  // chatColor is optional; accept empty string or any non-null string value
  if (typeof saved.chatColor === 'string') {
    result.chatColor = saved.chatColor;
  }

  if (repairedFields.length > 0) {
    log.warn('Theme settings had invalid values; defaults applied', { repairedFields });
  }

  return result;
}

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
let signalDb: SignalDatabase | null = null;

// One-time context delivered to the pop-out window via get-popout-voice-context
let pendingPopoutContext: { channelName: string; token: string } | null = null;

// DevTools are enabled only in development builds (controlled by isDev)

function createWindow(isAuthenticated: boolean) {
  log.info("Creating browser window", { authenticated: isAuthenticated });
  
  // Get all displays to understand the setup
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  
  log.info("Display information", {
    totalDisplays: displays.length,
    primaryDisplayId: primaryDisplay.id,
    primaryDisplayBounds: primaryDisplay.bounds,
    primaryWorkArea: primaryDisplay.workAreaSize,
    allDisplays: displays.map(d => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workAreaSize,
      isPrimary: d.id === primaryDisplay.id
    }))
  });
  
  // Calculate window position to center on primary display
  const windowWidth = 1200;
  const windowHeight = 800;
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const x = primaryDisplay.workArea.x + Math.floor((screenWidth - windowWidth) / 2);
  const y = primaryDisplay.workArea.y + Math.floor((screenHeight - windowHeight) / 2);
  
  log.info("Calculated window position", {
    windowWidth,
    windowHeight,
    screenWidth,
    screenHeight,
    calculatedX: x,
    calculatedY: y,
    workAreaX: primaryDisplay.workArea.x,
    workAreaY: primaryDisplay.workArea.y
  });
  
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#36393f",
    icon: path.join(__dirname, "../../assets/icons/ember_1024x1024.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "../preload/index.js"),
      devTools: isDev,
      webSecurity: true, // Always enable web security for safety
      allowRunningInsecureContent: false, // Disable insecure content
    },
    frame: false,
    titleBarStyle: "hidden",
  });
  
  // Try multiple positioning approaches
  try {
    // Method 1: Set position directly
    mainWindow.setPosition(x, y);
    log.info("Set window position directly", { x, y });
    
    // Method 2: If that didn't work, try centering on primary display
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const currentBounds = mainWindow.getBounds();
        log.info("Current window bounds after positioning", {
          x: currentBounds.x,
          y: currentBounds.y,
          width: currentBounds.width,
          height: currentBounds.height
        });
        
        // If window is still not on primary display, try centering
        if (currentBounds.x < primaryDisplay.workArea.x || 
            currentBounds.x > primaryDisplay.workArea.x + primaryDisplay.workArea.width) {
          log.info("Window not on primary display, trying center() method");
          mainWindow.center();
          
          // Check final position
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              const finalBounds = mainWindow.getBounds();
              log.info("Final window bounds after center()", {
                x: finalBounds.x,
                y: finalBounds.y,
                width: finalBounds.width,
                height: finalBounds.height
              });
            }
          }, 100);
        }
      }
    }, 500);
  } catch (error) {
    log.error("Error positioning window", { error: String(error) });
    // Fallback to center
    mainWindow.center();
  }

  // Force all window.open calls to open in external browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log.info("Window open request intercepted", { url });
    // Only allow HTTPS URLs to open externally
    if (url.startsWith("https://")) {
      const target = isSteamUrl(url) ? toSteamProtocolUrl(url) : url;
      shell.openExternal(target).catch(() => {
        if (isSteamUrl(url)) {
          log.warn("Steam client not available, falling back to browser", { url });
          shell.openExternal(url).catch(() => undefined);
        }
      });
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

  mainWindow.on("blur", () => {
    log.debug("Main window lost focus");
    mainWindow?.webContents.send("window-blur");
  });

  mainWindow.on("focus", () => {
    log.debug("Main window gained focus");
    mainWindow?.webContents.send("window-focus");
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

// IPC: Renderer log to file (development only)
ipcMain.on("log-to-file", (_event, logMessage: string) => {
  if (typeof logMessage === "string") {
    writeToFile(logMessage);
  }
});

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

/**
 * Check whether the OS keyring is available and block the user with a
 * prominent dialog if it is not.  Called once at startup before any window
 * is created so the user can make an informed decision before Ember loads.
 *
 * If the user already has a stored device key AND safeStorage is now
 * unavailable, the key has been or will be stored without OS-level
 * encryption — a critical exposure.  In that case the dialog copy is
 * more urgent and the default action is Quit.
 */
function checkSafeStorageAtStartup(): void {
  if (safeStorage.isEncryptionAvailable()) return;

  const hasStoredKey = !!(store.get("devicePrivateKey") || store.get("device"));
  
  // Also check new safeStorage system
  const authData = store.get("auth") as any;
  let hasNewSafeStorageKeys = false;
  if (authData && authData.user_id && authData.device_id) {
    // We can't check async functions here, but we'll assume there might be keys
    // This is a best-effort check since we can't await in this sync function
    hasNewSafeStorageKeys = true;
  }
  
  if (hasStoredKey || hasNewSafeStorageKeys) {
    log.error("safeStorage unavailable at startup", { hasStoredKey, hasNewSafeStorageKeys });

    const message = hasStoredKey
      ? "Your device keyring is unavailable — private key at risk"
      : "Your device keyring is unavailable — some features may not work";

    dialog.showErrorBox("SafeStorage Unavailable", message);

    const choice = dialog.showMessageBoxSync({
      type: "warning",
      title: "SafeStorage Unavailable",
      message: "Your device keyring is unavailable due to system security settings.",
      detail: hasStoredKey
        ? "Your private keys are stored without OS-level encryption, which poses a security risk. It's recommended to quit and resolve the safeStorage issue."
        : "Some features may not work properly. Consider quitting and resolving the safeStorage issue.",
      buttons: ["Quit", "Continue Anyway"],
      defaultId: 0,
      cancelId: 1,
    });

    if (choice === 0) {
      log.info("User chose to quit due to unavailable safeStorage");
      app.exit(1);
    }

    log.warn("User chose to continue despite unavailable safeStorage");
  }
}

function encryptPrivateKey(plaintext: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    log.debug("Encrypting private key with OS safeStorage");
    return safeStorage.encryptString(plaintext).toString("base64");
  }
  log.warn("safeStorage unavailable; private key stored without OS-level encryption");
  return plaintext;
}

// ─── PIN helpers ──────────────────────────────────────────────────────────────

function hashPin(pin: string): string {
  const salt = nodeCrypto.randomBytes(16);
  const hash = nodeCrypto.scryptSync(pin, salt, 32);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

function verifyPinHash(pin: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const actual = nodeCrypto.scryptSync(pin, salt, 32);
  return nodeCrypto.timingSafeEqual(actual, expected);
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

ipcMain.handle("get-device-identity", async () => {
  log.debug("IPC: get-device-identity");
  const device = store.get("device") ?? null;
  if (!device) {
    log.debug("No device identity found in store");
    return null;
  }

  // Try to get private key from new safeStorage system first
  // Check for new Signal keys first
  const authData = store.get("auth") as any;
  if (authData && authData.user_id && authData.device_id) {
    const identityKey = await electronSafeStorageFunctions.getSafeStorage(`identity_key_${authData.user_id}_${authData.device_id}`);
    const legacyKey = await electronSafeStorageFunctions.getSafeStorage(`legacy_private_key_${authData.user_id}_${authData.device_id}`);
    
    if (legacyKey) {
      log.debug("Device identity retrieved with new safeStorage system");
      return { ...device, private_key: legacyKey };
    }
  }

  // Migration: old builds stored private_key directly in the device object
  if (device.private_key) {
    log.info("Migrating device private key to safeStorage");
    const plaintextKey: string = device.private_key;
    const { private_key, ...deviceWithoutKey } = device;
    store.set("devicePrivateKey", encryptPrivateKey(plaintextKey));
    store.set("device", deviceWithoutKey);
    log.info("Device private key migration complete");
    
    // Also migrate to new safeStorage system if we have auth data
    if (authData && authData.user_id && authData.device_id) {
      await electronSafeStorageFunctions.setSafeStorage(`legacy_private_key_${authData.user_id}_${authData.device_id}`, plaintextKey);
      store.delete("devicePrivateKey"); // Remove old storage after migration
    }
    
    return { ...deviceWithoutKey, private_key: plaintextKey };
  }

  const storedKey = store.get("devicePrivateKey");
  if (storedKey) {
    log.debug("Device identity retrieved with encrypted private key");
    const privateKey = decryptPrivateKey(storedKey as string);
    
    // Migrate to new safeStorage system if we have auth data
    if (authData && authData.user_id && authData.device_id) {
      await electronSafeStorageFunctions.setSafeStorage(`legacy_private_key_${authData.user_id}_${authData.device_id}`, privateKey);
      store.delete("devicePrivateKey"); // Remove old storage after migration
    }
    
    return { ...device, private_key: privateKey };
  }

  log.debug("Device identity retrieved (no private key stored)");
  return device;
});

ipcMain.handle("save-device-identity", async (_event, deviceIdentity) => {
  log.debug("IPC: save-device-identity", {
    device_id: deviceIdentity?.device_id,
  });
  const { private_key, ...deviceWithoutKey } = deviceIdentity;
  store.set("device", deviceWithoutKey);
  
  if (private_key !== undefined) {
    // Store in new safeStorage system if we have auth data
    const authData = store.get("auth") as any;
    if (authData && authData.user_id && authData.device_id) {
      await electronSafeStorageFunctions.setSafeStorage(`legacy_private_key_${authData.user_id}_${authData.device_id}`, String(private_key));
      log.debug("Device identity saved with new safeStorage system");
    } else {
      // Fallback to old method for backward compatibility
      store.set("devicePrivateKey", encryptPrivateKey(String(private_key)));
      log.debug("Device identity saved with encrypted private key (fallback)");
    }
  } else {
    log.debug("Device identity saved (no private key provided)");
  }
  return true;
});

// ─── IPC: Signal migration ────────────────────────────────────────────────────

ipcMain.handle("migrate-to-signal", async (_event, params: {
  hostname: string;
  token: string;
  device_id: string;
  user_id: string;
  legacy_private_key_b64: string;
}) => {
  log.info("IPC: migrate-to-signal", { device_id: params.device_id });
  try {
    const legacyPrivateKey = Buffer.from(params.legacy_private_key_b64, "base64");
    const migrationResult = await migrateDeviceIdentity(new Uint8Array(legacyPrivateKey));
    const identityKeyBase64 = Buffer.from(migrationResult.identityKeyPair.publicKey).toString("base64");
    const authData = { hostname: params.hostname, token: params.token, user_id: params.user_id, device_id: params.device_id, username: "" };

    // Store identity key pair in Signal DB
    if (signalDb) {
      const localAddress = `${params.user_id}.${params.device_id}`;
      signalDb.initializeLocalIdentity(
        {
          publicKey: Buffer.from(migrationResult.identityKeyPair.publicKey),
          privateKey: Buffer.from(migrationResult.identityKeyPair.privateKey),
        },
        migrationResult.registrationId,
        localAddress,
      );
      await signalDb.saveIdentity(localAddress, Buffer.from(migrationResult.identityKeyPair.publicKey));
      log.debug("Identity key stored in Signal DB", { address: localAddress });
    }

    // Upload signed prekey to server
    await uploadSignedPreKey(authData, migrationResult.signedPreKey);
    log.debug("Signed prekey uploaded");

    // Upload one-time prekeys to server
    await uploadOneTimePreKeys(authData, migrationResult.oneTimePreKeys);
    log.debug("One-time prekeys uploaded");

    // Generate proof of possession: sign(deviceId + identityKeyBase64)
    const message = Buffer.from(`${params.device_id}${identityKeyBase64}`);
    const identityPrivKey = PrivateKey.deserialize(Buffer.from(migrationResult.identityKeyPair.privateKey));
    const signature = identityPrivKey.sign(message);
    const proofOfPossession = Buffer.from(signature).toString("base64");

    // PATCH device on server
    const patchUrl = `${params.hostname}/api/v1/devices/${params.device_id}`;
    const patchResponse = await net.fetch(patchUrl, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({
        identity_key: identityKeyBase64,
        protocol_version: 1,
        proof_of_possession: proofOfPossession,
      }),
    });
    if (!patchResponse.ok) {
      const errText = await patchResponse.text().catch(() => "");
      throw new Error(`Device PATCH failed: ${patchResponse.status} ${errText}`);
    }

    // Store new identity key in safeStorage
    await electronSafeStorageFunctions.setSafeStorage(
      `identity_key_${params.user_id}_${params.device_id}`,
      Buffer.from(migrationResult.identityKeyPair.privateKey).toString("base64"),
    );

    // Re-encrypt recovery code with new identity key (24-digit code)
    let recoveryCode: string | undefined;
    try {
      const newRecoveryCode = generateRecoveryCode(24);
      const { encrypted, salt } = await encryptPrivateKeyWithRecoveryCode(
        new Uint8Array(migrationResult.identityKeyPair.privateKey),
        newRecoveryCode,
      );
      const recoveryPatchUrl = `${params.hostname}/api/v1/recovery-codes`;
      const recoveryResponse = await net.fetch(recoveryPatchUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.token}`,
        },
        body: JSON.stringify({ encrypted_device_key: encrypted, salt }),
      });
      if (recoveryResponse.ok) {
        recoveryCode = newRecoveryCode;
        log.info("Recovery code re-encrypted with new identity key");
      } else {
        log.warn("Recovery code re-encryption upload failed, user can re-encrypt later", {
          status: recoveryResponse.status,
        });
      }
    } catch (recoveryErr) {
      log.warn("Recovery code re-encryption failed, non-fatal", {
        error: (recoveryErr as Error).message,
      });
    }

    log.info("Signal migration complete", { device_id: params.device_id });
    return { status: "complete", identityKeyBase64, recoveryCode };
  } catch (err) {
    const error = err as Error;
    log.error("Signal migration failed", { error: error.message });
    return { status: "failed", error: error.message };
  }
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

ipcMain.handle("get-theme-settings", () => {
  log.debug("IPC: get-theme-settings");
  const saved = (store.get("themeSettings") ?? {}) as Partial<ThemeSettings>;
  const settings = sanitizeThemeSettings(saved);
  log.debug("Theme settings loaded", { themeId: settings.themeId });
  return settings;
});

ipcMain.handle(
  "save-theme-settings",
  (_event, settings: ThemeSettings) => {
    log.debug("IPC: save-theme-settings");
    const sanitized = sanitizeThemeSettings(settings as Partial<ThemeSettings>);
    store.set("themeSettings", sanitized);
    log.info("Theme settings saved", { themeId: sanitized.themeId });
    return true;
  }
);

// Synchronous handler used by the preload to apply the theme before the page renders,
// preventing a flash of default colors on startup.
ipcMain.on("get-theme-settings-sync", (event) => {
  log.debug("IPC: get-theme-settings-sync");
  const saved = (store.get("themeSettings") ?? {}) as Partial<ThemeSettings>;
  event.returnValue = sanitizeThemeSettings(saved);
});

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

interface UpdateDetails {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  downloadUrl: string | null;
  downloadSize: number | null;
  assetName: string | null;
  checksumUrl: string | null;
  error?: string;
}

ipcMain.handle("check-for-update-details", async (): Promise<UpdateDetails> => {
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
        releaseNotes: null,
        publishedAt: null,
        downloadUrl: null,
        downloadSize: null,
        assetName: null,
        checksumUrl: null,
        error: `HTTP ${response.status}`,
      };
    }
    const data = (await response.json()) as {
      tag_name?: string;
      body?: string;
      published_at?: string;
      assets?: Array<{ name: string; browser_download_url: string; size: number }>;
    };
    const tag = data?.tag_name;
    if (typeof tag !== "string" || !/^\d+\.\d+\.\d+$/.test(tag.replace(/^v/, ""))) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        releaseNotes: null,
        publishedAt: null,
        downloadUrl: null,
        downloadSize: null,
        assetName: null,
        checksumUrl: null,
        error: "Invalid tag format",
      };
    }
    const latestVersion = tag.replace(/^v/, "");
    const updateAvailable = isNewerVersion(currentVersion, latestVersion);
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const selected = selectAssetForPlatform(assets);
    const checksumAsset = selected ? findChecksumAsset(assets, selected) : null;
    log.debug("Update details fetched", {
      currentVersion,
      latestVersion,
      updateAvailable,
      assetName: selected?.name ?? null,
      hasChecksum: checksumAsset !== null,
    });
    return {
      updateAvailable,
      currentVersion,
      latestVersion,
      releaseNotes: typeof data.body === "string" ? data.body : null,
      publishedAt: typeof data.published_at === "string" ? data.published_at : null,
      downloadUrl: selected?.browser_download_url ?? null,
      downloadSize: selected?.size ?? null,
      assetName: selected?.name ?? null,
      checksumUrl: checksumAsset?.browser_download_url ?? null,
    };
  } catch (err) {
    log.debug("check-for-update-details failed");
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: null,
      releaseNotes: null,
      publishedAt: null,
      downloadUrl: null,
      downloadSize: null,
      assetName: null,
      checksumUrl: null,
      error: String(err),
    };
  }
});

ipcMain.handle(
  "download-update",
  async (
    _event,
    downloadUrl: unknown,
    assetName: unknown,
    assetSize: unknown,
    checksumUrl: unknown
  ): Promise<{ filePath: string } | { error: string }> => {
    if (
      typeof downloadUrl !== "string" ||
      typeof assetName !== "string" ||
      typeof assetSize !== "number"
    ) {
      return { error: "Invalid parameters" };
    }
    const resolvedChecksumUrl =
      typeof checksumUrl === "string" && checksumUrl.length > 0 ? checksumUrl : null;
    try {
      const result = await downloadAsset(
        { name: assetName, browser_download_url: downloadUrl, size: assetSize },
        (progress) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("update-download-progress", progress);
          }
        }
      );

      // Verify SHA-256 checksum when a companion checksum asset is available.
      if (resolvedChecksumUrl) {
        try {
          const checksumText = await downloadChecksumText(resolvedChecksumUrl);
          await verifyAssetChecksum(result.filePath, assetName, checksumText);
        } catch (checksumErr) {
          // Delete the untrusted file and abort the update.
          try { require("fs").unlinkSync(result.filePath); } catch { /* best-effort */ }
          const error = `Checksum verification failed: ${String(checksumErr)}`;
          log.error("Update aborted — checksum mismatch", { assetName, error });
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("update-download-error", { error });
          }
          return { error };
        }
      } else {
        log.warn("No checksum asset found for update; integrity unverified", { assetName });
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-download-complete", {
          filePath: result.filePath,
          assetName,
        });
      }
      return { filePath: result.filePath };
    } catch (err) {
      const error = String(err);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-download-error", { error });
      }
      return { error };
    }
  }
);

ipcMain.handle("cancel-download", () => {
  cancelActiveDownload();
  return true;
});

ipcMain.handle("install-update", async (_event, filePath: unknown) => {
  if (typeof filePath !== "string") return { error: "Invalid filePath" };
  try {
    await launchInstaller(filePath);
    // Give the OS a moment to open the installer before quitting
    setTimeout(() => app.quit(), 1500);
    return { success: true };
  } catch (err) {
    return { error: String(err) };
  }
});

ipcMain.handle("schedule-install-on-exit", (_event, filePath: unknown) => {
  if (typeof filePath !== "string") return false;
  scheduleInstallOnExit(filePath);
  return true;
});

ipcMain.handle("skip-version", (_event, version: unknown) => {
  if (typeof version !== "string") return false;
  store.set("skippedUpdateVersion", version);
  log.info("Update version skipped", { version });
  return true;
});

ipcMain.handle("get-skipped-version", () => {
  return store.get("skippedUpdateVersion") ?? null;
});

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

ipcMain.handle("get-klipy-api-key", () => {
  log.debug("IPC: get-klipy-api-key");
  // Return the obfuscated API key - this is available to all users
  // The key is obfuscated in the source code to make casual extraction harder
  return KLIPPY_API_KEY;
});

// ─── IPC: GIF favorites ───────────────────────────────────────────────────────

ipcMain.handle("get-gif-favorites", () => {
  log.debug("IPC: get-gif-favorites");
  return store.get("gifFavorites") ?? [];
});

ipcMain.handle("save-gif-favorites", (_event, favorites: unknown) => {
  log.debug("IPC: save-gif-favorites");
  if (!Array.isArray(favorites)) {
    log.warn("save-gif-favorites: invalid payload, expected array");
    return false;
  }
  store.set("gifFavorites", favorites as GifFavorite[]);
  return true;
});

ipcMain.handle("open-external-url", async (_event, url: unknown) => {
  if (typeof url !== "string" || !url.startsWith("https://")) return;
  if (isSteamUrl(url)) {
    try {
      await shell.openExternal(toSteamProtocolUrl(url));
      return;
    } catch {
      log.warn("Steam client not available, falling back to browser", { url });
    }
  }
  await shell.openExternal(url);
});

// ─── IPC: App lock PIN ────────────────────────────────────────────────────────

ipcMain.handle("has-pin", () => {
  log.debug("IPC: has-pin");
  return !!store.get("appLockPin");
});

ipcMain.handle("set-pin", (_event, pin: unknown) => {
  if (typeof pin !== "string" || pin.length < 4) {
    log.warn("IPC: set-pin rejected — invalid PIN");
    return false;
  }
  const encrypted = encryptPrivateKey(hashPin(pin));
  store.set("appLockPin", encrypted);
  log.info("IPC: app lock PIN saved");
  return true;
});

ipcMain.handle("verify-pin", (_event, pin: unknown) => {
  if (typeof pin !== "string") return false;
  const stored = store.get("appLockPin") as string | undefined;
  if (!stored) return false;
  const decrypted = decryptPrivateKey(stored);

  if (decrypted.startsWith("scrypt:")) {
    return verifyPinHash(pin, decrypted);
  }

  // Legacy path: PIN was stored as plaintext (pre-hash upgrade).
  // Use constant-time comparison to prevent timing attacks, then upgrade on match.
  const storedBuf = Buffer.from(decrypted, "utf8");
  const inputBuf = Buffer.from(pin, "utf8");
  const lengthsMatch = storedBuf.length === inputBuf.length;
  // Always run timingSafeEqual with equal-length buffers to avoid early exit.
  const paddedInput = Buffer.alloc(storedBuf.length);
  inputBuf.copy(paddedInput);
  const match = lengthsMatch && nodeCrypto.timingSafeEqual(storedBuf, paddedInput);
  if (match) {
    store.set("appLockPin", encryptPrivateKey(hashPin(pin)));
    log.info("IPC: app lock PIN upgraded to hashed format");
  }
  return match;
});

ipcMain.handle("clear-pin", () => {
  log.info("IPC: app lock PIN cleared");
  store.delete("appLockPin");
  return true;
});

// ─── IPC: Screen capture sources ─────────────────────────────────────────────

ipcMain.handle("get-screen-sources", async () => {
  log.debug("IPC: get-screen-sources");
  const raw = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
  });
  return raw.map((s: Electron.DesktopCapturerSource) => ({
    id: s.id,
    name: s.name,
    display_id: s.display_id,
    thumbnail: s.thumbnail.toDataURL(),
    // PipeWire node ID for Wayland sources (format "pipewire:<node_id>")
    pipeWireNodeId:
      process.platform === "linux" && s.id.startsWith("pipewire:")
        ? parseInt(s.id.split(":")[1], 10)
        : null,
  }));
});

// ─── Video Pop-Out Window ─────────────────────────────────────────────────────

ipcMain.handle("open-video-popout", async (_event, args: unknown) => {
  const { channelName } = (args as { channelName?: string }) ?? {};

  // Read the auth token from the store for one-time delivery to the pop-out
  const auth = store.get("auth") as { token?: string } | undefined;
  const token = auth?.token ?? "";

  pendingPopoutContext = { channelName: channelName ?? "", token };
  log.info("Opening video pop-out window", { channelName });

  const popout = new BrowserWindow({
    width: 960,
    height: 600,
    minWidth: 480,
    minHeight: 300,
    backgroundColor: "#111111",
    title: channelName ? `Voice — ${channelName}` : "Voice",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "../preload/video-popout-preload.js"),
      devTools: isDev,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  popout.loadFile(path.join(__dirname, "../renderer/video-popout.html"));
  popout.on("closed", () => {
    log.debug("Video pop-out window closed");
  });
});

ipcMain.handle("get-popout-voice-context", () => {
  log.debug("IPC: get-popout-voice-context");
  const ctx = pendingPopoutContext;
  pendingPopoutContext = null; // one-time read
  return ctx;
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
    // Never log invite codes (they can be used to join servers).
    log.debug("Invite data to send:", {
      has_code: invite.code.length > 0,
      hostname: invite.hostname,
    });
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

  app.whenReady().then(async () => {
    log.info("App ready");
    checkSafeStorageAtStartup();
    
    // Initialize auth service with safeStorage
    initializeAuthWithElectronSafeStorage();
    
    await cleanOrphanedAudioModules();
    registerAudioCaptureHandlers(process.pid);

    // Open signal database using the device private key for HKDF
    const authData = store.get("auth") as any;
    let privateKeyBytes: Buffer | null = null;

    // Optional local Signal identity material for initialising libsignal store rows.
    let localIdentityPrivateKeyBytes: Buffer | null = null;
    let localRegistrationId: number | null = null;
    let localIdentityAddress: string | null = null;
    
    if (authData && authData.user_id && authData.device_id) {
      // Try new safeStorage system first
      const legacyKey = await electronSafeStorageFunctions.getSafeStorage(`legacy_private_key_${authData.user_id}_${authData.device_id}`);
      if (legacyKey) {
        privateKeyBytes = Buffer.from(legacyKey, "base64");
        log.debug("Signal database: Using private key from new safeStorage system");
      }

      localIdentityAddress = `${authData.user_id}.${authData.device_id}`;

      // The local Ed25519 identity private key is stored in safeStorage under `identity_key_*`.
      const signalIdentityKey = await electronSafeStorageFunctions.getSafeStorage(
        `identity_key_${authData.user_id}_${authData.device_id}`,
      );
      if (signalIdentityKey) {
        const bytes = Buffer.from(signalIdentityKey, "base64");
        if (bytes.length === 32) {
          localIdentityPrivateKeyBytes = bytes;
        } else {
          // Some older builds may have stored the public key here; without a private key
          // we can't initialise libsignal's local identity rows.
          log.warn("Signal database: identity_key_* present but not a 32-byte Ed25519 private key", {
            identityKeyLength: bytes.length,
          });
        }
      }

      // registration id is stored as a decimal string under `registration_id_*`.
      const registrationIdStr = await electronSafeStorageFunctions.getSafeStorage(
        `registration_id_${authData.user_id}_${authData.device_id}`,
      );
      if (registrationIdStr) {
        const parsed = parseInt(registrationIdStr, 10);
        if (!Number.isNaN(parsed)) {
          localRegistrationId = parsed;
        }
      }
    }
    
    // Fallback to old devicePrivateKey system
    if (!privateKeyBytes) {
      const storedKey = store.get("devicePrivateKey");
      if (storedKey) {
        try {
          const privateKeyStr = decryptPrivateKey(storedKey as string);
          privateKeyBytes = Buffer.from(privateKeyStr, "base64");
          log.debug("Signal database: Using private key from legacy storage");
          
          // Migrate to new system
          if (authData && authData.user_id && authData.device_id) {
            await electronSafeStorageFunctions.setSafeStorage(`legacy_private_key_${authData.user_id}_${authData.device_id}`, privateKeyStr);
            store.delete("devicePrivateKey");
            log.debug("Signal database: Migrated private key to new safeStorage system");
          }
        } catch (err) {
          log.warn("Failed to decrypt legacy devicePrivateKey", { error: String(err) });
        }
      }
    }
    
    if (privateKeyBytes) {
      try {
        signalDb = openSignalDatabase(app.getPath("userData"), privateKeyBytes, {
          localIdentityPrivateKey: localIdentityPrivateKeyBytes ?? undefined,
          localRegistrationId: localRegistrationId ?? undefined,
          localIdentityAddress: localIdentityAddress ?? undefined,
        });
        registerEmberIpcHandlers(signalDb);
        log.info("Signal database opened and IPC handlers registered");
      } catch (err) {
        log.warn("Failed to open signal database; Signal IPC unavailable", { error: String(err) });
        registerEmberIpcHandlers(null);
      }
    } else {
      log.info("No device key yet — Signal IPC handlers registered without database");
      registerEmberIpcHandlers(null);
    }

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

// Register before-quit audio capture cleanup (stops WASAPI/PipeWire/PulseAudio)
registerBeforeQuitCleanup(app);

app.on("before-quit", async () => {
  if (signalDb) {
    signalDb.closeDatabase();
    signalDb = null;
    log.info("Signal database closed");
  }
  const installPath = getInstallOnExitPath();
  if (installPath) {
    log.info("Running scheduled update install before quit");
    try {
      await launchInstaller(installPath);
    } catch (err) {
      log.warn("Scheduled install failed", { error: String(err) });
    }
  }
});
