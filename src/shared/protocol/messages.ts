/** Shared type definitions for messages and WebSocket payloads. */

import { UserStatus } from "../types/ember";

// Minimal WebRTC type definitions (no DOM lib required)
export interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface RTCSessionDescriptionInit {
  type: string; // 'offer' | 'answer' | 'pranswer' | 'rollback'
  sdp?: string;
}

export interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_user_id: string;
  username?: string;
  chat_color?: string;
  ciphertext: string;
  envelope_type?: string;
  created_at?: number;
  updated_at?: number;
}

export interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
  channel_id?: string;
  ember_id?: string;
  candidate?: RTCIceCandidateInit;
  sdp?: RTCSessionDescriptionInit;
}

export interface PresenceUpdatePayload {
  user_id: string;
  username: string;
  status: UserStatus;
  custom_status?: string;
  status_emoji?: string;
}

export interface LogPayload {
  level: string;
  context: string;
  message: string;
  data: Record<string, unknown> | null;
}
