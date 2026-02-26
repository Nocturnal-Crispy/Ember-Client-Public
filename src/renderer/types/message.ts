/** Shared type definitions for messages and WebSocket payloads. */

export interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_user_id: string;
  username?: string;
  ciphertext: string;
  created_at?: number;
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
  status: string;
}

export interface LogPayload {
  level: string;
  context: string;
  message: string;
  data: Record<string, unknown> | null;
}
