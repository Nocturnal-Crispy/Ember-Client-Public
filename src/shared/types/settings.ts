/** Shared type definitions for application settings and electron-store schema. */

import type { VoiceSettings } from './voice';
import type { AuthData } from './auth';

export interface ThemeSettings {
  themeId: string;
  accentRgb: string;
  backgroundRgb: string;
  surfaceRgb: string;
  chatColor: string;
}

export interface GifFavorite {
  url: string;
  previewUrl?: string;
  title?: string;
}

export interface AppSettings {
  lastHostname?: string;
}

/** electron-store schema for the main process store. */
export interface StoreSchema {
  auth?: AuthData;
  settings?: AppSettings;
  voiceVideoSettings?: VoiceSettings;
  themeSettings?: ThemeSettings;
  gifFavorites?: GifFavorite[];
  [key: string]: unknown;
}
