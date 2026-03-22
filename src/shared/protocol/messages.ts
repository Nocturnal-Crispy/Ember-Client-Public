/** Shared type definitions for messages and WebSocket payloads. */

import { UserStatus } from '../types/ember';

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
  channelId: string;
  senderId: string;
  senderUserId: string;
  username?: string;
  chatColor?: string;
  ciphertext: string;
  envelopeType?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
  channelId?: string;
  emberId?: string;
  candidate?: RTCIceCandidateInit;
  sdp?: RTCSessionDescriptionInit;
}

export interface PresenceUpdatePayload {
  userId: string;
  username: string;
  status: UserStatus;
  customStatus?: string;
  statusEmoji?: string;
}

export interface LogPayload {
  level: string;
  context: string;
  message: string;
  data: Record<string, unknown> | null;
}
