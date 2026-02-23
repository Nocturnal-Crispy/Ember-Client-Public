import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import * as path from 'path';
import Store from 'electron-store';

interface VoiceVideoSettings {
  inputDevice: string;
  outputDevice: string;
  inputVolume: number;
  outputVolume: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  autoSensitivity: boolean;
  sensitivityThreshold: number;
  pushToTalk: boolean;
  pttKey: string;
  cameraDevice: string;
  alwaysPreviewVideo: boolean;
  sounds: {
    mute: boolean;
    unmute: boolean;
    deafen: boolean;
    undeafen: boolean;
    userJoin: boolean;
    userLeave: boolean;
    disconnect: boolean;
  };
}

interface StoreSchema {
  auth?: {
    token: string;
    user_id: string;
    device_id: string;
    hostname: string;
    username: string;
  };
  device?: {
    device_id: string;
    public_key: string;
    private_key?: string; // only present during migration from old format
  };
  devicePrivateKey?: string; // safeStorage-encrypted private key, stored as base64
  settings?: {
    last_hostname: string;
  };
  voiceVideoSettings?: VoiceVideoSettings;
}

const defaultVoiceVideoSettings: VoiceVideoSettings = {
  inputDevice: 'default',
  outputDevice: 'default',
  inputVolume: 100,
  outputVolume: 100,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  autoSensitivity: true,
  sensitivityThreshold: 50,
  pushToTalk: false,
  pttKey: 'Backquote',
  cameraDevice: 'default',
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

const store = new Store<StoreSchema>();

let mainWindow: BrowserWindow | null = null;
let pendingInviteLink: string | null = null;

function createWindow(isAuthenticated: boolean) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#36393f',
    icon: path.join(__dirname, '../public/Icons/ember_1024x1024.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
      devTools: false,
    },
    frame: false,
    titleBarStyle: 'hidden',
  });

  if (isAuthenticated) {
    mainWindow.loadFile(path.join(__dirname, '../public/index.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, '../public/login.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function checkAuthentication(): boolean {
  const auth = (store as any).get('auth');
  return !!(auth && auth.token && auth.user_id && auth.device_id);
}

ipcMain.on('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.on('auth-success', () => {
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, '../public/index.html'));
  }
});

ipcMain.on('auth-logout', () => {
  (store as any).delete('auth');
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, '../public/login.html'));
  }
});

function encryptPrivateKey(plaintext: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plaintext).toString('base64');
  }
  // Fallback: no OS keyring available; store as-is (same security as previous plaintext store)
  console.warn('[ember] safeStorage unavailable; private key stored without OS-level encryption');
  return plaintext;
}

function decryptPrivateKey(stored: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      // Stored in plaintext fallback format (safeStorage was unavailable at save time)
      return stored;
    }
  }
  return stored;
}

ipcMain.handle('get-device-identity', () => {
  const device = (store as any).get('device') || null;
  if (!device) return null;

  // Migration: old builds stored private_key directly in the device object
  if (device.private_key) {
    const plaintextKey: string = device.private_key;
    const { private_key, ...deviceWithoutKey } = device;
    (store as any).set('devicePrivateKey', encryptPrivateKey(plaintextKey));
    (store as any).set('device', deviceWithoutKey);
    return { ...deviceWithoutKey, private_key: plaintextKey };
  }

  const storedKey = (store as any).get('devicePrivateKey') as string | undefined;
  if (!storedKey) return device;

  return { ...device, private_key: decryptPrivateKey(storedKey) };
});

ipcMain.handle('save-device-identity', (_event, deviceIdentity) => {
  const { private_key, ...deviceWithoutKey } = deviceIdentity;
  (store as any).set('device', deviceWithoutKey);
  if (private_key !== undefined) {
    (store as any).set('devicePrivateKey', encryptPrivateKey(String(private_key)));
  }
  return true;
});

ipcMain.handle('get-auth', () => {
  return (store as any).get('auth') || null;
});

ipcMain.handle('save-auth', (_event, authData) => {
  (store as any).set('auth', authData);
  if (authData.hostname) {
    const settings = (store as any).get('settings') || {};
    settings.last_hostname = authData.hostname;
    (store as any).set('settings', settings);
  }
  return true;
});

ipcMain.handle('get-last-hostname', () => {
  const settings = (store as any).get('settings');
  return settings?.last_hostname || 'http://localhost:8085';
});

ipcMain.handle('get-voice-video-settings', () => {
  const saved = (store as any).get('voiceVideoSettings') || {};
  return { ...defaultVoiceVideoSettings, ...saved, sounds: { ...defaultVoiceVideoSettings.sounds, ...(saved.sounds || {}) } };
});

ipcMain.handle('save-voice-video-settings', (_event, settings: VoiceVideoSettings) => {
  (store as any).set('voiceVideoSettings', settings);
  return true;
});

function parseInviteUrl(url: string): { code: string; hostname: string } | null {
  // ember://invite/<code>/<scheme>/<host>/<port>
  // e.g. ember://invite/abc123/http/localhost/8080
  const match = url.match(/^ember:\/\/invite\/([^/]+)\/([^/]+)\/([^/]+)(?:\/([^/]+))?/);
  if (!match) return null;
  const code = match[1];
  const scheme = match[2];
  const host = match[3];
  const port = match[4];

  // Only allow http/https schemes to prevent javascript: or file: injection
  if (scheme !== 'http' && scheme !== 'https') return null;

  // Validate host: must be a hostname or IP, no special characters
  if (!/^[a-zA-Z0-9.\-]+$/.test(host)) return null;

  // Validate port if present: must be numeric
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return null;

  const hostname = port ? `${scheme}://${host}:${port}` : `${scheme}://${host}`;
  return { code, hostname };
}

function handleInviteLink(url: string): void {
  const invite = parseInviteUrl(url);
  if (!invite) return;
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('handle-invite-link', invite);
  } else {
    pendingInviteLink = url;
  }
}

// Set app name for Linux WM_CLASS to match desktop file Icon=ember-client
app.name = 'ember-client';

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const url = commandLine.find((arg) => arg.startsWith('ember://'));
    if (url) {
      handleInviteLink(url);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleInviteLink(url);
  });

  app.setAsDefaultProtocolClient('ember');

  app.whenReady().then(() => {
    const isAuthenticated = checkAuthentication();
    createWindow(isAuthenticated);

    if (pendingInviteLink) {
      setTimeout(() => {
        if (pendingInviteLink) {
          handleInviteLink(pendingInviteLink);
          pendingInviteLink = null;
        }
      }, 1500);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const isAuth = checkAuthentication();
        createWindow(isAuth);
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
