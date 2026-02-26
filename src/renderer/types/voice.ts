/** Shared type definitions for voice, video, and WebRTC. */

export interface VoiceSettings {
  inputDevice?: string;
  outputDevice?: string;
  inputVolume?: number;
  outputVolume?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  autoSensitivity?: boolean;
  sensitivityThreshold?: number;
  pushToTalk?: boolean;
  pttKey?: string;
  cameraDevice?: string;
  alwaysPreviewVideo?: boolean;
  sounds?: Partial<Record<SoundType, boolean>>;
}

export type SoundType =
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'userJoin'
  | 'userLeave'
  | 'disconnect';

export interface VoiceParticipant {
  user_id: string;
  username: string;
}

export interface ICEServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface AuthForVoice {
  token: string;
  hostname: string;
  user_id: string;
  username: string;
}

export type OscillatorType = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface SoundDef {
  type: OscillatorType;
  freq: number[];
  dur: number[];
  vol: number;
}
