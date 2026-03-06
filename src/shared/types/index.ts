/**
 * Shared types used across main, preload, and renderer processes
 */

export interface VoiceVideoSettings {
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

export interface ThemeSettings {
  themeId: string;
  accentRgb: string;
  backgroundRgb: string;
  surfaceRgb: string;
  chatColor?: string;
}

export interface StoreSchema {
  auth?: AuthData;
  device?: DeviceIdentity;
  devicePrivateKey?: string; // safeStorage-encrypted private key, stored as base64
  settings?: {
    last_hostname: string;
  };
  voiceVideoSettings?: VoiceVideoSettings;
  themeSettings?: ThemeSettings;
}

export interface AuthData {
  token: string;
  user_id: string;
  device_id: string;
  hostname: string;
  username: string;
}

export interface DeviceIdentity {
  device_id: string;
  public_key: string;
  private_key?: string;
}

export interface LogEntry {
  level: string;
  context: string;
  message: string;
  data?: Record<string, unknown>;
}
