/**
 * Shared constants used across the application
 */

const IPC_CHANNELS = {
  // Window controls
  WINDOW_MINIMIZE: 'window-minimize',
  WINDOW_MAXIMIZE: 'window-maximize',
  WINDOW_CLOSE: 'window-close',

  // Authentication
  AUTH_SUCCESS: 'auth-success',
  AUTH_LOGOUT: 'auth-logout',

  // Logging
  LOG_TO_CONSOLE: 'log-to-console',

  // Device identity
  GET_DEVICE_IDENTITY: 'get-device-identity',

  // Settings
  GET_VOICE_VIDEO_SETTINGS: 'get-voice-video-settings',
  SAVE_VOICE_VIDEO_SETTINGS: 'save-voice-video-settings',
  GET_THEME_SETTINGS: 'get-theme-settings',
  SAVE_THEME_SETTINGS: 'save-theme-settings',

  // System
  CHECK_FOR_UPDATE: 'check-for-update',
  OPEN_EXTERNAL_URL: 'open-external-url',

  // Events
  HANDLE_INVITE_LINK: 'handle-invite-link',
} as const;

const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
} as const;

// CommonJS export
module.exports = { IPC_CHANNELS, LOG_LEVELS };
